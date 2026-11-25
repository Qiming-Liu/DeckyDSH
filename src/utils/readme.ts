// Where the About page sends a reader: the README in their language.

/** Translated READMEs by plugin locale; English is the repository's front page. */
export const README_TRANSLATIONS: Readonly<Record<string, string>> = {
  "zh-CN": "README.zh-CN.md",
  "zh-TW": "README.zh-TW.md",
};

const ANCHOR = "deckydsh";

/**
 * The project's README for `locale`. Release packages carry only the English
 * README, so the translations are read on GitHub.
 */
export function readmeUrl(repository: string, locale: string): string {
  const file = README_TRANSLATIONS[locale];
  return file ? `${repository}/blob/main/${file}#${ANCHOR}` : `${repository}#${ANCHOR}`;
}
