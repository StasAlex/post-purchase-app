/* eslint-disable no-console */

// pp-process-polyfill.ts
import {Layout, Separator} from "@shopify/post-purchase-ui-extensions";

export function installProcessPolyfill() {
  const g = globalThis;
  if (typeof g.process === 'undefined') {
    // Минимум, что ждут либы: process.env.NODE_ENV
    g.process = { env: { NODE_ENV: 'production' } };
  } else {
    g.process.env = g.process.env || {};
    if (!('NODE_ENV' in g.process.env)) g.process.env.NODE_ENV = 'production';
  }
}
installProcessPolyfill();

import React, { useState } from "react";
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
  InlineStack,
  Text
} from "@shopify/post-purchase-ui-extensions-react";

function maskToken(t) {
  if (!t) return null;
  return `${t.slice(0, 6)}…${t.slice(-4)} (${t.length})`;
}
function ppLog(tag, payload) {
  try {
    console.log(`[PP] ${tag}`, payload ?? '');
  } catch {}
}
function summarizeInput(inputData) {
  const lines =
    inputData?.initialPurchase?.lineItems ??
    inputData?.initialPurchase?.lines ?? [];
  return {
    referenceId:
      inputData?.referenceId ||
      inputData?.initialPurchase?.referenceId ||
      inputData?.initialPurchase?.id || null,
    shop:
      inputData?.shop?.myshopifyDomain ||
      inputData?.shopDomain ||
      inputData?.shop?.domain || null,
    token: maskToken(inputData?.token || ''),
    linesCount: lines.length,
  };
}

const APP_URL =
  (process.env.APP_URL || process.env.SHOPIFY_APP_URL || (typeof globalThis !== "undefined" ? globalThis.APP_URL : "")) || "";

console.log("[PP] APP_URL baked:", APP_URL); // временно, для проверки

if (!APP_URL) console.warn("[PP] APP_URL is not set. Put APP_URL in .env");

const PLACEHOLDER = "https://cdn.shopify.com/static/images/examples/img-placeholder-1120x1120.png";
const DEBUG = true;

const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$", PLN: "zł", JPY: "¥" };
const uniq = (arr) => Array.from(new Set(arr || []));

function fallbackShopDomain() {
  return (
    process.env.PREVIEW_SHOP ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    process.env.SHOP ||
    process.env.DEV_SHOP ||
    process.env.SHOPIFY_SHOP ||
    globalThis.POST_PURCHASE_SHOP ||
    null
  );
}

const hardPrice = (amount, code) =>
  amount == null || !code ? null : `${CURRENCY_SYMBOL[code] || code}${Number(amount).toFixed(2)}`;

function parsePriceString(s) {
  if (typeof s !== "string") return { amount: null, code: null };
  const amount = Number((s.match(/[\d]+(?:[.,]\d+)?/) || [])[0]?.replace(",", "."));
  const code = (s.match(/[A-Z]{3}/) || [])[0] || null;
  return { amount: Number.isFinite(amount) ? amount : null, code };
}

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

// приведение ответа API к удобному виду для UI
function normalizeOffer(raw) {
  const images =
      Array.isArray(raw.images) && raw.images.length
        ? raw.images
          : (raw.image ? [raw.image] : []);

    const variants = Array.isArray(raw.variants)
      ? raw.variants.map(v => ({
            id: v.id,                       // GID варианта
            title: v.title || "Option",
          priceAmount: v.priceAmount ?? raw.priceAmount ?? null,
          currencyCode: v.currencyCode ?? raw.currencyCode ?? null,
        }))
    : [];

    const variantId = raw.variantId || variants[0]?.id || null; // GID по умолчанию

    return {
      id: raw.id,
      title: raw.title || "Product",
      images,
      image: images[0] || null,
      variants,
      variantId,
      priceAmount: raw.priceAmount ?? null,
      currencyCode: raw.currencyCode ?? null,
      discountPct: Number(raw.discountPct || 0),
    };
}


