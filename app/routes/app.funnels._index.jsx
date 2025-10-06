// app/routes/app.funnels._index.jsx
import { json } from "@remix-run/node";
import {
  useNavigate,
  useLocation,
  Link,
  useLoaderData,
  useFetcher,
  useRevalidator
} from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  InlineStack,
  Button,
  Text,
  Spinner,
  Tooltip,
  Icon,
  Box,
  Divider, Popover, ActionList
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { prisma } from "../lib/prisma.server";
import { useEffect, useState } from "react";
import {InfoIcon} from "@shopify/polaris-icons";

/* ---------------- loader: только новая схема ---------------- */
export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const sort = url.searchParams.get('sort');
  const dir  = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';

  let orderBy;
  if (sort === 'name') orderBy = { name: dir };
  else if (sort === 'discount') orderBy = { discountPct: dir };
  else orderBy = { createdAt: 'desc' }; // дефолт

  const funnels = await prisma.funnel.findMany({
    where: { shopDomain: session.shop },
    orderBy,
    select: {
      id: true, name: true, discountPct: true, active: true,
      triggerProductGid: true, offerProductGid: true,
    },
  });

  const ids = Array.from(new Set(funnels.flatMap(f => [f.triggerProductGid, f.offerProductGid].filter(Boolean))));
  let titleById = {};
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

  const rows = funnels.map(f => ({
    id: f.id,
    name: f.name,
    discountPct: f.discountPct,
    active: f.active,
    triggerTitle: titleById[f.triggerProductGid] || '—',
    offerTitle:   titleById[f.offerProductGid]   || '—',
  }));

  return json({ funnels: rows, sort: sort || 'createdAt', dir });
}

/* ---------------- action: JSON + безопасное удаление ---------------- */
export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  if (form.get("_intent") === "delete") {
    const raw = String(form.get("id") || "");
    const id = raw.split("?")[0].split("#")[0].trim();
    if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

    await prisma.funnel.deleteMany({
      where: { id, shopDomain: session.shop },
    });

    return json({ ok: true });
  }
  return json({ ok: false }, { status: 400 });
}

/* ---------------- helper: корректная ссылка на Settings --- */
function buildSettingsHref(id, search) {
  const params = new URLSearchParams(search);
  params.set("id", id);
  return `/app/settings?${params.toString()}`;
}

/* ---------------- Компонент действий в строке ---------------- */
function RowActions({ id, name, editHref }) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const isDeleting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_intent") === "delete" &&
    fetcher.formData?.get("id") === id;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setOpen(false);
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const goEdit = () => {
    setOpen(false);
    nav(editHref);
  };

  const remove = () => {
    if (!confirm(`Remove funnel “${name}”?`)) return;
    fetcher.submit({ _intent: "delete", id }, { method: "post" });
  };

  const activator = (
    <Button variant="plain" disclosure onClick={() => setOpen((v) => !v)}>
      {isDeleting ? (
        <InlineStack gap="150" blockAlign="center">
          <Spinner size="small" />
          <span>Removing…</span>
        </InlineStack>
      ) : (
        "Actions"
      )}
    </Button>
  );

  return (
    <Popover active={open} activator={activator} onClose={() => setOpen(false)}>
      <ActionList
        actionRole="menuitem"
        items={[
          { content: "Edit", onAction: goEdit },
          { content: "Delete", destructive: true, onAction: remove },
        ]}
      />
    </Popover>
  );
}

/* ---------------- UI ---------------- */
export default function FunnelsPage() {
  const { funnels, sort, dir } = useLoaderData();
  const nav = useNavigate();
  const { search } = useLocation();

  const sortColumnIndex = sort === 'name' ? 0 : sort === 'discount' ? 1 : undefined;
  const sortDirection   = dir === 'asc' ? 'ascending' : 'descending';

  const updateSearch = (patch) => {
    const url = new URL(window.location.href);
    Object.entries(patch).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    nav(`${url.pathname}${url.search}`);
  };

  const onSort = (index, direction) => {
    // маппим индекс колонки → поле сортировки в БД
    const map = { 0: 'name', 1: 'discount' };
    const nextSort = map[index];
    if (!nextSort) return;
    updateSearch({ sort: nextSort, dir: direction === 'ascending' ? 'asc' : 'desc' });
  };

  return (
    <Page
      title=""
    >
      <InlineStack align="space-between" blockAlign="center">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h1" variant="heading2xl">Funnels</Text>
          <Tooltip content="List of funnels used for post-purchase">
            <Icon source={InfoIcon} tone="subdued" />
          </Tooltip>
        </InlineStack>
        <Button variant="secondary" onClick={() => nav(`/app/settings${search}`)}>Create a new funnel</Button>
      </InlineStack>

      <Box paddingBlockEnd="300" />
      <Divider borderColor="border-brand" />
      <Box paddingBlockEnd="500" />

      <IndexTable
        resourceName={{ singular: 'funnel', plural: 'funnels' }}
        itemCount={funnels.length}
        headings={[
          { title: 'Name',     sortable: true },
          { title: 'Discount', alignment: 'center', sortable: true },
          { title: 'Trigger' },
          { title: 'Offer' },
          { title: 'Status' },
          { title: 'Actions' },
        ]}
        sortable={[true, false, false, false, false, false]}
        sortColumnIndex={sortColumnIndex}
        sortDirection={sortDirection}
        onSort={onSort}
        selectable={false}
        emptyState={<Text>No funnels found</Text>}
      >
        {funnels.map((f, i) => (
          <IndexTable.Row id={f.id} key={f.id} position={i}>
            <IndexTable.Cell>{f.name}</IndexTable.Cell>

            <IndexTable.Cell>
              <Text as="span" alignment="center">{f.discountPct}%</Text>
            </IndexTable.Cell>

            <IndexTable.Cell>{f.triggerTitle}</IndexTable.Cell>
            <IndexTable.Cell>{f.offerTitle}</IndexTable.Cell>
            <IndexTable.Cell>{f.active ? 'Active' : 'Disabled'}</IndexTable.Cell>

            <IndexTable.Cell>
              <RowActions id={f.id} name={f.name} editHref={buildSettingsHref(f.id, search)} />
            </IndexTable.Cell>

          </IndexTable.Row>
        ))}
      </IndexTable>
    </Page>
  );
}
