/* eslint-disable no-console */
import {
  extend,
  render,
  BlockStack,
  Button,
  CalloutBanner,
  Heading,
  Image,
  TextBlock,
  TextContainer,
  View,
  Tiles,
} from "@shopify/post-purchase-ui-extensions-react";

const APP_URL = process.env.APP_URL;
if (!APP_URL) console.warn("[PP] APP_URL is not set. Put APP_URL in .env");

const PLACEHOLDER =
  "https://cdn.shopify.com/static/images/examples/img-placeholder-1120x1120.png";
const DEBUG = true;

const CURRENCY_SYMBOL = {
  UAH: "₴",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  PLN: "zł",
  JPY: "¥",
};
const uniq = (arr) => Array.from(new Set(arr || []));

function hardPrice(amount, code) {
  return amount == null || !code
    ? null
    : `${CURRENCY_SYMBOL[code] || code}${Number(amount).toFixed(2)}`;
}
function parsePriceString(s) {
  if (typeof s !== "string") return { amount: null, code: null };
  const amount = Number(
    (s.match(/[\d]+(?:[.,]\d+)?/) || [])[0]?.replace(",", "."),
  );
  const code = (s.match(/[A-Z]{3}/) || [])[0] || null;
  return { amount: Number.isFinite(amount) ? amount : null, code };
}
function extractProductGidsFromLineItem(li) {
  const out = [];
  try {
    if (li?.product?.id) out.push(li.product.id);
    if (li?.variant?.product?.id) out.push(li.variant.product.id);
    if (li?.merchandise?.product?.id) out.push(li.merchandise.product.id);
    if (typeof li?.productID === "string" && li.productID.startsWith("gid://"))
      out.push(li.productID);
    if (typeof li?.productID === "number")
      out.push(`gid://shopify/Product/${li.productID}`);

    const s = JSON.stringify(li);
    out.push(...(s.match(/gid:\/\/shopify\/Product\/\d+/g) ?? []));

    const num1 = s.match(/"productId"\s*:\s*(\d+)/i)?.[1];
    const num2 = s.match(/"product_id"\s*:\s*(\d+)/i)?.[1];
    if (num1) out.push(`gid://shopify/Product/${num1}`);
    if (num2) out.push(`gid://shopify/Product/${num2}`);
  } catch {}
  return uniq(out);
}

/* =========================
   ShouldRender — подгружаем офферы и сохраняем meta
========================= */
extend("Checkout::PostPurchase::ShouldRender", async ({ storage, inputData }) => {
  const lineItems =
    inputData?.initialPurchase?.lineItems ??
    inputData?.initialPurchase?.lines ??
    [];

  // shop на этом этапе обычно есть
  const shop =
    inputData?.shop?.myshopifyDomain ||
    inputData?.shopDomain ||
    inputData?.shop?.domain ||
    "";

  // referenceId может лежать в нескольких местах
  const referenceId =
    inputData?.referenceId ||
    inputData?.initialPurchase?.referenceId ||
    inputData?.initialPurchase?.id ||
    null;

  const productGids = uniq(lineItems.flatMap(extractProductGidsFromLineItem));

  let offers = [];
  const debug = {
    shop,
    lineItemsCount: lineItems.length,
    productGids,
    fetch: {},
  };

  if (APP_URL && shop && productGids.length) {
    try {
      const url = `${APP_URL}/api/funnels/match?shop=${encodeURIComponent(
        shop,
      )}&gids=${encodeURIComponent(productGids.join(","))}`;
      const res = await fetch(url, { cache: "no-store", credentials: "omit" });
      debug.fetch.ok = res.ok;
      debug.fetch.status = res.status;

      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        debug.fetch.jsonError = String(e?.message || e);
      }

      debug.responseKeys = data ? Object.keys(data) : [];
      debug.serverDebug = data?.debug ?? null;

      offers = Array.isArray(data?.offers)
        ? data.offers.map((o) => {
          const parsed =
            typeof o.price === "string"
              ? parsePriceString(o.price)
              : { amount: null, code: null };
          const amount = o.priceAmount ?? parsed.amount;
          const code = o.currencyCode ?? parsed.code;
          const price = hardPrice(amount, code) || o.price || null;
          return { ...o, price };
        })
        : [];
    } catch (e) {
      debug.fetch.error = String(e?.message || e);
    }
  }

  // сохраняем ещё meta, чтобы Render не гадал
  await storage.update({
    offers,
    debugInfo: debug,
    meta: { shop, referenceId },
  });

  return { render: offers.length > 0 };
});

/* =========================
   Render — сетка и добавление
========================= */
render("Checkout::PostPurchase::Render", App);