/* =========================
   ShouldRender — грузим офферы
========================= */
extend("Checkout::PostPurchase::ShouldRender", async ({ storage, inputData }) => {
  ppLog("ShouldRender:init", summarizeInput(inputData));

  const lineItems =
    inputData?.initialPurchase?.lineItems ??
    inputData?.initialPurchase?.lines ?? [];

  const shop =
    inputData?.shop?.myshopifyDomain ||
    inputData?.shopDomain ||
    inputData?.shop?.domain ||
    fallbackShopDomain() ||
    "";

  const referenceId =
    inputData?.referenceId ||
    inputData?.initialPurchase?.referenceId ||
    inputData?.initialPurchase?.id ||
    null;

  const origin =
    inputData?.hop?.origin ||
    inputData?.origin ||
    null;

  const productGids = uniq(lineItems.flatMap(extractProductGidsFromLineItem));

  let offers = [];
  const debug = { shop, lineItemsCount: lineItems.length, productGids, fetch: {}, origin };

  // Даже если productGids пусты (превью), пробуем дернуть сервер — там есть фолбэк
  if (APP_URL && shop) {
    const url = `${APP_URL}/api/funnels/match?shop=${encodeURIComponent(shop)}&gids=${encodeURIComponent(
      (productGids || []).join(","),
    )}`;
    ppLog("ShouldRender:fetch →", { url, gidsCount: productGids.length });

    try {
      const res = await fetch(url, { cache: "no-store", credentials: "omit" });
      debug.fetch.ok = res.ok;
      debug.fetch.status = res.status;
      ppLog("ShouldRender:fetch:status", { ok: res.ok, status: res.status });

      let data = null;
      try { data = await res.json(); } catch (e) { debug.fetch.jsonError = String(e?.message || e); }
      debug.responseKeys = data ? Object.keys(data) : [];
      debug.serverDebug = data?.debug ?? null;

      offers = Array.isArray(data?.offers) ? data.offers.map(normalizeOffer) : [];
      ppLog("ShouldRender:offers:parsed", { count: offers.length });
    } catch (e) {
      debug.fetch.error = String(e?.message || e);
      ppLog("ShouldRender:fetch:error", debug.fetch.error);
    }
  } else {
    ppLog("ShouldRender:skip-fetch", { hasAPP_URL: !!APP_URL, shop });
  }

  try {
    await storage.update({ offers, debugInfo: debug, meta: { shop, referenceId, origin } });
    ppLog("ShouldRender:storage.update", { offers: offers.length });
  } catch (e) {
    ppLog("ShouldRender:storage.error", String(e?.message || e));
  }

  // В деве полезно всё равно отрендерить DebugPanel, даже без офферов
  const isDev = (globalThis?.process?.env?.NODE_ENV !== 'production');
  console.log('isDev', isDev);
  const decision = { render: offers.length > 0 || isDev };
  ppLog("ShouldRender:decision", decision);

  // return decision;
  return { render: true };
});

/* =========================
   Render
========================= */
render("Checkout::PostPurchase::Render", (api) => {
  ppLog("Render:mount", {
    hasApply: typeof api.applyChangeset === "function",
    hasDone: typeof api.done === "function",
  });
  return <App {...api} />;
});

