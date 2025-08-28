// app/routes/app.funnels.$id.jsx
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useLocation, Form } from "@remix-run/react";
import { useEffect, useState, useCallback } from "react";
import * as AppBridgeReact from "@shopify/app-bridge-react";
import {
  Page,
  Card,
  Text,
  TextField,
  Button,
  InlineStack,
  BlockStack,
  ResourceList,
  ResourceItem,
  Banner,
  Thumbnail,
  Checkbox,
  Box,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { prisma } from "../lib/prisma.server";

const { useAppBridge } = AppBridgeReact;
// маленький серый плейсхолдер 64x64
const NO_IMAGE =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="100%" height="100%" fill="%23f6f6f7"/><g fill="%23c4cdd5"><circle cx="22" cy="24" r="6"/><path d="M8 48l14-14 10 10 6-6 18 18z"/></g></svg>';


/* ============== LOADER ============== */
export async function loader({ request, params }) {
  const { session, admin } = await authenticate.admin(request);
  const id = params.id || "";

  const funnel = await prisma.funnel.findFirst({
    where: { id, shopDomain: session.shop },
    include: {
      triggers: true, // fields: productGid, variantGids (Json)
      offers: true,   // fields: productGid, variantGids (Json)
    },
  });

  if (!funnel) return redirect("/app/funnels");

  // Собираем уникальные GID и тянем заголовки/картинки
  const gids = Array.from(
    new Set([
      ...funnel.triggers.map((t) => t.productGid),
      ...funnel.offers.map((o) => o.productGid),
    ]),
  );

  const byId = {};
  if (gids.length) {
    const resp = await admin.graphql(
      `#graphql
      query ProductsById($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            featuredImage { url altText }
          }
        }
      }`,
      { variables: { ids: gids } },
    );
    const data = await resp.json();
    for (const n of data?.data?.nodes || []) {
      if (n?.id) {
        byId[n.id] = {
          id: n.id,
          title: n.title || "Untitled product",
          image: n.featuredImage?.url || NO_IMAGE,
        };
      }
    }
  }

  const enrich = (gid) => byId[gid] || { id: gid, title: "Product", image: NO_IMAGE };

  return json({
    funnel: {
      id: funnel.id,
      name: funnel.name,
      discountPct: funnel.discountPct,
      active: !!funnel.active,
      // ВАЖНО: прокидываем variantIds назад на клиент — для корректного преселекта
      triggers: funnel.triggers.map((t) => ({
        ...enrich(t.productGid),
        tag: "trigger",
        variantIds: Array.isArray(t.variantGids) ? t.variantGids : [],
      })),
      offers: funnel.offers.map((o) => ({
        ...enrich(o.productGid),
        tag: "offer",
        variantIds: Array.isArray(o.variantGids) ? o.variantGids : [],
      })),
    },
  });
}

/* ============== ACTION ============== */
export async function action({ request, params }) {
  const id = params.id || "";
  const form = await request.formData();

  const name = String(form.get("name") || "").trim();
  const discountPct = Number(form.get("discountPct") || 0);
  const active =
    String(form.get("active") || "") === "on" || String(form.get("active")) === "true";

  // Теперь из формы приходят объекты: { id: productGID, variantIds: string[] }
  const triggers = JSON.parse(String(form.get("triggers") || "[]"));
  const offers = JSON.parse(String(form.get("offers") || "[]"));

  if (!name) return json({ ok: false, error: "Заполните поле Name." }, { status: 422 });
  if (!Number.isFinite(discountPct) || discountPct <= 0)
    return json({ ok: false, error: "Discount % должен быть > 0." }, { status: 422 });
  if (!Array.isArray(triggers) || triggers.length === 0)
    return json({ ok: false, error: "Добавьте хотя бы один Trigger." }, { status: 422 });
  if (!Array.isArray(offers) || offers.length === 0)
    return json({ ok: false, error: "Добавьте хотя бы один Offer." }, { status: 422 });

  await prisma.$transaction([
    prisma.trigger.deleteMany({ where: { funnelId: id } }),
    prisma.offer.deleteMany({ where: { funnelId: id } }),
    prisma.funnel.update({
      where: { id },
      data: {
        name,
        discountPct,
        active,
        // Сохраняем и варианты
        triggers: {
          create: triggers.map((t) => ({
            productGid: t.id,
            variantGids: Array.isArray(t.variantIds) ? t.variantIds : [],
          })),
        },
        offers: {
          create: offers.map((t, i) => ({
            productGid: t.id,
            sort: i,
            variantGids: Array.isArray(t.variantIds) ? t.variantIds : [],
          })),
        },
      },
    }),
  ]);

  return redirect("/app/funnels");
}

/* ============== SSR-safe оболочка ============== */
export default function FunnelEditRoute() {
  const { funnel } = useLoaderData();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated) {
    return (
      <Page title="Edit funnel">
        <Card>
          <Text as="p" variant="bodyMd">Loading…</Text>
        </Card>
      </Page>
    );
  }
  return <FunnelEditClient initial={funnel} />;
}

