import { redirect } from "@remix-run/node";
export const loader = ({ params, request }) => {
  const u = new URL(request.url);
  return redirect(`/app/settings?id=${params.id}${u.search}`);
};
export const action = loader;
export default function () { return null; }
