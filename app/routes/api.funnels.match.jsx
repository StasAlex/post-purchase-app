import { json } from "@remix-run/node";
import { prisma } from "../lib/prisma.server";
import shopify from "../shopify.server";

/* =========================
   CORS
========================= */
function corsHeaders(request) {
  const origin = request?.headers?.get?.("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Requested-With, Shopify-Checkout-Reference-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/* =========================
   Helpers
========================= */
const toProductGid = (val) => {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (s.startsWith("gid://")) return s;
  const d = s.match(/\d+/)?.[0];
  return d ? `gid://shopify/Product/${d}` : null;
};

const normalizeGids = (arr) =>
  Array.from(new Set((Array.isArray(arr) ? arr : []).map(toProductGid).filter(Boolean)));

const money = (amount, currency) =>
  amount != null && currency ? `${Number(amount).toFixed(2)} ${currency}` : null;

const apiVersion = () =>
  (shopify?.api?.config?.apiVersion || process.env.SHOPIFY_API_VERSION || "2024-07");

const digitsFromGids = (ids) =>
  (ids || []).map((gid) => gid?.match(/\d+/)?.[0]).filter(Boolean);

/* =========================
   OFFLINE session loader — без SDK GraphQL клиента
========================= */
async function getOfflineSession(shop) {
  try {
    const offlineId = `offline_${shop}`;
    const storage = shopify?.sessionStorage;
    const session = storage && typeof storage.loadSession === "function"
      ? await storage.loadSession(offlineId)
      : null;

    const debug = {
      offlineId,
      hasSession: Boolean(session),
      usedSessionId: session?.id || null,
      isOnline: session?.isOnline ?? null,
      scopes: session?.scope || null,
    };

    if (!session) {
      return { session: null, debug: { reason: "no-offline-session", ...debug } };
    }
    return { session, debug: { reason: "http-graphql", ...debug } };
  } catch (e) {
    return { session: null, debug: { reason: "exception", error: String(e?.message || e) } };
  }
}

/* =========================
   Shop currency (для REST)
========================= */
async function fetchShopCurrency(session) {
  const v = apiVersion();
  const url = `https://${session.shop}/admin/api/${v}/shop.json?fields=currency`;
  try {
    const r = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
    });
    const js = await r.json();
    return js?.shop?.currency || null;
  } catch {
    return null;
  }
}

