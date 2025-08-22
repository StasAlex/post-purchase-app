// app/routes/app._index.jsx
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useLocation, Link as RemixLink } from "@remix-run/react";
import { useMemo } from "react";
import * as AppBridgeReact from "@shopify/app-bridge-react";

import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  InlineStack,
  ResourceList,
  ResourceItem,
  Link,
  Badge,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { prisma } from "../lib/prisma.server";

const { TitleBar } = AppBridgeReact;

/* -------------------- loader: сводка по воронкам -------------------- */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const [total, active, recent] = await Promise.all([
    prisma.funnel.count({ where: { shopDomain: session.shop } }),
    prisma.funnel.count({ where: { shopDomain: session.shop, active: true } }),
    prisma.funnel.findMany({
      where: { shopDomain: session.shop },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, discountPct: true, active: true, createdAt: true },
    }),
  ]);

  return json({ total, active, recent });
};

/* -------------------- страница -------------------- */
export default function Index() {
  const { total, active, recent } = useLoaderData();
  const disabled = Math.max(total - active, 0);
  const nav = useNavigate();
  const { search } = useLocation();

  const items = useMemo(
    () =>
      recent.map((f) => ({
        id: f.id,
        name: f.name,
        discountPct: f.discountPct,
        active: f.active,
        createdAt: f.createdAt,
      })),
    [recent]
  );

  return (
    <Page
      title="Post-purchase funnels"
      primaryAction={{ content: "Create funnel", onAction: () => nav(`/app/funnels/new${search}`) }}
      secondaryActions={[{ content: "All funnels", onAction: () => nav(`/app/funnels${search}`) }]}
    >
      <Layout>
        {/* левая колонка — основное */}
        <Layout.Section>
          {/* Быстрые карточки со счётчиками */}
          <InlineStack gap="300" wrap>
            <Stat title="Total funnels" value={total} />
            <Stat title="Active" value={active} tone="success" />
            <Stat title="Disabled" value={disabled} tone="critical" />
          </InlineStack>

          <Box paddingBlockStart="400" />

          {/* Последние воронки */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Recent funnels
                </Text>
                <Button variant="plain" onClick={() => nav(`/app/funnels${search}`)}>
                  View all
                </Button>
              </InlineStack>

              {items.length === 0 ? (
                <Box padding="400" background="bg-surface-active" borderRadius="200" borderColor="border" borderWidth="025">
                  <Text as="p" variant="bodyMd">
                    You don’t have any funnels yet.
                  </Text>
                  <Box paddingBlockStart="200">
                    <Button primary onClick={() => nav(`/app/funnels/new${search}`)}>
                      Create your first funnel
                    </Button>
                  </Box>
                </Box>
              ) : (
                <ResourceList
                  resourceName={{ singular: "funnel", plural: "funnels" }}
                  items={items}
                  renderItem={(item) => {
                    const { id, name, discountPct, active, createdAt } = item;
                    return (
                      <ResourceItem id={id} url={`/app/funnels/${id}${search}`} accessibilityLabel={`Edit ${name}`}>
                        <InlineStack align="space-between" wrap>
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {name}
                            </Text>
                            <Badge tone={active ? "success" : "critical"}>{active ? "Active" : "Disabled"}</Badge>
                          </InlineStack>
                          <InlineStack gap="300" blockAlign="center">
                            <Text as="span" variant="bodySm">Discount: {discountPct}%</Text>
                            <Text as="span" tone="subdued" variant="bodySm">
                              {new Date(createdAt).toLocaleString()}
                            </Text>
                          </InlineStack>
                        </InlineStack>
                      </ResourceItem>
                    );
                  }}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* правая колонка — помощь/ресурсы */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Quick start</Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  Build a funnel in three steps:
                </Text>
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>Select trigger products</li>
                  <li>Select offered products</li>
                  <li>Set discount and save</li>
                </ol>
                <Box paddingBlockStart="200">
                  <Button onClick={() => nav(`/app/funnels/new${search}`)}>Create funnel</Button>
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>

          <Box paddingBlockStart="300" />

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Resources</Text>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                <li>
                  <Link url="https://shopify.dev/docs/apps/checkout/post-purchase" target="_blank" removeUnderline>
                    Post-purchase offers
                  </Link>
                </li>
                <li>
                  <Link url="https://polaris.shopify.com" target="_blank" removeUnderline>
                    Polaris design system
                  </Link>
                </li>
                <li>
                  <Link url="https://shopify.dev/docs/apps/tools/app-bridge" target="_blank" removeUnderline>
                    App Bridge
                  </Link>
                </li>
              </ul>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/* --------------- маленький компонент-счётчик --------------- */
function Stat({ title, value, tone }) {
  return (
    <Card>
      <BlockStack gap="150">
        <Text as="span" tone="subdued" variant="bodySm">
          {title}
        </Text>
        <Text as="p" variant="heading2xl" tone={tone}>
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}
