// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the remix server.
// The CLI will eventually stop passing HOST.
// Workaround из шаблона Shopify
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
  ignoredRouteFiles: ["**/.*"],
  appDirectory: "app",
  serverModuleFormat: "cjs",
  dev: { port: process.env.HMR_SERVER_PORT || 8002 },
  serverDependenciesToBundle: [/^@shopify\/app-bridge.*/], // <-- опционально
  future: {},
};