/* =========================
   Admin GraphQL через HTTP POST по оффлайн-токену
========================= */
async function fetchProductsMetaGraphQLHTTP(session, ids) {
  if (!session || !ids?.length) {
    return { byId: {}, debug: { kind: "graphql-http", requested: ids || [], received: [] } };
  }

  const query = `#graphql
    query ProductsById($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          featuredImage { url }
          images(first: 10) { nodes { url } }
          variants(first: 50) {
           nodes {
            id
            title
            price { amount currencyCode }
           }
          }
        }
      }
    }
  `;

  try {
    const v = apiVersion();
    const resp = await fetch(`https://${session.shop}/admin/api/${v}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { ids } }),
    });
    const js = await resp.json();
    const nodes = js?.data?.nodes || [];

    const byId = {};
    for (const n of nodes) {
      if (!n?.id) continue;
      const v0 = n.variants?.nodes?.[0];
      const amount = v0?.price?.amount != null ? Number(v0.price.amount) : null;
      const currency = v0?.price?.currencyCode || null;
      byId[n.id] = {
        id: n.id,
        title: n.title || "Untitled product",
        image: n.featuredImage?.url || null,
        images: (n.images?.nodes || []).map(i => i?.url).filter(Boolean),
        variantId: v0?.id || null,
        variants: (n.variants?.nodes || []).map(v => ({
          id: v?.id || null,
          title: v?.title || '',
          priceAmount: v?.price?.amount != null ? Number(v.price.amount) : null,
          currencyCode: v?.price?.currencyCode || null,
        })),
        price: money(amount, currency),     // "100.00 UAH"
        priceAmount: amount,                // число
        currencyCode: currency,             // "UAH"
      };
    }

    const debug = { kind: "graphql-http", requested: ids, received: nodes.map(n => n?.id).filter(Boolean) };
    return { byId, debug };
  } catch (e) {
    const debug = { kind: "graphql-http", requested: ids, received: [], error: String(e?.message || e) };
    return { byId: {}, debug };
  }
}

/* =========================
   REST фолбэк
========================= */
async function fetchProductsMetaREST(session, ids) {
  if (!session || !ids?.length) {
    return { byId: {}, debug: { kind: "rest", requested: ids || [], received: [] } };
  }

  const numeric = digitsFromGids(ids);
  if (!numeric.length) {
    return { byId: {}, debug: { kind: "rest", requested: ids, received: [], note: "no numeric ids" } };
  }

  const v = apiVersion();
  const url = `https://${session.shop}/admin/api/${v}/products.json?ids=${numeric.join(",")}&fields=id,title,image,variants`;

  try {
    const [r, shopCurrency] = await Promise.all([
      fetch(url, {
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json",
        },
      }),
      fetchShopCurrency(session),
    ]);

    const js = await r.json();
    const products = js?.products || [];
    const byId = {};
    for (const p of products) {
      const gid = `gid://shopify/Product/${p.id}`;
      const v0 = Array.isArray(p.variants) ? p.variants[0] : null;
      const amount = v0?.price != null ? Number(v0.price) : null;
      const currency = shopCurrency || null;
      byId[gid] = {
        id: gid,
        title: p.title || "Untitled product",
        image: p.image?.src || null,
        images: Array.isArray(p.images) ? p.images.map(i => i?.src).filter(Boolean) : [],
        variantId: v0 ? `gid://shopify/ProductVariant/${v0.id}` : null,
          variants: Array.isArray(p.variants) ? p.variants.map(v => ({
            id: v?.id ? `gid://shopify/ProductVariant/${v.id}` : null,
            title: v?.title || '',
            priceAmount: v?.price != null ? Number(v.price) : null,
            currencyCode: currency,
        })) : [],
        price: money(amount, currency),
        priceAmount: amount,
        currencyCode: currency,
      };
    }
    const debug = {
      kind: "rest",
      requested: ids,
      status: r.status,
      received: products.map(p => `gid://shopify/Product/${p.id}`),
      url,
      shopCurrency,
    };
    return { byId, debug };
  } catch (e) {
    const debug = { kind: "rest", requested: ids, received: [], error: String(e?.message || e) };
    return { byId: {}, debug };
  }
}

/* =========================
   Main matcher
========================= */
/* =========================
   Main matcher — для новой схемы Funnel
   (triggerProductGid / offerProductGid)
========================= */
async function matchOffers(shop, productGids) {
  // подготавливаем варианты совпадений (GID и «цифры»)
  const digits = digitsFromGids(productGids);
  const gidLike = [
    ...productGids,
    ...digits.map((d) => `gid://shopify/Product/${d}`),
    ...digits, // на всякий, если в БД лежат только цифры
  ].filter(Boolean);

  // ищем активный воронко-фаннел по триггеру
  let funnel = null;
  let prismaError = null;
  let prismaWhereUsed = null;

  try {
    prismaWhereUsed = {
      shopDomain: shop,
      active: true,
      OR: [
        { triggerProductGid: { in: gidLike } },
        // небольшой запас: иногда полезно «contains», если в БД мусор в виде префиксов
        ...(digits.length ? [{ triggerProductGid: { contains: digits[0] } }] : []),
      ],
    };

    funnel = await prisma.funnel.findFirst({
      where: prismaWhereUsed,
      orderBy: { updatedAt: "desc" },
      // include не нужен — relation нет
    });
  } catch (e) {
    prismaError = String(e?.message || e);
  }

  // если не нашли — последний шанс: любой активный воронко-фаннел магазина
  if (!funnel) {
    try {
      funnel = await prisma.funnel.findFirst({
        where: { shopDomain: shop, active: true },
        orderBy: { updatedAt: "desc" },
      });
    } catch (e) {
      prismaError = prismaError || String(e?.message || e);
    }
  }

  // собираем оффер (в новой схеме он один)
  const offerIds = funnel?.offerProductGid ? [toProductGid(funnel.offerProductGid)].filter(Boolean) : [];

  let enriched = offerIds.map((id) => ({ id }));

  // оффлайн-сессия Shopify Admin
  const { session, debug: sessDbg } = await getOfflineSession(shop);

  let byId = {};
  let fetchDbg = null;

  if (session && offerIds.length) {
    // GraphQL
    const r1 = await fetchProductsMetaGraphQLHTTP(session, offerIds);
    byId = r1.byId;
    fetchDbg = r1.debug;

    // REST fallback
    if (!Object.keys(byId).length) {
      const r2 = await fetchProductsMetaREST(session, offerIds);
      byId = r2.byId;
      fetchDbg = r2.debug;
    }
  }

  enriched = offerIds.map((id) => ({
        id,
         title: byId[id]?.title || null,
        image: byId[id]?.image || null,
        images: byId[id]?.images || [],
        variantId: byId[id]?.variantId || null,
        variants: byId[id]?.variants || [],
        price: byId[id]?.price || null,
       priceAmount: byId[id]?.priceAmount ?? null,
       currencyCode: byId[id]?.currencyCode ?? null,
        discountPct: funnel?.discountPct ?? 0,
      }));

  const debug = {
    funnelId: funnel?.id || null,
    offerIds,
    prismaWhereUsed,
    prismaError,
    admin: sessDbg,
    fetchDbg,
    enrichment: { fetchedKeys: Object.keys(byId) },
  };

  return { enriched, debug };
}

/* =========================
   Loader (GET)
========================= */
export async function loader({ request }) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  try {
    // health-check
    if (!url.searchParams.has("shop")) {
      return json({ ok: true }, { headers: corsHeaders(request) });
    }

    const shop = url.searchParams.get("shop") || "";
    const gidsRaw = (url.searchParams.get("gids") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const productGids = normalizeGids(gidsRaw);

    const dbgInput = { shop, gidsRaw, productGids };

    if (!shop) {
      const latest = await prisma.funnel.findFirst({
        where: { active: true },
        orderBy: { updatedAt: "desc" },
        select: { shopDomain: true, id: true },
      });

      if (latest?.shopDomain) {
        const guessed = latest.shopDomain;
        dbgInput.shop = guessed;
        const { enriched, debug } = await matchOffers(guessed, productGids);
        return json(
          { offers: enriched, debug: { ...dbgInput, guessedFrom: "latest-active-funnel", ...debug } },
          { headers: corsHeaders(request) }
        );
      }

      return json(
        { offers: [], debug: { ...dbgInput, reason: "no-shop" } },
        { headers: corsHeaders(request) }
      );
    }

    // Если gids пусты — подберём самый свежий активный фаннел и вернём его оффер
    if (productGids.length === 0) {
      const funnel = await prisma.funnel.findFirst({
        where: { shopDomain: shop, active: true },
        orderBy: { updatedAt: "desc" },
      });

      const offerIds = funnel?.offerProductGid
        ? [toProductGid(funnel.offerProductGid)].filter(Boolean)
        : [];

      const { session, debug: sessDbg } = await getOfflineSession(shop);

      let byId = {};
      let fetchDbg = null;

      if (session && offerIds.length) {
        const r1 = await fetchProductsMetaGraphQLHTTP(session, offerIds);
        byId = r1.byId; fetchDbg = r1.debug;

        if (!Object.keys(byId).length) {
          const r2 = await fetchProductsMetaREST(session, offerIds);
          byId = r2.byId; fetchDbg = r2.debug;
        }
      }

      const enriched = offerIds.map((id) => ({
        id,
        title: byId[id]?.title || null,
        image: byId[id]?.image || null,
        variantId: byId[id]?.variantId || null,
        price: byId[id]?.price || null,
        priceAmount: byId[id]?.priceAmount ?? null,
        currencyCode: byId[id]?.currencyCode ?? null,
      }));

      return json({
        offers: enriched,
        debug: {
          shop,
          gidsRaw,
          productGids,
          reason: "fallback-no-gids",
          funnelId: funnel?.id || null,
          admin: sessDbg,
          fetchDbg,
        },
      }, { headers: corsHeaders(request) });
    }

    const { enriched, debug } = await matchOffers(shop, productGids);
    return json({ offers: enriched, debug: { ...dbgInput, ...debug } }, { headers: corsHeaders(request) });
  } catch (e) {
    return json(
      { offers: [], debug: { error: String(e?.message || e), where: "loader" } },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}

/* =========================
   Action (POST JSON)
========================= */
export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  let body = {};
  try { body = await request.json(); } catch {}

  const shop = String(body.shop || "");
  const productGids = normalizeGids(body.productGids);
  const dbgInput = { shop, productGids, via: "POST" };

  if (!shop || productGids.length === 0) {
    return json({ offers: [], debug: { ...dbgInput, reason: "no-shop-or-gids" } }, { headers: corsHeaders(request) });
  }

  const { enriched, debug } = await matchOffers(shop, productGids);
  return json({ offers: enriched, debug: { ...dbgInput, ...debug } }, { headers: corsHeaders(request) });
}
