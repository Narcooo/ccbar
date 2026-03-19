import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { isDirectExecution } from "../dist/cli.js";

test("isDirectExecution treats /tmp and /private/tmp as the same file", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ccbar-cli-entry-"));
  const scriptPath = path.join(tmpDir, "entry.js");

  await writeFile(scriptPath, "export {};\n", "utf8");

  const tmpAliasPath = scriptPath.replace("/private/tmp/", "/tmp/");
  const metaUrl = pathToFileURL(scriptPath).href;

  assert.equal(isDirectExecution(metaUrl, tmpAliasPath), true);
});
