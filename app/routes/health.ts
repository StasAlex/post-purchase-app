import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader({}: LoaderFunctionArgs) {
  return new Response("ok", { status: 200 });
}
