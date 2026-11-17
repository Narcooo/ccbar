import { spawn } from "node:child_process";
import { openSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import tty from "node:tty";
import { fileURLToPath } from "node:url";
import { resolveCacheDir } from "./cache-dir.js";
import { DEFAULT_AUTO_COLUMNS, loadConfig } from "./config.js";
import { doctorStatusline, repairStatusline, setupStatusline } from "./install.js";
import { acquireRefreshLock, quotaCachePath, quotaLockPath, readQuotaCache, releaseRefreshLock, writeQuotaCache, } from "./quota-cache.js";
import { isQuotaRefreshDue, refreshQuota, selectRenderableQuota } from "./quota.js";
import { getModelName, renderStatusline } from "./statusline.js";
import { scanTokenStats } from "./transcript.js";
const RENDER_FLAGS = new Set(["--append-model"]);
function createProcessIo() {
    return {
        readStdin: async () => {
            const chunks = [];
            for await (const chunk of process.stdin) {
                chunks.push(String(chunk));
            }
            return chunks.join("");
        },
        writeStdout: (value) => {
            process.stdout.write(value);
        },
        // The quota fetch (auth check, keychain, network) runs in its own process, detached so
        // that it survives this render exiting or being cancelled.
        spawnQuotaRefresh: () => {
            spawn(process.execPath, [fileURLToPath(import.meta.url), "refresh-quota"], {
                detached: true,
                stdio: "ignore",
            }).unref();
        },
    };
}
export function isDirectExecution(metaUrl, argvPath) {
    if (!argvPath) {
        return false;
    }
    try {
        const metaPath = realpathSync.native(fileURLToPath(metaUrl));
        const execPath = realpathSync.native(argvPath);
        return metaPath === execPath;
    }
    catch {
        return false;
    }
}
function parsePositiveInteger(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        const normalized = Math.trunc(value);
        return normalized > 0 ? normalized : null;
    }
    if (typeof value === "string" && value.trim()) {
        const normalized = Number.parseInt(value, 10);
        return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
    }
    return null;
}
// Claude Code captures stdout, so the width is only available from COLUMNS (which current
// versions set) or from the controlling terminal itself.
function readTtyColumns() {
    let fd;
    try {
        fd = openSync("/dev/tty", "r+");
    }
    catch (error) {
        // ENXIO: this process has no controlling terminal. ENOENT: the platform has no /dev/tty.
        const code = error.code;
        if (code === "ENXIO" || code === "ENOENT") {
            return null;
        }
        throw error;
    }
    const terminal = new tty.WriteStream(fd);
    const columns = parsePositiveInteger(terminal.columns);
    terminal.destroy();
    return columns;
}
export function resolveColumns(configuredColumns, runtime) {
    const configured = parsePositiveInteger(configuredColumns);
    if (configured != null) {
        return configured;
    }
    const stdoutColumns = parsePositiveInteger(runtime?.stdoutColumns ?? process.stdout.columns);
    if (stdoutColumns != null) {
        return stdoutColumns;
    }
    const envColumns = parsePositiveInteger(runtime?.envColumns ?? process.env.COLUMNS);
    if (envColumns != null) {
        return envColumns;
    }
    const ttyColumns = parsePositiveInteger(runtime?.ttyColumns);
    if (ttyColumns != null) {
        return ttyColumns;
    }
    return readTtyColumns() ?? DEFAULT_AUTO_COLUMNS;
}
export async function main(argv = process.argv.slice(2), io = createProcessIo()) {
    const flags = argv.filter((argument) => argument.startsWith("--"));
    const command = argv.find((argument) => !argument.startsWith("--")) ?? "render";
    const unknownFlag = flags.find((flag) => !RENDER_FLAGS.has(flag));
    if (unknownFlag) {
        throw new Error(`ccbar: unknown option ${unknownFlag}`);
    }
    if (command === "setup") {
        await setupStatusline();
        io.writeStdout("ccbar statusline configured\n");
        return;
    }
    if (command === "repair") {
        const repaired = await repairStatusline();
        if (repaired) {
            io.writeStdout("ccbar statusline repaired\n");
        }
        return;
    }
    if (command === "doctor") {
        const report = await doctorStatusline();
        io.writeStdout(`${JSON.stringify(report, null, 2)}\n`);
        return;
    }
    const cacheDir = resolveCacheDir();
    const quotaPath = quotaCachePath(cacheDir);
    const quotaLock = quotaLockPath(cacheDir);
    if (command === "refresh-quota") {
        // If this throws, the lock is left to expire, which spaces out the retries.
        writeQuotaCache(quotaPath, await refreshQuota(readQuotaCache(quotaPath)));
        releaseRefreshLock(quotaLock);
        return;
    }
    const rawInput = await io.readStdin();
    if (!rawInput.trim()) {
        io.writeStdout("");
        return;
    }
    const input = JSON.parse(rawInput);
    const config = await loadConfig(process.env.CCBAR_CONFIG_PATH);
    const projectsDir = process.env.CCBAR_PROJECTS_DIR ?? path.join(os.homedir(), ".claude", "projects");
    // The render never waits for auth or the network. When the stored quota is due for
    // renewal it starts a background refresh, and it shows whatever the last refresh stored.
    // The refresh is started before the transcript scan so that it also makes progress
    // during a long first scan, or when Claude Code cancels this render.
    const startedAt = Date.now();
    if (isQuotaRefreshDue(readQuotaCache(quotaPath), startedAt) &&
        acquireRefreshLock(quotaLock, startedAt)) {
        io.spawnQuotaRefresh();
    }
    const tokens = await scanTokenStats(projectsDir, cacheDir);
    const quota = selectRenderableQuota(readQuotaCache(quotaPath), Date.now());
    const columns = resolveColumns(config.columns);
    const output = renderStatusline(input, {
        tokens,
        quota,
        columns,
        config,
    });
    const lines = output.split("\n");
    const firstLine = flags.includes("--append-model")
        ? `${lines[0]} ${getModelName(input)}`
        : lines[0];
    for (const line of [firstLine, ...lines.slice(1)]) {
        io.writeStdout(`${line}\n`);
    }
}
if (isDirectExecution(import.meta.url, process.argv[1])) {
    void main();
}
