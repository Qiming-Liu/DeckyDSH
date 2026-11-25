import { useSyncExternalStore } from "react";
import { en, zhCN, zhTW, Translations } from "./locales";

/** The plugin's name is never translated. */
export const PLUGIN_NAME = "DeckyDSH";

export type Locale = "en" | "zh-CN" | "zh-TW";
const CATALOGS: Record<Locale, Translations> = { en, "zh-CN": zhCN, "zh-TW": zhTW };

let current: Locale = "en";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function steamLocale(language: unknown): Locale {
  if (typeof language !== "string") return "en";
  const value = language.trim().toLowerCase().replace(/_/g, "-");
  if (["schinese", "zh-cn", "zh-sg", "zh-hans", "zh"].includes(value)) return "zh-CN";
  if (["tchinese", "zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(value)) return "zh-TW";
  return "en";
}

export async function initLanguage(): Promise<void> {
  try {
    const next = steamLocale(await SteamClient.Settings.GetCurrentLanguage());
    if (next !== current) {
      current = next;
      listeners.forEach(listener => listener());
    }
  } catch {
    // Keep English if Steam can't answer yet.
  }
}

export function translate(locale: Locale, key: keyof Translations, values: Record<string, string> = {}): string {
  return CATALOGS[locale][key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** The language Steam is set to. */
export const getLanguage = (): Locale => current;

/** Translation function that re-renders the component when Steam's language changes. */
export function useT() {
  const locale = useSyncExternalStore(subscribe, () => current);
  return (key: keyof Translations, values?: Record<string, string>) => translate(locale, key, values);
}
