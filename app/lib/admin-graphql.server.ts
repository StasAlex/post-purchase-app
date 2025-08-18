import {prisma} from "./prisma.server";

export async function adminGraphql(shopDomain: string, query: string, variables: any = {}) {
  const sess = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    orderBy: { id: 'desc' },
  });
  if (!sess?.accessToken) throw new Error(`No Admin token for ${shopDomain}`);

  const res = await fetch(`https://${shopDomain}/admin/api/2024-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": sess.accessToken,
    },
    body: JSON.stringify({query, variables}),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data;
}
