/* eslint-disable no-console */
import {
  extend, render,
  BlockStack, Button, CalloutBanner, Heading, Image,
  Layout, TextBlock, TextContainer, View,
} from "@shopify/post-purchase-ui-extensions-react";

/** !!! ЗАМЕНИ на свой публичный URL (ngrok / домен с вашим Remix) */
const API_BASE = "https://418f496cfdfd.ngrok-free.app";

const PLACEHOLDER = "https://cdn.shopify.com/static/images/examples/img-placeholder-1120x1120.png";
const MAX_COLS = 3;
const DEBUG = true;

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

extend("Checkout::PostPurchase::ShouldRender", async ({ storage, inputData }) => {
  console.group("[PP] ShouldRender");

  const lineItems =
    inputData?.initialPurchase?.lineItems ??
    inputData?.initialPurchase?.lines ?? [];

  console.log("lineItems:", lineItems);

  const productGids = uniq(lineItems.flatMap(extractProductGidsFromLineItem));
  const shop =
    inputData?.shopDomain || inputData?.shop?.domain || inputData?.shop?.myshopifyDomain || "";

  console.log("shop:", shop);
  console.log("productGids:", productGids);

  let offers = [];
  const debug = {
    shop,
    lineItemsCount: lineItems.length,
    productGids,
    fetch: {},
  };

  if (shop && productGids.length) {
    try {
      // GET без префлайта
      const url = `${API_BASE}/api/funnels/match?shop=${encodeURIComponent(shop)}&gids=${encodeURIComponent(productGids.join(","))}`;
      console.log("GET:", url);

      const res = await fetch(url, { cache: "no-store", credentials: "omit" });
      debug.fetch.ok = res.ok;
      debug.fetch.status = res.status;

      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        debug.fetch.jsonError = String(e?.message || e);
      }

      console.log("response data:", data);
      debug.responseKeys = data ? Object.keys(data) : [];
      debug.serverDebug = data?.debug ?? null;

      offers = Array.isArray(data?.offers) ? data.offers : [];
    } catch (e) {
      debug.fetch.error = String(e?.message || e);
      console.error("[PP] fetch error:", e);
    }
  }

  console.log("offers:", offers);
  console.groupEnd();

  await storage.update({ offers, debugInfo: debug });
  return { render: offers.length > 0 };
});

render("Checkout::PostPurchase::Render", App);

export function App({ storage }) {
  const initial = storage?.initialData || {};
  const offers = Array.isArray(initial.offers) ? initial.offers : [];
  const debugInfo = initial.debugInfo || {};

  // Разбивка на строки по MAX_COLS
  const rows = offers.reduce(
    (rows, _, i) => (i % MAX_COLS ? rows : [...rows, offers.slice(i, i + MAX_COLS)]),
    []
  );

  return (
    <BlockStack spacing="loose">
      <CalloutBanner title="Special offer just for you!" />
      {rows.map((row, idx) => {
        const lg = Math.min(row.length, MAX_COLS);
        const md = Math.min(row.length, 2);
        return (
          <Layout
            key={idx}
            media={[
              { viewportSize: "small",  sizes: [1] },
              { viewportSize: "medium", sizes: Array(md).fill(1) },
              { viewportSize: "large",  sizes: Array(lg).fill(1) },
            ]}
          >
            {row.map((offer, j) => (
              <View key={offer.id || j}>
                <OfferCard offer={offer} />
              </View>
            ))}
          </Layout>
        );
      })}

      {(DEBUG || offers.length === 0) ? (
        <DebugPanel debugInfo={debugInfo} offersCount={offers.length} />
      ) : null}
    </BlockStack>
  );
}

function OfferCard({ offer }) {
  const img = offer?.image || PLACEHOLDER;
  const title = offer?.title || "Product";
  const price = offer?.price || null;

  return (
    <View>
      <BlockStack spacing="tight">
        <Image source={img} />
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
