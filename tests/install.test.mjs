import assert from "node:assert/strict";
import test from "node:test";

import { applyStatuslineSettings, buildPluginCommand } from "../dist/install.js";

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

test("buildPluginCommand resolves ccbar across marketplaces", () => {
  const command = buildPluginCommand();

  assert.equal(command.includes('plugins/cache/ccbar/ccbar'), false);
  assert.equal(command.includes('find "$HOME/.claude/plugins/cache"'), true);
  assert.equal(command.includes('-path "*/ccbar/*"'), true);
});
