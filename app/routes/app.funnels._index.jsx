// app/routes/app.funnels._index.jsx
import {json, redirect} from '@remix-run/node';
import { useNavigate, useLocation, Link, Form, useLoaderData } from "@remix-run/react";
import {Page, Card, IndexTable, InlineStack, Button, Text} from '@shopify/polaris';
import {authenticate} from '../shopify.server';
import {prisma} from '../lib/prisma.server';

export async function loader({request}) {
  const {session} = await authenticate.admin(request);
  const funnels =
    (await prisma.funnel.findMany({
      where: {shopDomain: session.shop},
      include: {triggers: true, offers: true},
      orderBy: {createdAt: 'desc'},
    })) ?? [];
  return json({funnels});
}

export async function action({request}) {
  const form = await request.formData();
  if (form.get('_intent') === 'delete') {
    const id = String(form.get('id') || '');
    if (id) await prisma.funnel.delete({where: {id}});
    return redirect('/app/funnels');
  }
  return null;
}

export default function FunnelsPage() {
  const { funnels } = useLoaderData();
  const nav = useNavigate();
  const { search } = useLocation();

  return (
    <Page title="Funnels"
          fullWidth={true}
          primaryAction={{
            content: "Create funnel",
            onAction: () => nav(`/app/funnels/new${search}`),
          }}>
      <Card>
        <IndexTable
          resourceName={{singular: 'funnel', plural: 'funnels'}}
          itemCount={funnels.length}
          headings={[
            {title: 'Name'},
            {title: 'Discount %'},
            {title: 'Triggers'},
            {title: 'Offers'},
            {title: 'Status'},
            {title: 'Actions'},
          ]}
          emptyState={<div style={{padding: 24}}><Text>No funnels found</Text></div>}
          selectable={false}
        >
          {funnels.map((f, i) => (
            <IndexTable.Row id={f.id} key={f.id} position={i}>
              <IndexTable.Cell>{f.name}</IndexTable.Cell>
              <IndexTable.Cell>{f.discountPct}</IndexTable.Cell>
              <IndexTable.Cell>{f.triggers?.length ?? 0}</IndexTable.Cell>
              <IndexTable.Cell>{f.offers?.length ?? 0}</IndexTable.Cell>
              <IndexTable.Cell>{f.active ? 'Active' : 'Disabled'}</IndexTable.Cell>
              <IndexTable.Cell>
                <InlineStack gap="200">
                  <Link to={`/app/funnels/${f.id}`}><Button>Edit</Button></Link>
                  <Form method="post">
                    <input type="hidden" name="_intent" value="delete" />
                    <input type="hidden" name="id" value={f.id} />
                    <Button tone="critical" submit>Delete</Button>
                  </Form>
                </InlineStack>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}
