// app/routes/app.funnels._index.jsx
import { json } from "@remix-run/node";
import {
  useNavigate,
  useLocation,
  Link,
  useLoaderData,
  useFetcher,
  useRevalidator,
} from "@remix-run/react";
import { Page, Card, IndexTable, InlineStack, Button, Text, Spinner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { prisma } from "../lib/prisma.server";
import { useEffect } from "react";

/* ---------------- loader: только новая схема ---------------- */
export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);

  const funnels = await prisma.funnel.findMany({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      discountPct: true,
      active: true,
      triggerProductGid: true,
      offerProductGid: true,
    },
  });

  const ids = Array.from(
    new Set(funnels.flatMap((f) => [f.triggerProductGid, f.offerProductGid].filter(Boolean)))
  );

  let titleById = {};
  if (ids.length) {
    const resp = await admin.graphql(
      `#graphql
      query($ids: [ID!]!) {
        nodes(ids: $ids) {
          id
          ... on Product { title }
        }
      }`,
      { variables: { ids } }
    );
    if (resp.ok) {
      const data = await resp.json();
      titleById = Object.fromEntries(
        (data?.data?.nodes || []).filter(Boolean).map((n) => [n.id, n.title])
      );
    }
  }

  const rows = funnels.map((f) => ({
    id: f.id,
    name: f.name,
    discountPct: f.discountPct,
    active: f.active,
    triggerTitle: titleById[f.triggerProductGid] || "—",
    offerTitle: titleById[f.offerProductGid] || "—",
  }));

  return json({ funnels: rows });
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

  const isDeleting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_intent") === "delete" &&
    fetcher.formData?.get("id") === id;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  return (
    <InlineStack gap="200">
      <Link to={editHref}>
        <Button>Edit</Button>
      </Link>

      <fetcher.Form
        method="post"
        onSubmit={(e) => {
          if (!confirm(`Remove funnel “${name}”?`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="_intent" value="delete" />
        <input type="hidden" name="id" value={id} />
        <Button tone="critical" submit loading={isDeleting}>
          {isDeleting ? "Removing…" : "Delete"}
        </Button>
      </fetcher.Form>
    </InlineStack>
  );
}

/* ---------------- UI ---------------- */
export default function FunnelsPage() {
  const { funnels } = useLoaderData();
  const nav = useNavigate();
  const { search } = useLocation();

  return (
    <Page
      title="Funnels"
      fullWidth
      primaryAction={{
        content: "Create funnel",
        onAction: () => nav(`/app/settings${search}`),
      }}
    >
      <Card>
        <IndexTable
          resourceName={{ singular: "funnel", plural: "funnels" }}
          itemCount={funnels.length}
          headings={[
            { title: "Name" },
            { title: "Discount %" },
            { title: "Trigger" },
            { title: "Offer" },
            { title: "Status" },
            { title: "Actions" },
          ]}
          emptyState={
            <div style={{ padding: 24 }}>
              <Text>No funnels found</Text>
            </div>
          }
          selectable={false}
        >
          {funnels.map((f, i) => (
            <IndexTable.Row id={f.id} key={f.id} position={i}>
              <IndexTable.Cell>{f.name}</IndexTable.Cell>
              <IndexTable.Cell>{f.discountPct}%</IndexTable.Cell>
              <IndexTable.Cell>{f.triggerTitle}</IndexTable.Cell>
              <IndexTable.Cell>{f.offerTitle}</IndexTable.Cell>
              <IndexTable.Cell>{f.active ? "Active" : "Disabled"}</IndexTable.Cell>
              <IndexTable.Cell>
                <RowActions
                  id={f.id}
                  name={f.name}
                  editHref={buildSettingsHref(f.id, search)}
                />
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}
