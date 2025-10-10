// Workaround из шаблона Shopify: переносим HOST -> SHOPIFY_APP_URL
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

/** @type {import('@remix-run/dev').AppConfig} */
export default {
  appDirectory: "app",
  ignoredRouteFiles: ["**/.*"],

  // ВАЖНО: сервер для Vercel
  server: "@remix-run/vercel",
  serverModuleFormat: "esm",

  // иногда нужно, чтобы app-bridge не попал в отдельный external
  serverDependenciesToBundle: [/^@shopify\/app-bridge.*/],

  // dev-порт только локально, Vercel это не использует
  dev: { port: Number(process.env.HMR_SERVER_PORT) || 8002 },

  future: {},
};
