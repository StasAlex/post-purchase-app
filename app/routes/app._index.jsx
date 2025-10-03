// app/routes/app._index.jsx
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useLocation, useRevalidator } from "@remix-run/react";
import {
  Page, Layout, Text, Card, BlockStack, Box, InlineStack,
  IndexTable, Button, Badge, Pagination, Divider, Tooltip, Icon, Grid, LegacyCard
} from "@shopify/polaris";
import { InfoIcon } from '@shopify/polaris-icons';
import { authenticate } from "../shopify.server";
import { prisma } from "../lib/prisma.server";
import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Popover, ActionList, Spinner } from "@shopify/polaris";

/* ----------------------- helpers ----------------------- */
function buildSettingsHref(id, search) {
  const params = new URLSearchParams(search);
  params.set("id", id);
  return `/app/settings?${params.toString()}`;
}

/* ---------------------------- loader ---------------------------- */
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  // pagination
  const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);
  const pageSize = Math.min(Math.max(parseInt(url.searchParams.get("pageSize") || "10", 10), 1), 100);

  // sorting (only by name; default: createdAt desc)
  const sort = url.searchParams.get("sort") === "name" ? "name" : "createdAt";
  const dir  = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const orderBy =
    sort === "name"
      ? { name: dir }
      : { createdAt: "desc" };

  // dashboard (заглушки — считать по своей модели при необходимости)
  const ordersCount = 0;
  const revenueAgg = { _sum: { total: 0 } };
  const discountAgg = { _sum: { discount: 0 } };

  // totals
  const [funnelsTotal, funnelsActive] = await Promise.all([
    prisma.funnel.count({ where: { shopDomain: session.shop } }),
    prisma.funnel.count({ where: { shopDomain: session.shop, active: true } }),
  ]);
  const lastPage = Math.max(Math.ceil(funnelsTotal / pageSize), 1);
  if (page > lastPage) {
    url.searchParams.set("page", String(lastPage));
    url.searchParams.set("pageSize", String(pageSize));
    return redirect(`${url.pathname}${url.search}`);
  }

  // page items
  const skip = (page - 1) * pageSize;
  const rows = await prisma.funnel.findMany({
    where: { shopDomain: session.shop },
    orderBy,
    skip, take: pageSize,
    select: {
      id: true, name: true, active: true, discountPct: true, createdAt: true,
      triggerProductGid: true, offerProductGid: true,
    },
  });

  // загружаем названия продуктов
  let titleById = {};
  const ids = Array.from(new Set(rows.flatMap(r => [r.triggerProductGid, r.offerProductGid].filter(Boolean))));
  if (ids.length) {
    const resp = await admin.graphql(
      `#graphql
       query($ids:[ID!]!){ nodes(ids:$ids){ id ... on Product { title } } }`,
      { variables: { ids } }
    );
    if (resp.ok) {
      const data = await resp.json();
      titleById = Object.fromEntries((data?.data?.nodes || []).filter(Boolean).map(n => [n.id, n.title]));
    }
  }

  const items = rows.map(r => ({
    id: r.id,
    name: r.name,
    active: r.active,
    discountPct: r.discountPct,
    triggerTitle: titleById[r.triggerProductGid] || "—",
    offerTitle:   titleById[r.offerProductGid]   || "—",
  }));

  return json({
    dashboard: {
      revenue: Number(revenueAgg._sum.total || 0),
      discounts: Number(discountAgg._sum.discount || 0),
      ordersCount,
    },
    items,
    funnelsTotal,
    funnelsActive,
    page,
    pageSize,
    sort,
    dir,
    hasPrevPage: page > 1,
    hasNextPage: page < lastPage,
  });
};

/* --------------------------- action: delete --------------------------- */
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("_action") !== "delete") return json({ ok: false });

  const raw = String(form.get("id") || "");
  const id = raw.split("?")[0].split("#")[0].trim();
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  await prisma.funnel.deleteMany({ where: { id, shopDomain: session.shop } });
  return json({ ok: true });
};

/* --------------------------- row actions --------------------------- */
function RowActions({ id, name, onEdit }) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher();
  const revalidator = useRevalidator();

  const isDeleting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_action") === "delete" &&
    fetcher.formData?.get("id") === id;

  useEffect(() => {
    if (isDeleting) setOpen(false);
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setOpen(false);
      revalidator.revalidate();
    }
  }, [isDeleting, fetcher.state, fetcher.data, revalidator]);

  const remove = () => {
    if (confirm(`Remove funnel “${name}”?`)) {
      fetcher.submit({ _action: "delete", id }, { method: "post" });
    }
  };

  if (isDeleting) {
    return (
      <InlineStack gap="150" blockAlign="center">
        <Spinner size="small" />
        <Text as="span" tone="subdued" variant="bodySm">Removing…</Text>
      </InlineStack>
    );
  }

  const activator = (
    <Button variant="plain" disclosure onClick={() => setOpen(v => !v)}>
      Actions
    </Button>
  );

  return (
    <Popover active={open} activator={activator} onClose={() => setOpen(false)}>
      <ActionList
        actionRole="menuitem"
        items={[
          { content: "Edit", onAction: onEdit },
          { content: "Remove", destructive: true, onAction: remove },
        ]}
      />
    </Popover>
  );
}

