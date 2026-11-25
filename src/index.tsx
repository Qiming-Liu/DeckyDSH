import { routerHook } from "@decky/api";
import { definePlugin } from "@decky/ui";
import { useEffect, useState } from "react";
import { getStatus } from "./utils/backend";
import { initLanguage, PLUGIN_NAME } from "./utils/i18n";
import { SETTINGS_ROUTE, SETUP_ROUTE } from "./utils/routes";
import { SettingsPage } from "./views/Pages";
import Panel from "./views/Panel";
import SetupPage from "./views/SetupPage";
import { PluginGlyph } from "./views/icons";

/** The Quick Access title: the plugin's name and, on the right, its version. */
function Title() {
  const [version, setVersion] = useState("");
  useEffect(() => { void getStatus().then(status => setVersion(status.plugin_version)).catch(() => undefined); }, []);
  return <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
    <span>{PLUGIN_NAME}</span>
    {version && <span style={{ padding: "0 8px", border: "1px solid rgba(255,255,255,.14)", borderRadius: 10, fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, fontWeight: 400, color: "#8b929a" }}>v{version}</span>}
  </div>;
}

export default definePlugin(() => {
  void initLanguage();
  routerHook.addRoute(SETUP_ROUTE, SetupPage, { exact: true });
  routerHook.addRoute(SETTINGS_ROUTE, SettingsPage, { exact: true });

  return {
    name: PLUGIN_NAME,
    titleView: <Title />,
    content: <Panel />,
    icon: <PluginGlyph />,
    onDismount() {
      routerHook.removeRoute(SETUP_ROUTE);
      routerHook.removeRoute(SETTINGS_ROUTE);
    },
  };
});
