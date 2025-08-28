import { json } from "@remix-run/node";
import { prisma } from "../lib/prisma.server";
import shopify from "../shopify.server";

/* =========================
   CORS
========================= */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

const apiVersion = () => shopify?.api?.config?.apiVersion || "2024-07";
const digitsFromGids = (ids) => (ids || []).map((gid) => gid?.match(/\d+/)?.[0]).filter(Boolean);

/* =========================
   Admin client (OFFLINE)
========================= */
async function getAdminClientForShop(shop) {
  try {
    const offlineId = shopify.api.session.getOfflineId(shop);
    const session = await shopify.sessionStorage.loadSession(offlineId);

    // шаблоны у Shopify разные: пробуем оба места
    const GraphqlClient =
      shopify.api?.clients?.Graphql ?? shopify.clients?.Graphql ?? null;

    const debug = {
      offlineId,
      hasSession: Boolean(session),
      usedSessionId: session?.id || null,
      isOnline: session?.isOnline ?? null,
      hasGraphqlCtor: Boolean(GraphqlClient),
      scopes: session?.scope || null,
    };

    if (!session) {
      console.warn("[funnels.match] No offline session", debug);
      return { admin: null, session: null, debug: { reason: "no-offline-session", ...debug } };
    }

    if (!GraphqlClient) {
      console.warn("[funnels.match] No Admin client", debug);
      // вернём session: дальше упадём на REST
      return { admin: null, session, debug: { reason: "no-graphql-ctor", ...debug } };
    }

    return { admin: new GraphqlClient({ session }), session, debug };
  } catch (e) {
    console.error("[funnels.match] getAdminClientForShop error:", e);
    return { admin: null, session: null, debug: { reason: "exception", error: String(e?.message || e) } };
  }
}

/* =========================
   Fetch meta via GraphQL
========================= */
async function fetchProductsMetaGraphQL(admin, ids) {
  if (!admin || !ids?.length) {
    return { byId: {}, debug: { kind: "graphql", requested: ids || [], received: [] } };
  }

  const query = `#graphql
    query ProductsById($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          featuredImage { url }
          variants(first: 1) {
            nodes { id price { amount currencyCode } }
          }
        }
      }
    }
  `;

  try {
    const resp = await admin.query({ data: { query, variables: { ids } } });
    const nodes = resp?.body?.data?.nodes || [];
    const byId = {};
    for (const n of nodes) {
      if (!n?.id) continue;
      const v = n.variants?.nodes?.[0];
      byId[n.id] = {
        id: n.id,
        title: n.title || "Untitled product",
        image: n.featuredImage?.url || null,
        variantId: v?.id || null,
        price: money(v?.price?.amount, v?.price?.currencyCode),
      };
    }
    const debug = { kind: "graphql", requested: ids, received: nodes.map(n => n?.id).filter(Boolean) };
    console.log("[funnels.match] fetched meta (GraphQL):", debug);
    return { byId, debug };
  } catch (e) {
    const debug = { kind: "graphql", requested: ids, received: [], error: String(e?.message || e) };
    console.error("[funnels.match] fetchProductsMetaGraphQL error:", debug);
    return { byId: {}, debug };
  }
}

/* =========================
   Fetch meta via REST (fallback)
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
    const r = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
    });

    const js = await r.json();
    const products = js?.products || [];
    const byId = {};
    for (const p of products) {
      const gid = `gid://shopify/Product/${p.id}`;
      const v0 = Array.isArray(p.variants) ? p.variants[0] : null;
      byId[gid] = {
        id: gid,
        title: p.title || "Untitled product",
        image: p.image?.src || null,
        variantId: v0 ? `gid://shopify/ProductVariant/${v0.id}` : null,
        // REST цена без валюты; при желании можно подтянуть /shop.json и добавить валюту
        price: v0?.price ?? null,
      };
    }
    const debug = {
      kind: "rest",
      requested: ids,
      status: r.status,
      received: products.map(p => `gid://shopify/Product/${p.id}`),
      url,
    };
    console.log("[funnels.match] fetched meta (REST):", debug);
    return { byId, debug };
  } catch (e) {
    const debug = { kind: "rest", requested: ids, received: [], error: String(e?.message || e) };
    console.error("[funnels.match] fetchProductsMetaREST error:", debug);
    return { byId: {}, debug };
  }
}

/* =========================
   Main matcher
========================= */
async function matchOffers(shop, productGids) {
  const funnel = await prisma.funnel.findFirst({
    where: {
      shopDomain: shop,
      active: true,
      triggers: { some: { productGid: { in: productGids } } },
    },
    include: { offers: true },
  });

  const offerIds = Array.from(
    new Set((funnel?.offers ?? []).map((o) => toProductGid(o.productGid)).filter(Boolean))
  );

  // база — просто id
  let enriched = offerIds.map((id) => ({ id }));

  // получаем админ клиента / сессию
  const { admin, session, debug: adminDbg } = await getAdminClientForShop(shop);

  // сначала GraphQL
  let byId = {};
  let fetchDbg = null;
  if (admin) {
    const res = await fetchProductsMetaGraphQL(admin, offerIds);
    byId = res.byId;
    fetchDbg = res.debug;
  }

  // если пусто — REST фолбэк
  if (!Object.keys(byId).length && session) {
    const res = await fetchProductsMetaREST(session, offerIds);
    byId = res.byId;
    fetchDbg = res.debug;
  }

  enriched = offerIds.map((id) => ({
    id,
    title: byId[id]?.title || null,
    image: byId[id]?.image || null,
    variantId: byId[id]?.variantId || null,
    price: byId[id]?.price || null,
  }));

  const debug = {
    funnelId: funnel?.id || null,
    offerIds,
    admin: adminDbg,
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
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // health-check
  if (!url.searchParams.has("shop")) {
    return json({ ok: true }, { headers: corsHeaders() });
  }

  const shop = url.searchParams.get("shop") || "";
  const gidsRaw = (url.searchParams.get("gids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const productGids = normalizeGids(gidsRaw);

  const dbgInput = { shop, gidsRaw, productGids };

  if (!shop || productGids.length === 0) {
    return json({ offers: [], debug: { ...dbgInput, reason: "no-shop-or-gids" } }, { headers: corsHeaders() });
  }

  const { enriched, debug } = await matchOffers(shop, productGids);
  return json({ offers: enriched, debug: { ...dbgInput, ...debug } }, { headers: corsHeaders() });
}

/* =========================
   Action (POST JSON)
========================= */
export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  let body = {};
  try { body = await request.json(); } catch {}

  const shop = String(body.shop || "");
  const productGids = normalizeGids(body.productGids);
  const dbgInput = { shop, productGids, via: "POST" };

  if (!shop || productGids.length === 0) {
    return json({ offers: [], debug: { ...dbgInput, reason: "no-shop-or-gids" } }, { headers: corsHeaders() });
  }

  const { enriched, debug } = await matchOffers(shop, productGids);
  return json({ offers: enriched, debug: { ...dbgInput, ...debug } }, { headers: corsHeaders() });
}
