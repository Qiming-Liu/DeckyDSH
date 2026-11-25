import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { README_TRANSLATIONS, readmeUrl } from "../../src/utils/readme.ts";

const repository = "https://github.com/Qiming-Liu/DeckyDSH";

test("the About page opens the README in the reader's language", () => {
  assert.equal(readmeUrl(repository, "en"), `${repository}#deckydsh`);
  assert.equal(readmeUrl(repository, "zh-CN"), `${repository}/blob/main/README.zh-CN.md#deckydsh`);
  assert.equal(readmeUrl(repository, "zh-TW"), `${repository}/blob/main/README.zh-TW.md#deckydsh`);
  // A language without a translation gets the English front page.
  assert.equal(readmeUrl(repository, "ja"), `${repository}#deckydsh`);
});

test("every README a link points to exists and links to the others", () => {
  const files = ["README.md", ...Object.values(README_TRANSLATIONS)];
  for (const file of files) {
    const url = new URL(`../../${file}`, import.meta.url);
    assert.ok(existsSync(url), file);
    const text = readFileSync(url, "utf8");
    assert.match(text, /^# DeckyDSH$/m, `${file} keeps the heading the link's anchor names`);
    assert.ok(text.includes("(docs/cover.png)"), `${file} shows the cover`);
    for (const other of files.filter(name => name !== file)) assert.ok(text.includes(`(${other})`), `${file} links to ${other}`);
  }
});

test("the store card uses the cover from main", () => {
  const plugin = JSON.parse(readFileSync(new URL("../../plugin.json", import.meta.url), "utf8"));
  assert.equal(plugin.publish.image, "https://raw.githubusercontent.com/Qiming-Liu/DeckyDSH/main/docs/cover.png");
  assert.ok(existsSync(new URL("../../docs/cover.png", import.meta.url)));
});
