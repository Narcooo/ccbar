import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUTO_COLUMNS, loadConfig } from "./config.js";
import { doctorStatusline, repairStatusline, setupStatusline } from "./install.js";
import { resolveRenderableQuota } from "./quota.js";
import { renderStatusline } from "./statusline.js";
import { scanTokenStats } from "./transcript.js";
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
export function resolveColumns(configuredColumns, runtime = {
    stdoutColumns: process.stdout.columns,
    envColumns: process.env.COLUMNS,
}) {
    return (parsePositiveInteger(configuredColumns) ??
        parsePositiveInteger(runtime.stdoutColumns) ??
        parsePositiveInteger(runtime.envColumns) ??
        DEFAULT_AUTO_COLUMNS);
}
export async function main(argv = process.argv.slice(2), io = createProcessIo()) {
    const command = argv[0] ?? "render";
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
    const rawInput = await io.readStdin();
    if (!rawInput.trim()) {
        io.writeStdout("");
        return;
    }
    const input = JSON.parse(rawInput);
    const config = await loadConfig(process.env.CCBAR_CONFIG_PATH);
    const projectsDir = process.env.CCBAR_PROJECTS_DIR ?? path.join(os.homedir(), ".claude", "projects");
    const tokens = await scanTokenStats(projectsDir);
    const quota = await resolveRenderableQuota();
    const columns = resolveColumns(config.columns);
    const output = renderStatusline(input, {
        tokens,
        quota,
        columns,
        config,
    });
    for (const line of output.split("\n")) {
        io.writeStdout(`${line}\n`);
    }
}
if (isDirectExecution(import.meta.url, process.argv[1])) {
    void main();
}