export function App({ storage, inputData, applyChangeset, done }) {
  const initial   = storage?.initialData || {};
  const offers    = Array.isArray(initial.offers) ? initial.offers : [];
  const debugInfo = initial.debugInfo || {};
  const meta      = initial.meta || {};

  const [serverProbe, setServerProbe] = useState(null); // DEBUG only
  const [clientProbe, setClientProbe] = useState(null); // DEBUG only

  const CONTAINER_MAX = 1200;
  const CARD_MIN = 220;
  const CARD_MAX = 300;

  const canApply = typeof applyChangeset === "function";

  const referenceId =
    meta.referenceId ||
    inputData?.referenceId ||
    inputData?.initialPurchase?.referenceId ||
    inputData?.initialPurchase?.id ||
    null;

  const shop =
    meta.shop ||
    inputData?.shop?.myshopifyDomain ||
    inputData?.shopDomain ||
    (inputData?.shop?.domain?.endsWith(".myshopify.com") ? inputData.shop.domain : null) ||
    fallbackShopDomain() ||
    null;

  const token = inputData?.token || null;

  // origin для подписи и для дебага
  const checkoutOrigin =
    meta.origin ||
    inputData?.hop?.origin ||
    inputData?.origin ||
    "https://checkout.shopify.com";

  // ⚠️ Форсим: считаем, что превью-режим не ограничивает нас
  const isPreviewCheckout = false;

  console.log("[PP] ctx", {
    shop,
    referenceId,
    tokenLen: token?.length,
    tokenHead: token?.slice(0, 4),
    checkoutOrigin,
    isPreviewCheckout,
    canApply,
    hasAppUrl: !!APP_URL,
  });

  ppLog("Render:ctx", {
    shop,
    referenceId,
    token: maskToken(token),
    checkoutOrigin,
    offersCount: offers.length,
    offers: offers
  });

  async function addVariantToOrder(variantIdRaw, quantity = 1) {
    const vid =
      typeof variantIdRaw === "number" ? variantIdRaw : Number(String(variantIdRaw ?? "").match(/\d+$/)?.[0]);

    ppLog("Add:start", { raw: variantIdRaw, parsed: vid });

    if (!Number.isFinite(vid)) {
      ppLog("Add:bad-variant", variantIdRaw);
      return;
    }
    if (!APP_URL) {
      ppLog("Add:no-APP_URL", null);
      return;
    }
    if (!token || !referenceId || !shop) {
      ppLog("Add:missing-input", { hasToken: !!token, referenceId, shop });
      return;
    }

    const changes = [{ type: "add_variant", variant_id: vid, quantity: Math.max(1, Number(quantity) || 1) }];


    try {
      ppLog("Add:sign:request", { url: `${APP_URL}/api/postpurchase/sign`, shop, referenceId, checkoutOrigin });
      const res = await fetch(`${APP_URL}/api/postpurchase/sign`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ shop, referenceId, changes, checkoutOrigin }),
      });

      const raw = await res.text();
      let payload;
      try { payload = JSON.parse(raw); } catch { payload = { raw }; }

      ppLog("Add:sign:response", { ok: res.ok, status: res.status, hasChangeset: !!payload?.changeset });
      ppLog("Add:sign:payload", payload);     // <— ключевая строка

      if (!res.ok) {
        setServerProbe({ when: Date.now(), status: res.status, payload });
        return;
      }

      const changeset = payload?.changeset;
      if (!changeset) {
        setServerProbe({ when: Date.now(), status: 200, payload: { error: "no_changeset_token_in_response" } });
        return;
      }

      if (!canApply) {
        ppLog("Add:apply:skipped-no-applyChangeset", null);
        return;
      }

      const result = await applyChangeset(changeset);
      ppLog("Add:apply:result", result);
      if (result?.status === "ACCEPTED" && typeof done === "function") await done();
    } catch (e) {
      setServerProbe({ when: Date.now(), error: String(e?.message || e) });
      ppLog("Add:error", String(e?.message || e));
    }
  }

  // --- DEBUG only: прямой вызов calculate с клиента (чтобы понять, падает ли апстрим сам по себе)
  async function probeClientCalculate(vid) {
    try {
      const res = await fetch(`/checkouts/${referenceId}/changesets/calculate.json`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ changes: [{ type: "add_variant", variant_id: vid, quantity: 1 }] }),
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      setClientProbe({ when: Date.now(), status: res.status, data, raw: text.slice(0, 400) });
      console.log("[PP] client calc →", res.status, data || text);
    } catch (e) {
      setClientProbe({ when: Date.now(), error: String(e?.message || e) });
    }
  }

  return (
    <View spacing="loose">
      <Layout maxInlineSize="900" sizes={['fill']}>
        <BlockStack spacing="xloose">
          <View />
          <View >
          <Tiles alignment="leading">
            {offers.map((offer, i) => (
              <OfferCard
                offer={offer}
                onAdd={(vid, qty) => addVariantToOrder(vid, qty)}
                onDecline={done}
                disabled={!token}
              />
            ))}
          </Tiles>
        </View>
          <View />
        </BlockStack>
      </Layout>
      {/*{(DEBUG || offers.length === 0) ? (*/}
      {/*  <DebugPanel*/}
      {/*    debugInfo={debugInfo}*/}
      {/*    offersCount={offers.length}*/}
      {/*    extra={{*/}
      {/*      referenceId,*/}
      {/*      checkoutOrigin,*/}
      {/*      canApply,*/}
      {/*      isPreviewCheckout,*/}
      {/*      hasAppUrl: !!APP_URL,*/}
      {/*      tokenLen: token?.length || 0,*/}
      {/*      tokenHead: token?.slice(0, 6) || "",*/}
      {/*      serverProbe,*/}
      {/*      clientProbe,*/}
      {/*    }}*/}
      {/*  />*/}
      {/*) : null}*/}
    </View>
  );
}

