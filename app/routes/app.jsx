import { Link, Outlet, useLoaderData, useRouteError } from '@remix-run/react';
import { boundary } from '@shopify/shopify-app-remix/server';
import { AppProvider } from '@shopify/shopify-app-remix/react';
import polarisStyles from '@shopify/polaris/build/esm/styles.css?url';
import { authenticate } from '../shopify.server';
import * as AppBridgeReact from '@shopify/app-bridge-react';
import { useEffect, useState } from 'react';

const { NavMenu } = AppBridgeReact;

export const links = () => [{ rel: 'stylesheet', href: polarisStyles }];

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || '' };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    // глушилка sendBeacon в dev (оставь как было у тебя, если нужно)
    if (import.meta.env.DEV && 'sendBeacon' in navigator) {
      const orig = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        try { return orig(url, data) || true; } catch { return true; }
      };
    }
  }, []);

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {hydrated && (
        <NavMenu>
          <Link to="/app" rel="home">Home</Link>
          <Link to="/app/funnels">Funnels</Link>
        </NavMenu>
      )}
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (args) => boundary.headers(args);
