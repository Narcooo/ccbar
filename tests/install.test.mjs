import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyStatuslineSettings,
  buildPluginCommand,
  repairStatusline,
  setupStatusline,
} from "../dist/install.js";
import { makeTempDir } from "./helpers/fixture.mjs";

const DIST_CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("applyStatuslineSettings preserves unrelated settings", () => {
  const result = applyStatuslineSettings(
    {
      theme: "dark",
      hooks: { enabled: true },
    },
    "/tmp/ccbar",
  );

  assert.equal(result.theme, "dark");
  assert.deepEqual(result.hooks, { enabled: true });
  assert.equal(result.statusLine.type, "command");
  assert.equal(result.statusLine.command, "/tmp/ccbar");
  assert.equal(result.statusLine.padding, 0);
});

test("buildPluginCommand runs this install's cli directly, without a login shell or a find", () => {
  const command = buildPluginCommand();

  assert.equal(command, `node '${DIST_CLI}' --append-model`);
  assert.equal(existsSync(DIST_CLI), true);
  assert.equal(command.includes("sh -lc"), false);
  assert.equal(command.includes("find "), false);
  assert.equal(command.includes("jq"), false);
});

test("buildPluginCommand quotes paths for the shell", () => {
  assert.equal(
    buildPluginCommand("/tmp/it's here/dist/cli.js"),
    "node '/tmp/it'\\''s here/dist/cli.js' --append-model",
  );
});

test("repairStatusline rewrites the command when the plugin directory changed", async () => {
  const settingsPath = path.join(makeTempDir("ccbar-install-"), "settings.json");
  const oldCommand = buildPluginCommand("/plugins/cache/narcooo/ccbar/1.2.1/dist/cli.js");
  const newCommand = buildPluginCommand("/plugins/cache/narcooo/ccbar/1.3.0/dist/cli.js");

  await setupStatusline(settingsPath, oldCommand);
  writeFileSync(
    settingsPath,
    JSON.stringify({ ...JSON.parse(readFileSync(settingsPath, "utf8")), theme: "dark" }),
  );

  assert.equal(await repairStatusline(settingsPath, oldCommand), false);
  assert.equal(await repairStatusline(settingsPath, newCommand), true);

  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(settings.statusLine.command, newCommand);
  assert.equal(settings.theme, "dark");
  assert.equal(await repairStatusline(settingsPath, newCommand), false);
});
