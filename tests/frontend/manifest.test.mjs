import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));

test("the runtime manifest matches the dsh version the submodule pins", t => {
  const cli = new URL("../../dsh/apps/cli/package.json", import.meta.url);
  if (!existsSync(cli)) return t.skip("dsh submodule not checked out");
  assert.equal(read("runtime/manifest.json").dsh, JSON.parse(readFileSync(cli, "utf8")).version);
});

test("plugin.json keeps the published name", () => {
  assert.equal(read("plugin.json").name, "DeckyDSH");
});
