/* eslint-disable no-console */
import {
  extend, render,
  BlockStack, Button, CalloutBanner, Heading, Image,
  TextBlock, TextContainer, View, Layout
} from "@shopify/post-purchase-ui-extensions-react";

const API_BASE = "https://418f496cfdfd.ngrok-free.app";

const PLACEHOLDER = "https://cdn.shopify.com/static/images/examples/img-placeholder-1120x1120.png";
const DEBUG = true;

const CURRENCY_SYMBOL = { UAH:"₴", USD:"$", EUR:"€", GBP:"£", CAD:"CA$", AUD:"A$", PLN:"zł", JPY:"¥" };

const uniq = (arr) => Array.from(new Set(arr));

function extractProductGidsFromLineItem(li) {
  const out = [];
  try {
    if (li?.product?.id) out.push(li.product.id);
    if (li?.variant?.product?.id) out.push(li.variant.product.id);
    if (li?.merchandise?.product?.id) out.push(li.merchandise.product.id);
    if (typeof li?.productID === "string" && li.productID.startsWith("gid://")) out.push(li.productID);
    if (typeof li?.productID === "number") out.push(`gid://shopify/Product/${li.productID}`);
    const s = JSON.stringify(li);
    out.push(...(s.match(/gid:\/\/shopify\/Product\/\d+/g) ?? []));
    const num1 = s.match(/"productId"\s*:\s*(\d+)/i)?.[1];
    const num2 = s.match(/"product_id"\s*:\s*(\d+)/i)?.[1];
    if (num1) out.push(`gid://shopify/Product/${num1}`);
    if (num2) out.push(`gid://shopify/Product/${num2}`);
  } catch {}
  return uniq(out);
}

function parsePriceString(s) {
  if (typeof s !== "string") return { amount: null, code: null };
  const amount = Number((s.match(/[\d]+(?:[.,]\d+)?/) || [])[0]?.replace(",", "."));
  const code = (s.match(/[A-Z]{3}/) || [])[0] || null;
  return { amount: Number.isFinite(amount) ? amount : null, code };
}

const hardPrice = (amount, code) =>
  (amount == null || !code) ? null : `${(CURRENCY_SYMBOL[code] || code)}${Number(amount).toFixed(2)}`;

/* =========================
   ShouldRender
========================= */
extend("Checkout::PostPurchase::ShouldRender", async ({ storage, inputData }) => {
  const lineItems =
    inputData?.initialPurchase?.lineItems ??
    inputData?.initialPurchase?.lines ?? [];

  const productGids = uniq(lineItems.flatMap(extractProductGidsFromLineItem));
  const shop =
    inputData?.shopDomain || inputData?.shop?.domain || inputData?.shop?.myshopifyDomain || "";

  let offers = [];
  const debug = { shop, lineItemsCount: lineItems.length, productGids, fetch: {} };

  console.log("[PP] ShouldRender → input", { shop, productGids, lineItemsCount: lineItems.length });

  if (shop && productGids.length) {
    try {
      const url = `${API_BASE}/api/funnels/match?shop=${encodeURIComponent(shop)}&gids=${encodeURIComponent(productGids.join(","))}`;
      console.log("[PP] fetch", url);

      const res = await fetch(url, { cache: "no-store", credentials: "omit" });
      debug.fetch.ok = res.ok;
      debug.fetch.status = res.status;

      let data = null;
      try { data = await res.json(); } catch (e) { debug.fetch.jsonError = String(e?.message || e); }

      debug.responseKeys = data ? Object.keys(data) : [];
      debug.serverDebug = data?.debug ?? null;

      offers = Array.isArray(data?.offers)
        ? data.offers.map((o, idx) => {
          const parsed = typeof o.price === "string" ? parsePriceString(o.price) : { amount: null, code: null };
          const amount = o.priceAmount ?? parsed.amount;
          const code   = o.currencyCode ?? parsed.code;
          const price  = hardPrice(amount, code) || o.price || null;
          const out = { ...o, price };
          console.log(`[PP] offer#${idx}`, out);
          return out;
        })
        : [];
    } catch (e) {
      debug.fetch.error = String(e?.message || e);
      console.warn("[PP] fetch error:", e);
    }
  }

  console.log("[PP] ShouldRender → normalized offers:", offers.length);

  await storage.update({ offers, debugInfo: debug });
  return { render: offers.length > 0 };
});

/* =========================
   Render
========================= */
render("Checkout::PostPurchase::Render", App);

