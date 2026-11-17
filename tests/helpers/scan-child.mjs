// Runs one scan in a separate process so tests can vary TZ and run scans concurrently.
// usage: node scan-child.mjs <projectsDir> <cacheDir> <nowIso> [--with-legacy | --contend]
import { scanTokenStats } from "../../dist/transcript.js";
import { updateTranscriptIndex } from "../../dist/transcript-index.js";
import { resolveIndexDir } from "../../dist/transcript-store.js";
import { scanTokenStats as legacyScanTokenStats } from "./legacy-scan.mjs";

const [projectsDir, cacheDir, nowIso, flag] = process.argv.slice(2);
const now = new Date(nowIso);

if (flag === "--contend") {
  // publish after every file, so concurrent children collide on almost every generation
  updateTranscriptIndex(projectsDir, resolveIndexDir(cacheDir, projectsDir), { checkpointMs: 0 });
}

const incremental = await scanTokenStats(projectsDir, cacheDir, now);
const legacy = flag === "--with-legacy" ? await legacyScanTokenStats(projectsDir, now) : null;

process.stdout.write(JSON.stringify({ incremental, legacy }));