/* ------------------------------ page ------------------------------ */
export default function Index() {
  const {
    dashboard, items, funnelsTotal, page, pageSize, hasPrevPage, hasNextPage, sort, dir,
  } = useLoaderData();
  const nav = useNavigate();
  const { search } = useLocation();

  const updateSearch = (patch) => {
    const url = new URL(window.location.href);
    Object.entries(patch).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    nav(`${url.pathname}${url.search}`);
  };

  const sortColumnIndex = sort === "name" ? 0 : undefined;
  const sortDirection = dir === "asc" ? "ascending" : "descending";

  const onSort = (index, direction) => {
    if (index !== 0) return;
    updateSearch({ sort: "name", dir: direction === "ascending" ? "asc" : "desc" });
  };

  const updatePage = (nextPage) => updateSearch({ page: nextPage, pageSize });

  return (
    <Page title="">
      {/* Title + info */}
      <InlineStack gap="200" blockAlign="center">
        <Text as="h1" variant="heading2xl">Dashboard</Text>
        <Tooltip content="Overall metrics for your post-purchase funnels">
          <Icon source={InfoIcon} tone="subdued" />
        </Tooltip>
      </InlineStack>
      <Box paddingBlockEnd="300" />
      <Divider />
      <Box paddingBlockEnd="500" />
      <Grid>
        <Grid.Cell columnSpan={{xs: 6, sm: 2, md: 2, lg: 4, xl: 4}}>
          <Stat title="Total Revenue" value={formatMoney(dashboard.revenue)} />
        </Grid.Cell>
        <Grid.Cell columnSpan={{xs: 6, sm: 2, md: 2, lg: 4, xl: 4}}>
          <Stat
            title={
              <InlineStack gap="100" align="space-between">
                <span>Total Discounts</span>
                <Tooltip content="Sum of discounts given by accepted offers">
                  <Icon source={InfoIcon} tone="subdued" />
                </Tooltip>
              </InlineStack>
            }
            value={formatMoney(dashboard.discounts)}
          />
        </Grid.Cell>
        <Grid.Cell columnSpan={{xs: 6, sm: 2, md: 2, lg: 4, xl: 4}}>
          <Stat title={
            <InlineStack gap="100" align="space-between">
              <span>Orders Count</span>
              <Tooltip content="Count of orders given by accepted offers">
                <Icon source={InfoIcon} tone="subdued" />
              </Tooltip>
            </InlineStack>
          } value={dashboard.ordersCount} />
        </Grid.Cell>
      </Grid>
      <Box paddingBlockEnd="500" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingLg">Funnels</Text>
                  <Tooltip content="Your configured triggers and offers">
                    <Icon source={InfoIcon} tone="subdued" />
                  </Tooltip>
                </InlineStack>
                <Button onClick={() => nav(`/app/settings${search}`)}>Create a new funnel</Button>
              </InlineStack>

              <Divider />
              <Box paddingBlockEnd="200" />

              <IndexTable
                resourceName={{ singular: "funnel", plural: "funnels" }}
                itemCount={items.length}
                selectable={false}
                sortColumnIndex={sortColumnIndex}
                sortDirection={sortDirection}
                onSort={onSort}
                headings={[
                  { title: "Funnel name", sortable: true },
                  { title: "Trigger" },
                  { title: "Offer" },
                  { title: "Discount" },
                  { title: "Actions" },
                ]}
              >
                {items.map((f, index) => (
                  <IndexTable.Row id={f.id} key={f.id} position={index}>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          <a href={buildSettingsHref(f.id, search)} style={{ textDecoration: "none" }}>
                            {f.name}
                          </a>
                        </Text>
                        <Badge tone={f.active ? "success" : "critical"}>
                          {f.active ? "Active" : "Disabled"}
                        </Badge>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm">{f.triggerTitle}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm">{f.offerTitle}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm">{f.discountPct}%</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <RowActions
                        id={f.id}
                        name={f.name}
                        onEdit={() => nav(buildSettingsHref(f.id, search))}
                      />
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>

              <InlineStack align="end">
                <Pagination
                  hasPrevious={hasPrevPage}
                  onPrevious={() => updatePage(page - 1)}
                  hasNext={hasNextPage}
                  onNext={() => updatePage(page + 1)}
                />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/* ----------------------- small stat card ----------------------- */
function Stat({ title, value }) {
  return (
    <Card>
        {typeof title === "string"
          ? <Text as="span" tone="subdued" variant="bodySm">{title}</Text>
          : title}
        <Text as="p" variant="heading2xl">{value}</Text>
    </Card>
  );
}

/* ------------------------- money format ------------------------ */
function formatMoney(num) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(num || 0));
  } catch {
    return `$${Number(num || 0).toFixed(2)}`;
  }
}
