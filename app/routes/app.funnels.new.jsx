import { redirect } from "@remix-run/node";
export const loader = ({ request }) => {
  const u = new URL(request.url);
  return redirect(`/app/settings${u.search}`);
};
export const action = loader;
export default function () { return null; }
