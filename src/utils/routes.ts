import { Navigation } from "@decky/ui";

export const SETUP_ROUTE = "/decky-dsh/setup";
export const SETTINGS_ROUTE = "/decky-dsh/settings";

let startOver = false;

/** Opens setup at its first step (the key), not at the first unfinished one. */
export function openSetupFromStart() {
  startOver = true;
  Navigation.Navigate(SETUP_ROUTE);
}

/** Read once by the setup page as it opens. */
export function takeSetupStartOver() {
  const value = startOver;
  startOver = false;
  return value;
}
