import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { shouldRepairStatusline } from "../dist/install.js";

test("shouldRepairStatusline returns true when statusLine is missing", () => {
  assert.equal(shouldRepairStatusline({}, "/tmp/ccbar"), true);
});

test("shouldRepairStatusline returns false when command already matches", () => {
  assert.equal(
    shouldRepairStatusline(
      {
        statusLine: {
          type: "command",
          command: "/tmp/ccbar",
          padding: 0,
        },
      },
      "/tmp/ccbar",
    ),
    false,
  );
});

test("plugin command and hook assets exist", () => {
  assert.equal(existsSync("commands/setup.md"), true);
  assert.equal(existsSync("commands/configure.md"), true);
  assert.equal(existsSync("commands/doctor.md"), true);
  assert.equal(existsSync("hooks/hooks.json"), true);

  const hooks = JSON.parse(readFileSync("hooks/hooks.json", "utf8"));
  assert.equal(Array.isArray(hooks.hooks.SessionStart), true);
});

test("setup and hook docs do not hardcode a marketplace-specific cache path", () => {
  const hooks = readFileSync("hooks/hooks.json", "utf8");
  const setup = readFileSync("commands/setup.md", "utf8");
  const doctor = readFileSync("commands/doctor.md", "utf8");

  assert.equal(hooks.includes('plugins/cache/ccbar/ccbar'), false);
  assert.equal(setup.includes('plugins/cache/ccbar/ccbar'), false);
  assert.equal(doctor.includes('plugins/cache/ccbar/ccbar'), false);
});