const MAX_COLS_SM = 2;
const MAX_COLS_MD = 3;
const MAX_COLS_LG = 5;
const CONTAINER_MAX = 1200;

const chunk = (arr, n) =>
  arr.reduce((rows, _, i) => (i % n ? rows : [...rows, arr.slice(i, i + n)]), []);

render("Checkout::PostPurchase::Render", App);

export function App({ storage }) {
  const initial   = storage?.initialData || {};
  const offers    = Array.isArray(initial.offers) ? initial.offers : [];
  const debugInfo = initial.debugInfo || {};

  const rows = chunk(offers, MAX_COLS_LG);

  console.log("[PP] GRID → total offers:", offers.length, "rows:", rows.length);
  rows.forEach((row, i) => {
    const sizesSm = Array(Math.min(row.length, MAX_COLS_SM)).fill(1);
    const sizesMd = Array(Math.min(row.length, MAX_COLS_MD)).fill(1);
    const sizesLg = Array(Math.min(row.length, MAX_COLS_LG)).fill(1);
    console.log(`[PP] row#${i}`, {
      rowLen: row.length,
      sizes: { small: sizesSm.length, medium: sizesMd.length, large: sizesLg.length },
    });
  });

  return (
    <BlockStack spacing="loose" alignment="center">
      <CalloutBanner title="Special offer just for you!"  />

      <View maxInlineSize={CONTAINER_MAX} padding="base">
        {rows.map((row, idx) => {
          const sizesSm = Array(Math.min(row.length, MAX_COLS_SM)).fill(1);
          const sizesMd = Array(Math.min(row.length, MAX_COLS_MD)).fill(1);
          const sizesLg = Array(Math.min(row.length, MAX_COLS_LG)).fill(1);

          return (
            <Layout
              key={idx}
              media={[
                { viewportSize: "small",  sizes: sizesSm },
                { viewportSize: "medium", sizes: sizesMd },
                { viewportSize: "large",  sizes: sizesLg },
              ]}
            >
              {row.map((offer, j) => (
                // «гаттеры» — через внутренний padding
                <View key={offer.id || j} padding="base">
                  <OfferCard offer={offer} index={`${idx}:${j}`} />
                </View>
              ))}
            </Layout>
          );
        })}
      </View>

      {(DEBUG || offers.length === 0) ? (
        <DebugPanel debugInfo={debugInfo} offersCount={offers.length} />
      ) : null}
    </BlockStack>
  );
}

// необязательно, но удобно видеть, что рисуем
function OfferCard({ offer, index }) {
  const img   = offer?.image || PLACEHOLDER;
  const title = offer?.title || "Product";
  const price = offer?.price || null;

  console.log(`[PP] render card ${index}`, { title, price, hasImage: Boolean(offer?.image) });

  return (
    <View border="base" cornerRadius="large" padding="base">
      <BlockStack spacing="tight">
        <Image source={img} aspectRatio={2/3} fit="contain" />
        <TextContainer>
          <Heading>{title}</Heading>
          {price ? <TextBlock>{price}</TextBlock> : null}
        </TextContainer>
        <Button submit onPress={() => console.log("Add to order:", offer)}>
          Add to order
        </Button>
      </BlockStack>
    </View>
  );
}

function DebugPanel({ debugInfo, offersCount }) {
  return (
    <View>
      <BlockStack spacing="tight">
        <TextContainer>
          <Heading>Debug</Heading>
          <TextBlock>offersCount: {offersCount}</TextBlock>
          <TextBlock>shop: {debugInfo?.shop || "-"}</TextBlock>
          <TextBlock>lineItemsCount: {String(debugInfo?.lineItemsCount ?? 0)}</TextBlock>
          <TextBlock>productGids: {JSON.stringify(debugInfo?.productGids || [])}</TextBlock>
          <TextBlock>
            fetch: ok={String(debugInfo?.fetch?.ok)} status={String(debugInfo?.fetch?.status)} err={debugInfo?.fetch?.error || "none"}
          </TextBlock>
          {debugInfo?.fetch?.jsonError ? <TextBlock>jsonError: {debugInfo.fetch.jsonError}</TextBlock> : null}
          <TextBlock>responseKeys: {JSON.stringify(debugInfo?.responseKeys || [])}</TextBlock>
          <TextBlock>serverDebug: {JSON.stringify(debugInfo?.serverDebug || null)}</TextBlock>
        </TextContainer>
      </BlockStack>
    </View>
  );
}