function OfferCard({ offer, onAdd, onDecline, disabled }) {
  const images = Array.isArray(offer?.images) && offer.images.length
    ? offer.images
    : (offer?.image ? [offer.image] : [PLACEHOLDER]);

  const [activeImg, setActiveImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState(offer?.variantId || offer?.variants?.[0]?.id || null);

  const variants = Array.isArray(offer?.variants) ? offer.variants : [];
  const current = variants.find(v => v.id === selected) || variants[0] || null;

  const amount = current?.priceAmount ?? offer?.priceAmount ?? null;
  const code   = current?.currencyCode ?? offer?.currencyCode ?? null;

  const baseStr      = amount != null ? hardPrice(amount, code) : null;
  const discountPct  = Number(offer?.discountPct || 0);
  const discounted   = amount != null ? amount * (1 - discountPct / 100) : null;
  const discountedStr= discounted != null ? hardPrice(discounted, code) : null;
  const subtotal     = discounted != null ? discounted * qty : null;
  const subtotalStr  = subtotal != null ? hardPrice(subtotal, code) : null;

  const strike = (s = "") => s.split("").map(ch => ch + "\u0336").join("");

  console.log('offer', offer);
  console.log('baseStr', baseStr);
  return (
    <BlockStack spacing="xloose">
      {/* Верхняя плашка со скидкой */}
      {discountPct > 0 ? (
        <View marginBlockStart="base">
          <Layout blockAlignment="center">
            <View blockSize="100px" />
            <Heading> {`We have offer for you with ${discountPct}% discount`}</Heading>
          </Layout>
        </View>

      ) : null}
      {/* двухколоночный блок: слева галерея, справа детали */}
      <Tiles maxPerLine={2}>
        {/* Галерея */}
        <View>
          <Image source={images[Math.min(activeImg, images.length - 1)]} aspectRatio={1} fit="contain" />
          {images.length > 1 ? (
            <View padding="tight">
              <Tiles maxPerLine={6} spacing="tight">
                {images.map((src, i) => (
                  <View
                    key={i}
                    border={i === activeImg ? "emphasized" : "base"}
                    cornerRadius="large"
                    padding="tight"
                    onPress={() => setActiveImg(i)}
                  >
                    <Image source={src} aspectRatio={1} fit="contain" />
                  </View>
                ))}
              </Tiles>
            </View>
          ) : null}
        </View>

        {/* Детали */}
        <View>
          <BlockStack spacing="base">
            <Heading>{offer?.title || "Product name"}</Heading>

            <View>
              {discountPct > 0 && discounted != null && amount != null && discounted < amount ? (
                <View>
                  <InlineStack spacing="loose">
                    <Text size="xlarge" appearance="subdued">
                      {strike(baseStr)}
                    </Text>
                    <Text size="xlarge" appearance="critical" emphasis="bold">
                      {discountedStr}
                    </Text>
                  </InlineStack>
                </View>
              ) : (
                <TextBlock emphasis="bold">{baseStr || "—"}</TextBlock>
              )}
            </View>

            {/* Кол-во и варианты */}
            <Tiles spacing="base">
              <View>
                <BlockStack spacing="base">
                  <TextBlock>Quantity:</TextBlock>
                  <InlineStack spacing="tight" alignment="center">
                    <Button subdued="true" onPress={() => setQty(q => Math.max(1, q - 1))}>−</Button>
                    <View padding="base"><TextBlock>{qty}</TextBlock></View>
                    <Button subdued="true" onPress={() => setQty(q => Math.min(99, q + 1))}>+</Button>
                  </InlineStack>
                </BlockStack>
              </View>

              {variants.length > 1 ? (
                <View>
                  <TextBlock size="small">Variant:</TextBlock>
                  <Tiles maxPerLine={3} spacing="tight">
                    {variants.map(v => (
                      <Button
                        key={v.id}
                        kind={v.id === selected ? "primary" : "secondary"}
                        onPress={() => setSelected(v.id)}
                      >
                        {v.title || "Option"}
                      </Button>
                    ))}
                  </Tiles>
                </View>
              ) : null}
            </Tiles>

            <Separator/>

            {/* Totals */}
            <View>
              <Tiles maxPerLine={2} spacing="tight">
                <TextBlock appearance="subdued">Subtotal</TextBlock>
                <TextBlock>{subtotalStr || "—"}</TextBlock>
                <TextBlock appearance="subdued">Shipping</TextBlock>
                <TextBlock>Free</TextBlock>
              </Tiles>
            </View>

            <Separator/>

            <View>
              <Tiles maxPerLine={2} spacing="tight">
                <TextBlock emphasis="bold">Total</TextBlock>
                <TextBlock emphasis="bold">{subtotalStr || "—"}</TextBlock>
              </Tiles>
            </View>

            {/* Кнопки */}
            <Button appearance="subdued" onPress={() => onAdd(selected, qty)} disabled={disabled}>
              {subtotalStr ? `Pay now ${subtotalStr}` : "Pay now"}
            </Button>
            <Button subdued="true" onPress={onDecline}>Decline this offer</Button>
          </BlockStack>
        </View>
      </Tiles>
    </BlockStack>
  );
}

function DebugPanel({ debugInfo, offersCount, extra = {} }) {
  const sx = (v) => (v == null ? "-" : String(v));

  return (
    <View>
      <BlockStack spacing="tight">
        <TextContainer>
          <Heading>Debug</Heading>

          <TextBlock>offersCount: {offersCount}</TextBlock>
          <TextBlock>shop: {debugInfo?.shop || "-"}</TextBlock>
          <TextBlock>origin: {debugInfo?.origin || extra.checkoutOrigin || "-"}</TextBlock>
          <TextBlock>lineItemsCount: {String(debugInfo?.lineItemsCount ?? 0)}</TextBlock>
          <TextBlock>productGids: {JSON.stringify(debugInfo?.productGids || [])}</TextBlock>

          <TextBlock>
            flags: canApply={String(extra.canApply)} preview={String(extra.isPreviewCheckout)} hasAPP_URL={String(extra.hasAppUrl)}
          </TextBlock>
          <TextBlock>
            referenceId: {sx(extra.referenceId)} | tokenLen: {sx(extra.tokenLen)} | tokenHead: {sx(extra.tokenHead)}
          </TextBlock>

          <TextBlock>
            fetch: ok={String(debugInfo?.fetch?.ok)} status={String(debugInfo?.fetch?.status)} err={debugInfo?.fetch?.error || "none"}
          </TextBlock>
          {debugInfo?.fetch?.jsonError ? <TextBlock>jsonError: {debugInfo.fetch.jsonError}</TextBlock> : null}
          <TextBlock>responseKeys: {JSON.stringify(debugInfo?.responseKeys || [])}</TextBlock>
          <TextBlock>serverDebug: {JSON.stringify(debugInfo?.serverDebug || null)}</TextBlock>

          {extra.serverProbe ? (
            <TextBlock>
              serverProbe:
              {" status=" + extra.serverProbe.status}
              {" error=" + (extra.serverProbe.payload?.error || "-")}
              {" tried=" + (extra.serverProbe.payload?.tried?.[0] || "-")}
              {" reqId=" + (extra.serverProbe.payload?.requestId || "-")}
              {" raw=" + (extra.serverProbe.payload?.raw || "").slice(0,300)}
            </TextBlock>
          ) : null}
          {extra.clientProbe ? (
            <TextBlock>
              clientProbe: {JSON.stringify(extra.clientProbe)}
            </TextBlock>
          ) : null}
        </TextContainer>
      </BlockStack>
    </View>
  );
}
