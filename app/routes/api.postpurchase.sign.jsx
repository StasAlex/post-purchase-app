// app/routes/api.postpurchase.sign.jsx
import { json } from "@remix-run/node";

/**
 * POST /api/postpurchase/sign
 * Body: { shop: string, referenceId: string, changes: Array }
 * Header: Authorization: Bearer <inputData.token>
 *
 * Returns: { changeset: string }
 */
export async function action({ request }) {
  // CORS preflight sent as POST by some setups is rare, but just in case:
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405, headers: corsHeaders(request) });
  }

  try {
    const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    const { shop, referenceId, changes } = await safeJson(request);

    if (!bearer) {
      return json({ error: "missing_bearer_token" }, { status: 401, headers: corsHeaders(request) });
    }
    if (!shop || !referenceId || !Array.isArray(changes)) {
      return json({ error: "bad_request", details: { shop, referenceId, changesType: typeof changes } }, { status: 400, headers: corsHeaders(request) });
    }

    // Shopify signing endpoint
    // 1) современный путь БЕЗ .json
    let url = `https://${shop}/checkouts/unstable/changesets/calculate`;

    let upstream = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${bearer}`, // ВАЖНО: buyer token из inputData.token
        "cache-control": "no-store",
        "Shopify-Checkout-Reference-Id": referenceId,
      },
      body: JSON.stringify({ referenceId, changes }),
    });

// 2) на случай старого окружения — пробуем .json как фоллбэк
    if (upstream.status === 404) {
      const legacyUrl = `https://${shop}/checkouts/unstable/changesets/calculate.json`;
      upstream = await fetch(legacyUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${bearer}`,
          "cache-control": "no-store",
        },
        body: JSON.stringify({ referenceId, changes }),
      });
    }

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!upstream.ok) {
      return json(
        {
          error: "shopify_calculate_failed",
          status: upstream.status,
          data,
          raw: text
        },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const changeset = data?.token ?? data?.changeset ?? null;
    if (!changeset) {
      return json(
        { error: "no_changeset_token_in_response", data, raw: text },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    return json({ changeset }, { headers: corsHeaders(request) });

  } catch (e) {
    return json(
      { error: "internal", message: e?.message || String(e) },
      { status: 500, headers: corsHeaders(request) },
    );
  }
}

// (Optional) enable GET/OPTIONS to make CORS happy when probed
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  return new Response("OK", { status: 200, headers: corsHeaders(request) });
}

/* ---------- utils ---------- */

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
  try {
    return await request.json();
  } catch {
    return {};
  }
}
