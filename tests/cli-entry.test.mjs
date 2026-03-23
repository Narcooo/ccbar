import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { DEFAULT_AUTO_COLUMNS } from "../dist/config.js";
import { isDirectExecution, resolveColumns } from "../dist/cli.js";

test("isDirectExecution treats /tmp and /private/tmp as the same file", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ccbar-cli-entry-"));
  const scriptPath = path.join(tmpDir, "entry.js");

  await writeFile(scriptPath, "export {};\n", "utf8");

  const tmpAliasPath = scriptPath.replace("/private/tmp/", "/tmp/");
  const metaUrl = pathToFileURL(scriptPath).href;

  assert.equal(isDirectExecution(metaUrl, tmpAliasPath), true);
});

test("resolveColumns prefers explicit overrides, then runtime width, then safe fallback", () => {
  assert.equal(
    resolveColumns(96, { stdoutColumns: 120, envColumns: "88" }),
    96,
  );
  assert.equal(
    resolveColumns(null, { stdoutColumns: 118, envColumns: "88" }),
    118,
  );
  assert.equal(
    resolveColumns(null, { stdoutColumns: undefined, envColumns: "101" }),
    101,
  );
  assert.equal(
    resolveColumns(null, { stdoutColumns: undefined, envColumns: undefined }),
    DEFAULT_AUTO_COLUMNS,
  );
});
