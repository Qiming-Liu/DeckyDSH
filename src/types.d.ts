// The parts of Steam's global client API this plugin uses.
declare const SteamClient: {
  Settings: { GetCurrentLanguage(): Promise<string> };
};