export function App({ storage, inputData, applyChangeset, done }) {
  const initial = storage?.initialData || {};
  const offers = Array.isArray(initial.offers) ? initial.offers : [];
  const debugInfo = initial.debugInfo || {};
  const meta = initial.meta || {};

  const CONTAINER_MAX = 1200;
  const CARD_MIN = 220;
  const CARD_MAX = 300;

  const canApply = typeof applyChangeset === "function";

  // Надёжно восстанавливаем referenceId + shop
  const referenceId =
    meta.referenceId ||
    inputData?.referenceId ||
    inputData?.initialPurchase?.referenceId ||
    inputData?.initialPurchase?.id ||
    null;

  console.log('inputData', inputData)

  const shop =
        meta.shop ||
        inputData?.shop?.myshopifyDomain ||
        inputData?.shopDomain ||
        (inputData?.shop?.domain?.endsWith('.myshopify.com') ? inputData.shop.domain : null) ||
       null;


  const token = inputData?.token || null;

  async function addVariantToOrder(variantId) {
    if (!variantId) {
      console.warn("[PP] No variantId on offer");
      return;
    }
    if (!APP_URL) {
      console.warn("[PP] APP_URL is not set, cannot sign changeset");
      return;
    }
    if (!token || !referenceId || !shop) {
      console.warn("[PP] Missing token/referenceId/shop in inputData", {
        hasToken: !!token,
        referenceId,
        shop,
      });
      return;
    }

    const changes = [{ type: "add_variant", variantId, quantity: 1 }];

    try {
      // 1) просим наш сервер подписать changeset
      const res = await fetch(`${APP_URL}/api/postpurchase/sign`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`, // обязательно!
        },
        body: JSON.stringify({
          shop, // your-store.myshopify.com
          referenceId,
          changes,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[PP] sign failed", { status: res.status, payload });
        return;
      }

      const changeset = payload?.changeset;
      if (!changeset) {
        console.error("[PP] no changeset token from server", payload);
        return;
      }

      // 2) применяем changeset
      if (!canApply) {
        console.warn(
          "[PP] applyChangeset not available in this preview. Place a test order to try.",
        );
        return;
      }

      const result = await applyChangeset(changeset);
      console.log("[PP] applyChangeset →", result);

      if (result?.status === "ACCEPTED" && typeof done === "function") {
        await done();
      }
    } catch (e) {
      console.error("[PP] addVariantToOrder error:", e);
    }
  }

  return (
    <BlockStack spacing="loose">
      {!APP_URL && (
        <CalloutBanner title="APP_URL is not set" status="critical">
          Set APP_URL in your .env so the extension can sign changesets.
        </CalloutBanner>
      )}

      {!canApply && (
        <CalloutBanner title="Preview mode" status="info">
          Adding to order is disabled in this preview. Place a test order to try.
        </CalloutBanner>
      )}

      <View inlineSize="fill" maxInlineSize={CONTAINER_MAX} padding="base">
        <Tiles maxPerLine={5} spacing="base" align="center">
          {offers.map((offer, i) => (
            <View
              key={offer.id || i}
              minInlineSize={CARD_MIN}
              maxInlineSize={CARD_MAX}
              padding="base"
            >
              <OfferCard
                offer={offer}
                onAdd={() => addVariantToOrder(offer?.variantId)}
                disabled={!canApply}
              />
            </View>
          ))}
        </Tiles>
      </View>

      {(DEBUG || offers.length === 0) ? (
        <DebugPanel debugInfo={debugInfo} offersCount={offers.length} />
      ) : null}
    </BlockStack>
  );
}

function OfferCard({ offer, onAdd, disabled }) {
  const img = offer?.image || PLACEHOLDER;
  const title = offer?.title || "Product";
  const price = offer?.price || null;

  return (
    <View border="base" cornerRadius="large" padding="base">
      <BlockStack spacing="tight">
        <Image source={img} aspectRatio={2 / 3} fit="contain" />
        <TextContainer>
          <Heading>{title}</Heading>
          {price ? <TextBlock>{price}</TextBlock> : null}
        </TextContainer>
        <Button disabled={disabled} onPress={onAdd}>
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
          <TextBlock>
            lineItemsCount: {String(debugInfo?.lineItemsCount ?? 0)}
          </TextBlock>
          <TextBlock>
            productGids: {JSON.stringify(debugInfo?.productGids || [])}
          </TextBlock>
          <TextBlock>
            fetch: ok={String(debugInfo?.fetch?.ok)} status=
            {String(debugInfo?.fetch?.status)} err=
            {debugInfo?.fetch?.error || "none"}
          </TextBlock>
          {debugInfo?.fetch?.jsonError ? (
            <TextBlock>jsonError: {debugInfo.fetch.jsonError}</TextBlock>
          ) : null}
          <TextBlock>
            responseKeys: {JSON.stringify(debugInfo?.responseKeys || [])}
          </TextBlock>
          <TextBlock>
            serverDebug: {JSON.stringify(debugInfo?.serverDebug || null)}
          </TextBlock>
        </TextContainer>
      </BlockStack>
    </View>
  );
}
