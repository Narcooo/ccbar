import assert from "node:assert/strict";
import test from "node:test";

import { applyStatuslineSettings } from "../dist/install.js";

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
