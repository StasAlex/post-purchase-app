// app/routes/app.settings.jsx
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import * as AppBridgeReact from "@shopify/app-bridge-react";
import {
  Page, Layout, Card, Text, BlockStack, Box, InlineStack,
  Button, TextField, Select, Banner, Divider, InlineError
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { prisma } from "../lib/prisma.server";

const { useAppBridge } = AppBridgeReact;

/* ---------------- loader (новая схема) ---------------- */
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) return json({ mode: "create", funnel: null, trigger: null, offer: null });

  const funnel = await prisma.funnel.findFirst({
    where: { id, shopDomain: session.shop },
    select: {
      id: true, name: true, discountPct: true, active: true, createdAt: true,
      triggerProductGid: true, offerProductGid: true,
    },
  });
  if (!funnel) return redirect("/app/funnels");

  // подтягиваем названия товаров
  const ids = [funnel.triggerProductGid, funnel.offerProductGid].filter(Boolean);
  let titleById = {};
  if (ids.length) {
    const resp = await admin.graphql(
      `#graphql
      query($ids:[ID!]!){
        nodes(ids:$ids){ id ... on Product { title } }
      }`,
      { variables: { ids } },
    );
    if (resp.ok) {
      const data = await resp.json();
      titleById = Object.fromEntries(
        (data?.data?.nodes || []).filter(Boolean).map(n => [n.id, n.title])
      );
    }
  }

  const trigger = funnel.triggerProductGid
    ? { id: funnel.triggerProductGid, title: titleById[funnel.triggerProductGid] || "Product" }
    : null;
  const offer = funnel.offerProductGid
    ? { id: funnel.offerProductGid, title: titleById[funnel.offerProductGid] || "Product" }
    : null;

  return json({ mode: "edit", funnel, trigger, offer });
};

/* ---------------- action (новая схема + P2002) ---------------- */
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  if (String(form.get("_action") || "") !== "save") {
    return json({ ok: false }, { status: 400 });
  }

  const rawId       = form.get("id") ? String(form.get("id")) : undefined;
  const id          = rawId ? rawId.split("?")[0].split("#")[0].trim() : undefined;
  const name        = String(form.get("name") || "").trim();
  const discountPct = Number(form.get("discountPct") || 0);
  const triggerGid  = String(form.get("triggerGid") || "");
  const offerGid    = String(form.get("offerGid") || "");

  // валидация
  if (!name)        return json({ ok:false, field:"name",        error:"Name is required" }, { status: 422 });
  if (!triggerGid)  return json({ ok:false, field:"trigger",     error:"Trigger product is required" }, { status: 422 });
  if (!offerGid)    return json({ ok:false, field:"offer",       error:"Offered product is required" }, { status: 422 });
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 90) {
    return json({ ok:false, field:"discountPct", error:"Discount must be between 0 and 90" }, { status: 422 });
  }

  const data = {
    name,
    discountPct,
    active: true,
    shopDomain: session.shop,
    triggerProductGid: triggerGid,
    offerProductGid: offerGid,
  };

  try {
    if (id) {
      await prisma.funnel.update({ where: { id }, data });
    } else {
      await prisma.funnel.create({ data });
    }
  } catch (e) {
    // нарушение уникального индекса (триггер уже использован другим фаннелом)
    if (e?.code === "P2002") {
      return json({ ok:false, field:"trigger", error:"This trigger product already has a funnel" }, { status: 422 });
    }
    // прочие ошибки — вернём 400, чтобы не «молчать»
    return json({ ok:false, error:"Unexpected error while saving" }, { status: 400 });
  }

  return redirect("/app/funnels");
};

