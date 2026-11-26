import { ButtonItem, Navigation, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";
import { getStatus, RuntimeStatus } from "../utils/backend";
import { megabytes } from "../utils/format";
import { useT } from "../utils/i18n";
import { SETUP_ROUTE } from "../utils/routes";
import { colors } from "../utils/theme";
import Chat from "./Chat";

function open(route: string) {
  Navigation.Navigate(route);
  Navigation.CloseSideMenus();
}

/** The Quick Access content: the installer's entry until dsh is set up, then the chat. */
export default function Panel() {
  const t = useT();
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getStatus().then(next => { if (live) setStatus(next); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (failed) return <PanelSection><PanelSectionRow>{t("statusFailed")}</PanelSectionRow></PanelSection>;
  if (!status) return <PanelSection><PanelSectionRow>{t("checking")}</PanelSectionRow></PanelSection>;

  if (!status.supported) {
    const message = status.reason === "old_glibc"
      ? t("oldGlibc", { required: status.required_glibc, found: status.glibc ?? "?" })
      : t("unsupportedCpu", { platform: status.platform });
    return <PanelSection><PanelSectionRow>{message}</PanelSectionRow></PanelSection>;
  }

  // Voice is the only input, so speech recognition is part of setup where this CPU can run it.
  const voiceReady = status.voice_installed || !status.voice_supported;
  if (!status.installed || !status.has_api_key || !voiceReady) {
    // PanelSection titles are upper-cased by Steam, which mangles the product name.
    return <PanelSection>
      <PanelSectionRow><div style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{t("setupTitle")}</div></PanelSectionRow>
      <PanelSectionRow>{t("setupBody", { size: megabytes((status.download_size ?? 0) + (status.voice_supported ? status.voice_download_size ?? 0 : 0)) })}</PanelSectionRow>
      <PanelSectionRow>{t("setupNoSudo")}</PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => open(SETUP_ROUTE)}>
          {status.installed || status.has_api_key || status.voice_installed ? t("finishSetup") : t("startSetup")}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>;
  }

  return <Chat />;
}
