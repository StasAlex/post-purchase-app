// app/routes/api.postpurchase.sign.jsx
import { json } from "@remix-run/node";

/**
 * POST /api/postpurchase/sign
 * Headers: Authorization: Bearer <inputData.token>
 * Body: { shop: string, referenceId: string, changes: Array, checkoutOrigin?: string }
 * Returns: { changeset: string }
 */
export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405, headers: corsHeaders(request) });
  }

  // ---- CORS / Origin guard ----
  const reqOrigin = request.headers.get("origin") || "";
  const DEFAULT_ALLOWED = [
    "https://checkout.shopify.com",
    "https://pay.shopify.com",
    "https://cdn.shopify.com",
  ];
  const allowedList = [
    ...(process.env.SHOPIFY_ALLOWED_ORIGINS || "")
      .split(",").map((s) => s.trim()).filter(Boolean),
    ...DEFAULT_ALLOWED,
  ];

  const isOriginAllowed = (origin) => {
    if (!origin) return true; // разрешаем отсутствие Origin (некоторые среды превью)
    try {
      const u = new URL(origin);
      const host = u.hostname.toLowerCase();
      // явные разрешённые урлы
      if (allowedList.some((o) => {
        try { return new URL(o).hostname.toLowerCase() === host; } catch { return false; }
      })) return true;
      // *.myshopify.com
      if (host.endsWith(".myshopify.com")) return true;
      // домен нашего приложения из окружения
      const appUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL || "";
      if (appUrl) {
        try { if (new URL(appUrl).hostname.toLowerCase() === host) return true; } catch {}
      }
      return false;
    } catch {
      return false;
    }
  };

  if (!isOriginAllowed(reqOrigin)) {
    return json({ error: "forbidden_origin", origin: reqOrigin, allowed: allowedList }, {
      status: 403, headers: corsHeaders(request),
    });
  }

  try {
    const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
    const buyerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    const { shop, referenceId, changes, checkoutOrigin } = await safeJson(request);

    if (!buyerToken) {
      return json({ error: "missing_bearer_token" }, { status: 401, headers: corsHeaders(request) });
    }
    if (!shop || !referenceId || !Array.isArray(changes)) {
      return json(
        { error: "bad_request", details: { shop, referenceId, changesType: typeof changes } },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    // Если прилетели с CDN — апстриму всегда говорим, что пришли с checkout/pay
    const upstreamOrigin = canonicalizeCheckoutOrigin(checkoutOrigin || reqOrigin);

    const result = await fetchShopifyCalculate({
      shop,
      referenceId,
      buyerToken,
      changes,
      checkoutOrigin: upstreamOrigin,
    });

    if (!result.ok) {
      return json(
        {
          error: result.error || "shopify_calculate_failed",
          status: result.status ?? 0,
          data: result.data ?? null,
          raw: result.raw ?? null,
          tried: result.tried,
          cause: result.cause ?? null,
          requestId: result.requestId ?? null,
          responseHeaders: result.responseHeaders ?? null,
        },
        { status: result.status && result.status >= 400 ? result.status : 502, headers: corsHeaders(request) },
      );
    }

    const changeset = result.data?.token ?? result.data?.changeset ?? null;
    if (!changeset) {
      return json(
        { error: "no_changeset_token_in_response", data: result.data, raw: result.raw },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    return json({ changeset }, { headers: corsHeaders(request) });
  } catch (e) {
    return json(
      { error: "internal", message: e?.message || String(e), cause: unwrapError(e) },
      { status: 500, headers: corsHeaders(request) },
    );
  }
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  return new Response("OK", { status: 200, headers: corsHeaders(request) });
}

/* ------------ helpers ------------ */

function canonicalizeCheckoutOrigin(origin) {
  if (!origin) return "https://checkout.shopify.com";
  try {
    const u = new URL(origin);
    // если пришло с CDN — подменяем на checkout
    if (u.hostname === "cdn.shopify.com" || u.hostname.endsWith(".shopifycdn.com")) {
      return "https://checkout.shopify.com";
    }
    // нормализуем до протокола+хоста
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return "https://checkout.shopify.com";
  }
}

async function fetchShopifyCalculate({ shop, referenceId, buyerToken, changes, checkoutOrigin }) {
  const tried = [];

  // → snake_case для тела
  const snakeChanges = (Array.isArray(changes) ? changes : []).map((c) => {
    if (!c || typeof c !== "object") return c;
    if (c.type === "add_variant") {
      const vid =
        typeof c.variant_id === "number"
          ? c.variant_id
          : Number(String(c.variantId ?? "").match(/\d+$/)?.[0]);
      return { type: "add_variant", variant_id: vid, quantity: Number(c.quantity ?? 1) || 1 };
    }
    return c;
  });

  // порядок попыток (pay → checkout → shop)
  const origins = [
    "https://pay.shopify.com",
    "https://checkout.shopify.com",
    stripSlash(checkoutOrigin || ""),     // если вдруг пришло иное валидное
    `https://${stripSlash(shop)}`,        // shop domain как последний шанс
  ].filter(Boolean);

  const buildHeaders = (originHost) => ({
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${buyerToken}`,
    "cache-control": "no-store",
    Origin: originHost,
    Referer: `${originHost}/checkouts/${encodeURIComponent(referenceId)}`,
    "Shopify-Checkout-Reference-Id": referenceId,
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "PostPurchase-Calc/1.0 (+remix)",
  });

  const doFetch = async (url, headers, body) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "follow",
      });

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const text = await res.text();

      let data = null;
      if (contentType.includes("application/json")) {
        try { data = JSON.parse(text); } catch {}
      }

      const okJson = res.ok && data && typeof data === "object";
      const requestId = res.headers.get("x-request-id") || null;
      const responseHeaders = {};
      for (const [k, v] of res.headers) responseHeaders[k] = v;

      return { ok: okJson, status: res.status, raw: text, data, contentType, requestId, responseHeaders };
    } finally {
      clearTimeout(t);
    }
  };

  try {
    for (const origin of origins) {
      const originHost = stripSlash(origin);
      const headers = buildHeaders(originHost);

      const paths = [
        `/checkouts/${encodeURIComponent(referenceId)}/changesets/calculate.json`,
        `/checkouts/${encodeURIComponent(referenceId)}/changesets/calculate`,
        `/checkouts/${encodeURIComponent(referenceId)}/unstable/changesets/calculate.json`,
        `/checkouts/${encodeURIComponent(referenceId)}/unstable/changesets/calculate`,
        `/checkouts/unstable/changesets/calculate`, // ref в body
      ];

      for (const p of paths) {
        const url = `${originHost}${p}`;
        tried.push(url);

        const body =
          p.includes("/checkouts/unstable/changesets/calculate") && !p.includes(referenceId)
            ? { referenceId, changes: snakeChanges }
            : { changes: snakeChanges };

        const r = await doFetch(url, headers, body);
        if (r.ok) return { ok: true, ...r, tried };
        if (r.status !== 404) return { ok: false, ...r, tried, error: decodeError(r) };
      }
    }

    return { ok: false, status: 502, data: null, raw: null, tried, error: "upstream_fetch_failed" };
  } catch (e) {
    return {
      ok: false,
      status: 502,
      data: null,
      raw: null,
      tried,
      error: "upstream_fetch_failed",
      cause: unwrapError(e),
    };
  }
}

function decodeError(r) {
  if (r.status === 302 || String(r.raw || "").includes("/password")) return "redirected_to_password";
  if (r.status === 401) return "unauthorized_buyer_token";
  if (r.status === 403) return "forbidden";
  if (r.status === 422) return "unprocessable_entity";
  if (r.status === 500) return "shopify_internal_error";
  return "shopify_calculate_failed";
}

function stripSlash(s) { return String(s || "").replace(/\/+$/, ""); }

function unwrapError(e) {
  return {
    name: e?.name,
    message: e?.message,
    code: e?.code || e?.cause?.code,
    errno: e?.errno || e?.cause?.errno,
    type: e?.type || e?.cause?.type,
    stack: e?.stack?.split("\n").slice(0, 3).join("\n"),
  };
}

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}
