// app/routes/app.funnels.new.jsx
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useLocation, useFetcher } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
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
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { prisma } from "../lib/prisma.server";

const { useAppBridge } = AppBridgeReact;

/* ----------------------- loader / action ----------------------- */
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

  if (!name || !discountPct || !shopDomain || !triggers.length || !offers.length) {
    return json({ ok: false, error: "Заполните все поля и выберите товары." }, { status: 400 });
  }

  await prisma.funnel.create({
    data: {
      name,
      discountPct,
      shopDomain,
      triggers: { create: triggers.map((gid) => ({ productGid: gid })) },
      offers: { create: offers.map((gid, i) => ({ productGid: gid, sort: i })) },
    },
  });

  return redirect("/app/funnels");
}

/* ----------------------- SSR-safe wrapper ----------------------- */
export default function FunnelCreateRoute() {
  const { shopDomain } = useLoaderData();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  if (!hydrated) {
    return (
      <Page title="Create funnel">
        <Card>
          <Text as="p" variant="bodyMd">
            Loading…
          </Text>
        </Card>
      </Page>
    );
  }

  return <FunnelCreateClient shopDomain={shopDomain} />;
}

/* ----------------------- Client component ----------------------- */
function FunnelCreateClient({ shopDomain }) {
  const nav = useNavigate();
  const { search } = useLocation();
  const app = useAppBridge();
  const fetcher = useFetcher();

  const [name, setName] = useState("");
  const [discountPct, setDiscountPct] = useState("20");
  const [triggers, setTriggers] = useState([]); // array of Product GIDs
  const [offers, setOffers] = useState([]);     // array of Product GIDs

  const openProductPicker = useCallback(async (selectMultiple = true) => {
    if (typeof window === "undefined") return [];

    // не даём Vite пытаться резолвить подпакет на сервере
    const id1 = "@shopify/app-bridge/actions/ResourcePicker"; // v3
    const id2 = "@shopify/app-bridge/actions";                // запасной
    const mod =
      (await import(/* @vite-ignore */ id1).catch(() => null)) ??
      (await import(/* @vite-ignore */ id2));
    const { ResourcePicker } = mod;

    return new Promise((resolve) => {
      const picker = ResourcePicker.create(app, {
        resourceType: ResourcePicker.ResourceType.Product,
        options: { selectMultiple },
      });

      picker.subscribe(ResourcePicker.Action.SELECT, ({ selection }) => {
        resolve(selection || []);
        picker.dispatch(ResourcePicker.Action.CLOSE);
      });

      picker.subscribe(ResourcePicker.Action.CANCEL, () => {
        resolve([]);
        picker.dispatch(ResourcePicker.Action.CLOSE);
      });

      picker.dispatch(ResourcePicker.Action.OPEN);
    });
  }, [app]);

  const pickTriggers = async () => {
    const sel = await openProductPicker(true);
    setTriggers(sel.map((p) => p.id));
  };

  const pickOffers = async () => {
    const sel = await openProductPicker(true);
    setOffers(sel.map((p) => p.id));
  };

  const save = () => {
    const fd = new FormData();
    fd.set("name", name);
    fd.set("discountPct", discountPct);
    fd.set("shopDomain", shopDomain);
    fd.set("triggers", JSON.stringify(triggers));
    fd.set("offers", JSON.stringify(offers));
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <Page title="Create funnel" backAction={{ onAction: () => nav(-1) }}>
      <Card>
        <BlockStack gap="400">
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
              <Text as="h3" variant="headingSm">
                Selected products
              </Text>
              <ResourceList
                resourceName={{ singular: "product", plural: "products" }}
                items={[
                  ...triggers.map((id) => ({ id, tag: "trigger" })),
                  ...offers.map((id) => ({ id, tag: "offer" })),
                ]}
                renderItem={(it) => (
                  <ResourceItem id={it.id}>
                    {it.id} ({it.tag})
                  </ResourceItem>
                )}
              />
              {!triggers.length && !offers.length && (
                <Text variant="bodySm" as="p">
                  No products selected yet.
                </Text>
              )}
            </BlockStack>
          </Card>

          <InlineStack gap="300">
            <Button primary onClick={save} loading={fetcher.state !== "idle"}>
              Save
            </Button>
            <Button onClick={() => nav(`/app/funnels${search}`)}>Cancel</Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Page>
  );
}
