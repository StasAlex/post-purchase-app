// app/routes/app.funnels.new.jsx
import { json, redirect } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useLocation,
} from "@remix-run/react";
import { useEffect, useState, useCallback } from "react";
import * as AppBridgeReact from "@shopify/app-bridge-react";
import {
  Page,
  Card,
  TextField,
  Button,
  InlineStack,
  BlockStack,
  ResourceList,
  ResourceItem,
  Text,
  Banner,
  Thumbnail,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { prisma } from "../lib/prisma.server";

const { useAppBridge } = AppBridgeReact;
// маленький серый плейсхолдер 64x64
const NO_IMAGE =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="100%" height="100%" fill="%23f6f6f7"/><g fill="%23c4cdd5"><circle cx="22" cy="24" r="6"/><path d="M8 48l14-14 10 10 6-6 18 18z"/></g></svg>';


/* ========= loader / action ========= */
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  return json({ shopDomain: session.shop });
}

export async function action({ request }) {
  const form = await request.formData();

  const name = String(form.get("name") || "").trim();
  const discountPct = Number(form.get("discountPct") || 0);
  const shopDomain = String(form.get("shopDomain") || "");
  const triggers = JSON.parse(String(form.get("triggers") || "[]"));
  const offers = JSON.parse(String(form.get("offers") || "[]"));

  if (!name) {
    return json({ ok: false, error: "Заполните поле Name." }, { status: 422 });
  }
  if (!Number.isFinite(discountPct) || discountPct <= 0) {
    return json(
      { ok: false, error: "Discount % должен быть числом больше 0." },
      { status: 422 },
    );
  }
  if (!shopDomain) {
    return json({ ok: false, error: "Не определён shopDomain." }, { status: 422 });
  }
  if (!Array.isArray(triggers) || triggers.length === 0) {
    return json(
      { ok: false, error: "Выберите хотя бы один Trigger product." },
      { status: 422 },
    );
  }
  if (!Array.isArray(offers) || offers.length === 0) {
    return json(
      { ok: false, error: "Выберите хотя бы один Offered product." },
      { status: 422 },
    );
  }

  await prisma.funnel.create({
    data: {
      name,
      discountPct,
      shopDomain,
      triggers: { create: triggers.map((gid) => ({ productGid: gid })) },
      offers:   { create: offers.map((gid, i) => ({ productGid: gid, sort: i })) },
    },
  });

  return redirect("/app/funnels");
}

/* ========= SSR-safe оболочка ========= */
export default function FunnelCreateRoute() {
  const { shopDomain } = useLoaderData();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  if (!hydrated) {
    return (
      <Page title="Create funnel">
        <Card>
          <Text as="p" variant="bodyMd">Loading…</Text>
        </Card>
      </Page>
    );
  }

  return <FunnelCreateClient shopDomain={shopDomain} />;
}

/* ========= Клиентский компонент ========= */
function FunnelCreateClient({ shopDomain }) {
  const nav = useNavigate();
  const { search } = useLocation();
  const app = useAppBridge();       // App Bridge v4
  const fetcher = useFetcher();

  // Теперь храним полные сведения о товаре
  /** @type {[Array<{id:string,title?:string,image?:string}>, Function]} */
  const [triggers, setTriggers] = useState([]);
  const [offers, setOffers] = useState([]);
  const [name, setName] = useState("");
  const [discountPct, setDiscountPct] = useState("20");
  const [uiError, setUiError] = useState("");
  // аккуратно достаём title / image из разных возможных полей
  const toPicked = (p) => ({
    id: p.id,
    title:
      p.title ??
      p.name ??
      p.handle ??
      "Untitled product",
    image:
      p.featuredImage?.url ??
      p.featuredImage?.originalSrc ??
      p.images?.[0]?.url ??
      p.images?.[0]?.originalSrc ??
      p.image?.url ??
      p.image?.originalSrc ??
      undefined,
  });

  // App Bridge v4 — удобный helper
  const openProductPicker = useCallback(
    async (multiple = true) => {
      const res = await app.resourcePicker({
        type: "product",
        multiple,
      });
      return res?.selection ?? [];
    },
    [app],
  );

  const pickTriggers = async () => {
    const sel = await openProductPicker(true, triggers.map(p => ({ id: p.id, variantIds: p.variantIds })));
    setTriggers(sel.map(p => toPicked(p, 'trigger')));
  };
  const pickOffers = async () => {
    const sel = await openProductPicker(true, offers.map(p => ({ id: p.id, variantIds: p.variantIds })));
    setOffers(sel.map(p => toPicked(p, 'offer')));
  };

  const invalid =
    !name.trim() ||
    !Number(discountPct) ||
    triggers.length === 0 ||
    offers.length === 0;

  const save = () => {
    const fd = new FormData();
    fd.set("name", name);
    fd.set("discountPct", discountPct);
    fd.set("shopDomain", shopDomain);
    fd.set("triggers", JSON.stringify(triggers.map((p) => p.id)));
    fd.set("offers", JSON.stringify(offers.map((p) => p.id)));
    fetcher.submit(fd, { method: "post" });
  };

  const serverError = fetcher.data?.error;

  // общий список для отображения с меткой trigger/offer
  const items = [
    ...triggers.map((p) => ({ ...p, tag: "trigger" })),
    ...offers.map((p) => ({ ...p, tag: "offer" })),
  ];

  return (
    <Page title="Create funnel" backAction={{ onAction: () => nav(-1) }}>
      <Card>
        <BlockStack gap="400">
          {(uiError || serverError) && (
            <Banner tone="critical" title="Есть ошибки">
              {uiError || serverError}
            </Banner>
          )}

          <InlineStack gap="400" wrap>
            <TextField label="Name" value={name} onChange={setName} autoComplete="off" />
            <TextField
              label="Discount %"
              type="number"
              min={1}
              max={90}
              value={discountPct}
              onChange={setDiscountPct}
              autoComplete="off"
            />
          </InlineStack>

          <InlineStack gap="300">
            <Button onClick={pickTriggers}>Select trigger products</Button>
            <Button onClick={pickOffers}>Select offered products</Button>
          </InlineStack>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Selected products</Text>

              <ResourceList
                resourceName={{ singular: "product", plural: "products" }}
                items={items}
                renderItem={(it) => {
                  const media = (
                    <Thumbnail
                      size="small"
                      alt={it.title || "Product image"}
                      source={
                        it.image ||
                        NO_IMAGE
                      }
                    />
                  );

                  return (
                    <ResourceItem id={it.id} media={media} accessibilityLabel={it.title || it.id}  style={{height: '100%'}}>
                      <div style={{display: "flex", justifyContent: "space-between", gap: 12, height: '100%'}}>
                        <div style={{height: '100%', display: 'flex', alignItems: 'center'}}>
                          <Text as="span" variant="bodyMd" fontWeight="bold" >
                            {it.title || "Untitled product"}
                          </Text>{" "}
                          <Text as="span" variant="bodySm" tone="subdued">
                            {it.id}
                          </Text>
                        </div>
                        <Text as="span" variant="bodySm">{it.tag}</Text>
                      </div>
                    </ResourceItem>
                  );
                }}
              />

              {!items.length && (
                <Text variant="bodySm" as="p">No products selected yet.</Text>
              )}
            </BlockStack>
          </Card>

          <InlineStack gap="300">
            <Button primary onClick={save} disabled={invalid} loading={fetcher.state !== "idle"}>
              Save
            </Button>
            <Button onClick={() => nav(`/app/funnels${search}`)}>Cancel</Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Page>
  );
}
