// Клиентский фасад для App Bridge ResourcePicker без импортов CJS-пакетов.
// Работает только в браузере, внутри встраиваемого приложения.

function getAB() {
  // разные варианты, которые встречаются в админке
  return (
    (typeof window !== "undefined" &&
      (window.Shopify?.AppBridge || window.appBridge || window["app-bridge"])) ||
    null
  );
}

export const ResourcePicker = {
  create(app, opts) {
    const RP = getAB()?.actions?.ResourcePicker;
    if (!RP) throw new Error("App Bridge ResourcePicker недоступен");
    return RP.create(app, opts);
  },
  get Action() {
    return getAB()?.actions?.ResourcePicker?.Action;
  },
  get ResourceType() {
    return getAB()?.actions?.ResourcePicker?.ResourceType;
  },
};