/* ---------------- UI ---------------- */
export default function SettingsPage() {
  const { mode, funnel, trigger: triggerFromLoader, offer: offerFromLoader } = useLoaderData();

  const [name, setName] = useState(funnel?.name || "");
  const [discount, setDiscount] = useState(String(funnel?.discountPct ?? 10));
  const [trigger, setTrigger] = useState(triggerFromLoader || null);
  const [offer, setOffer] = useState(offerFromLoader || null);
  const [errors, setErrors] = useState({ name: undefined, trigger: undefined, offer: undefined, discountPct: undefined });
  const [serverMsg, setServerMsg] = useState("");

  const nav = useNavigate();
  const fetcher = useFetcher();
  const app = useAppBridge();

  // серверные ошибки → в поля
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && fetcher.data.ok === false) {
      const { field, error } = fetcher.data;
      if (field && error) {
        setErrors(prev => ({ ...prev, [field]: error }));
        setServerMsg(error);
      } else if (fetcher.data.error) {
        setServerMsg(fetcher.data.error);
      }
    }
  }, [fetcher.state, fetcher.data]);

  const openProductPicker = async () => {
    const res = await app.resourcePicker({ type: "product", multiple: false });
    return res?.selection?.[0] || null;
  };

  const selectTrigger = async () => {
    const p = await openProductPicker();
    if (p) {
      setTrigger({ id: p.id, title: p.title ?? p.name ?? p.handle ?? "Untitled" });
      setErrors(e => ({ ...e, trigger: undefined }));
    }
  };

  const selectOffer = async () => {
    const p = await openProductPicker();
    if (p) {
      setOffer({ id: p.id, title: p.title ?? p.name ?? p.handle ?? "Untitled" });
      setErrors(e => ({ ...e, offer: undefined }));
    }
  };

  const validate = () => {
    const next = {};
    if (!name.trim()) next.name = "Name is required";
    if (!trigger) next.trigger = "Select trigger product";
    if (!offer) next.offer = "Select offered product";
    if (!/^\d+$/.test(String(discount)) || Number(discount) < 0 || Number(discount) > 90) {
      next.discountPct = "Discount must be between 0 and 90";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSave = () => {
    setServerMsg("");
    if (!validate()) return;
    const fd = new FormData();
    fd.set("_action", "save");
    if (funnel?.id) fd.set("id", funnel.id);
    fd.set("name", name);
    fd.set("discountPct", discount);
    fd.set("triggerGid", trigger.id);
    fd.set("offerGid", offer.id);
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <Page title="">
      <Layout>
        <Layout.Section>
          <Box>
            <Text as="h1" variant="heading2xl">Funnel create</Text>
            <Box paddingBlockEnd="300" />
            <Divider borderColor="border" />
            <Box paddingBlockEnd="500" />

            {serverMsg && (
              <Box paddingBlockEnd="300">
                <Banner tone="critical" title="Error">{serverMsg}</Banner>
              </Box>
            )}

            <BlockStack gap="500">
              <BlockStack gap="1000">
                {/* Name */}
                <InlineStack wrap={false} gap="400" align="space-between" blockAlign="center">
                  <Box width="30%">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Name</Text>
                      <Text tone="subdued" variant="bodySm" fontWeight="semibold">Enter funnel name</Text>
                    </BlockStack>
                  </Box>
                  <Box width="70%">
                    <Card>
                      <Box width="100%">
                        <TextField
                          label="Name"
                          labelHidden
                          value={name}
                          onChange={(v) => {
                            setName(v);
                            if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
                          }}
                          autoComplete="off"
                          placeholder="Type funnel name"
                          requiredIndicator
                          error={errors.name}
                        />
                      </Box>
                    </Card>
                  </Box>
                </InlineStack>

                {/* Trigger */}
                <InlineStack wrap={false} gap="400" align="space-between" blockAlign="center">
                  <Box width="30%">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Trigger</Text>
                      <Text tone="subdued" variant="bodySm" fontWeight="semibold">Choose trigger product</Text>
                    </BlockStack>
                  </Box>

                  <Box width="70%">
                    <Card>
                      <Box width="100%">
                        <InlineStack align="space-between" blockAlign="start" gap="300">
                          <Box style={{ flex: "1 1 auto", minWidth: 0, paddingRight: 12 }}>
                            <Text variant="bodyMd" tone="subdued" truncate as="p">
                              {trigger ? trigger.title : "Please select trigger product"}
                            </Text>
                          </Box>
                          <Box style={{ flex: "0 0 auto" }}>
                            <Button variant="primary" tone="success" onClick={selectTrigger}>
                              Select
                            </Button>
                          </Box>
                        </InlineStack>
                      </Box>
                    </Card>
                    {errors?.trigger && (
                      <Box marginBlockStart="100">
                        <InlineError message={errors.trigger} fieldID="trigger" />
                      </Box>
                    )}
                  </Box>
                </InlineStack>

                {/* Offer */}
                <InlineStack wrap={false} gap="400" align="space-between" blockAlign="center">
                  <Box width="30%">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Offer</Text>
                      <Text tone="subdued" variant="bodySm" fontWeight="semibold">Choose offer product</Text>
                    </BlockStack>
                  </Box>

                  <Box width="70%">
                    <Card>
                      <Box width="100%">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="bodyMd" tone="subdued" truncate>
                            {offer ? offer.title : "Please select your offered product"}
                          </Text>
                          <Button variant="primary" tone="success" onClick={selectOffer}>
                            Select
                          </Button>
                        </InlineStack>
                      </Box>
                    </Card>
                    {errors?.offer && (
                      <Box marginBlockStart="100">
                        <InlineError message={errors.offer} fieldID="offer" />
                      </Box>
                    )}
                  </Box>
                </InlineStack>

                {/* Discount */}
                <InlineStack wrap={false} gap="400" align="space-between" blockAlign="center">
                  <Box width="30%">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Discount</Text>
                      <Text tone="subdued" variant="bodySm" fontWeight="semibold">Select offer discount</Text>
                    </BlockStack>
                  </Box>
                  <Box width="70%">
                    <Card>
                      <Box width="100%">
                        <div style={{ width: "100%" }}>
                          <Select
                            label="Select your discount"
                            options={["0%","5%","10%","15%","20%","30%","40%"].map(x => ({label:x, value:x.replace("%","")}))}
                            value={discount}
                            onChange={(v) => {
                              setDiscount(v);
                              if (errors.discountPct) setErrors(e => ({ ...e, discountPct: undefined }));
                            }}
                          />
                        </div>
                        {errors?.discountPct && (
                          <Box marginBlockStart="100">
                            <InlineError message={errors.discountPct} fieldID="discountPct" />
                          </Box>
                        )}
                      </Box>
                    </Card>
                  </Box>
                </InlineStack>
              </BlockStack>

              <BlockStack gap="500">
                <Divider borderColor="border" paddingBlockEnd="500" />
                <InlineStack align="end">
                  <Button
                    variant="primary"
                    loading={fetcher.state !== "idle"}
                    onClick={onSave}
                    disabled={fetcher.state !== "idle"}
                  >
                    Save
                  </Button>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