/* ============== Клиент ============== */
function FunnelEditClient({ initial }) {
  const nav = useNavigate();
  const { search } = useLocation();
  const app = useAppBridge();

  const [name, setName] = useState(initial.name || "");
  const [discountPct, setDiscountPct] = useState(String(initial.discountPct ?? "20"));
  const [active, setActive] = useState(!!initial.active);

  // Храним variantIds в состоянии — это ключ к корректному преселекту
  const [triggers, setTriggers] = useState(initial.triggers || []);
  const [offers, setOffers] = useState(initial.offers || []);
  const [uiError, setUiError] = useState("");

  // Универсальная нормализация «продукт из пикера → что кладём в стейт»
  const toPicked = (p, tag) => ({
    id: p.id,
    tag,
    title: p.title ?? p.name ?? "Untitled product",
    image:
      p.featuredImage?.url ??
      p.featuredImage?.originalSrc ??
      p.image?.url ??
      p.image?.originalSrc ??
      p.images?.[0]?.url ??
      p.images?.[0]?.originalSrc ??
      NO_IMAGE,
    // ВАЖНО: берём только реально выбранные варианты, если они есть
    variantIds: Array.isArray(p.variants) ? p.variants.map((v) => v.id) : [],
  });

  /* ---------- Преселект: утилиты ---------- */

  // приведение к gid://shopify/Kind/123
  const toGid = (val, kind /* 'Product' | 'ProductVariant' */) => {
    const raw = typeof val === "string" ? val : val?.id;
    if (!raw) return null;
    if (raw.startsWith("gid://")) return raw;
    const num = String(raw).match(/\d+/)?.[0];
    return num ? `gid://shopify/${kind}/${num}` : null;
  };

  // helper API (shopify.resourcePicker): selectionIds = [{id, variants:[{id}]}]
  const buildSelectionIdsForHelper = (items = []) => {
    const byProduct = new Map();
    for (const it of items) {
      const productId = toGid(it?.id ?? it, "Product");
      if (!productId) continue;

      if (!byProduct.has(productId)) {
        byProduct.set(productId, { id: productId, variants: [] });
      }
      const variants = Array.isArray(it?.variantIds) ? it.variantIds : [];
      for (const vid of variants) {
        const gid = toGid(vid, "ProductVariant");
        if (gid) byProduct.get(productId).variants.push({ id: gid });
      }
    }
    return [...byProduct.values()];
  };

  // legacy actions API: initialSelectionIds = [{id: productGID}, ...]
  const buildInitialSelectionIdsForActions = (items = []) => {
    const seen = new Set();
    const out = [];
    const push = (id) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id });
      }
    };
    for (const it of items) {
      push(toGid(it?.id ?? it, "Product"));
    }
    return out;
  };

  /* ---------- Открытие пикера ---------- */
  const openProductPicker = useCallback(
    async (multiple = true, preselected = []) => {
      // 1) новый helper
      if (app && typeof app.resourcePicker === "function") {
        try {
          const selectionIds = buildSelectionIdsForHelper(preselected);
          const res = await app.resourcePicker({
            type: "product",
            multiple,
            selectionIds, // << варианты попадут сюда
          });
          if (Array.isArray(res?.selection)) return res.selection;
        } catch {
          // fall back
        }
      }

      // 2) старый actions-API
      const AB = window.Shopify?.AppBridge || window.appBridge || window["app-bridge"];
      const RP = AB?.actions?.ResourcePicker;
      if (!RP) {
        throw new Error(
          "Не удалось открыть Product Picker. Убедитесь, что приложение запущено как embedded и App Bridge инициализирован."
        );
      }

      return new Promise((resolve) => {
        const picker = RP.create(app, {
          resourceType: RP.ResourceType.Product,
          options: {
            selectMultiple: multiple,
            showVariants: true, // важно, иначе вариативность пропадёт
            initialSelectionIds: buildInitialSelectionIdsForActions(preselected),
          },
        });

        const offSelect = picker.subscribe(RP.Action.SELECT, ({ selection }) => {
          resolve(selection || []);
          picker.dispatch(RP.Action.CLOSE);
          try { offSelect(); } catch {}
          try { offCancel(); } catch {}
        });
        const offCancel = picker.subscribe(RP.Action.CANCEL, () => {
          resolve([]);
          picker.dispatch(RP.Action.CLOSE);
          try { offSelect(); } catch {}
          try { offCancel(); } catch {}
        });

        picker.dispatch(RP.Action.OPEN);
      });
    },
    [app]
  );

  const pickTriggers = async () => {
    setUiError("");
    try {
      const sel = await openProductPicker(true, triggers);
      setTriggers(sel.map((p) => toPicked(p, "trigger")));
    } catch (e) {
      setUiError(e?.message || "Не удалось открыть Product Picker.");
    }
  };

  const pickOffers = async () => {
    setUiError("");
    try {
      const sel = await openProductPicker(true, offers);
      setOffers(sel.map((p) => toPicked(p, "offer")));
    } catch (e) {
      setUiError(e?.message || "Не удалось открыть Product Picker.");
    }
  };

  const removeItem = (id, tag) => {
    if (tag === "trigger") setTriggers((prev) => prev.filter((p) => p.id !== id));
    else setOffers((prev) => prev.filter((p) => p.id !== id));
  };

  const items = [...triggers, ...offers];

  const invalid =
    !name.trim() || !Number(discountPct) || triggers.length === 0 || offers.length === 0;

  return (
    <Page title="Edit funnel" backAction={{ onAction: () => nav(-1) }}>
      <Card>
        <BlockStack gap="400">
          {uiError && (
            <Banner tone="critical" title="Есть ошибки">
              {uiError}
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

          <Checkbox label="Active" checked={active} onChange={setActive} />

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
                      source={it.image || NO_IMAGE}
                    />
                  );
                  return (
                    <ResourceItem id={it.id} media={media} accessibilityLabel={it.title || it.id}>
                      <Box
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) 100px 100px",
                          alignItems: "center",
                          gap: "12px",
                          width: "100%",
                        }}
                      >
                        <Box minWidth="0">
                          <InlineStack  gap="300" align="start" wrap={false}>
                            <Text
                              as="span"
                              variant="bodyMd"
                              fontWeight="bold"
                              truncate
                              title={it.title || "Untitled product"}
                            >
                              {it.title || "Untitled product"}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued" truncate title={it.id}>
                              {it.id}
                            </Text>
                          </InlineStack>
                        </Box>

                        <Text as="div" variant="bodySm" tone="subdued" alignment="end">
                          {it.tag}
                        </Text>

                        <Button tone="critical" onClick={() => removeItem(it.id, it.tag)}>
                          Remove
                        </Button>
                      </Box>
                    </ResourceItem>
                  );
                }}
              />

              {!items.length && <Text variant="bodySm" as="p">No products selected yet.</Text>}
            </BlockStack>
          </Card>

          {/* Отправляем и variantIds, чтобы после сохранения преселект не терялся */}
          <Form method="post">
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="discountPct" value={discountPct} />
            <input type="hidden" name="active" value={String(active)} />
            <input
              type="hidden"
              name="triggers"
              value={JSON.stringify(triggers.map((p) => ({ id: p.id, variantIds: p.variantIds || [] })))}
            />
            <input
              type="hidden"
              name="offers"
              value={JSON.stringify(offers.map((p) => ({ id: p.id, variantIds: p.variantIds || [] })))}
            />

            <InlineStack gap="300">
              <Button primary submit disabled={invalid}>Save</Button>
              <Button onClick={() => nav(`/app/funnels${search}`)}>Cancel</Button>
            </InlineStack>
          </Form>
        </BlockStack>
      </Card>
    </Page>
  );
}
