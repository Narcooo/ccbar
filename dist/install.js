import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
function shellQuote(value) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
// The command Claude Code runs for every statusline update, so it has to be cheap: one
// node process started on the absolute path of this install, no login shell and no search
// of the plugin cache. The path changes when the plugin is updated into a new version
// directory; the SessionStart hook runs `repair` from that directory, which rewrites it.
export function buildPluginCommand(cliPath = fileURLToPath(new URL("./cli.js", import.meta.url))) {
    return `node ${shellQuote(cliPath)} --append-model`;
}
export function applyStatuslineSettings(settings, launcherPath) {
    return {
        ...settings,
        statusLine: {
            type: "command",
            command: launcherPath,
            padding: 0,
        },
    };
}
export function shouldRepairStatusline(settings, launcherPath) {
    const statusLine = settings.statusLine;
    if (!statusLine) {
        return true;
    }
    return (statusLine.type !== "command" ||
        statusLine.command !== launcherPath ||
        statusLine.padding !== 0);
}
export async function loadSettings(settingsPath = DEFAULT_SETTINGS_PATH) {
    try {
        const content = await readFile(settingsPath, "utf8");
        return JSON.parse(content);
    }
    catch {
        return {};
    }
}
async function backupSettings(settingsPath) {
    if (!existsSync(settingsPath)) {
        return;
    }
    const backupPath = `${settingsPath}.bak.${Date.now()}`;
    await copyFile(settingsPath, backupPath);
}
export async function saveSettings(settings, settingsPath = DEFAULT_SETTINGS_PATH) {
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(`${settingsPath}`, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}
export async function setupStatusline(settingsPath = DEFAULT_SETTINGS_PATH, launcherPath = buildPluginCommand()) {
    const settings = await loadSettings(settingsPath);
    const nextSettings = applyStatuslineSettings(settings, launcherPath);
    await backupSettings(settingsPath);
    await saveSettings(nextSettings, settingsPath);
    return true;
}
export async function repairStatusline(settingsPath = DEFAULT_SETTINGS_PATH, launcherPath = buildPluginCommand()) {
    const settings = await loadSettings(settingsPath);
    if (!shouldRepairStatusline(settings, launcherPath)) {
        return false;
    }
    await backupSettings(settingsPath);
    await saveSettings(applyStatuslineSettings(settings, launcherPath), settingsPath);
    return true;
}
export async function doctorStatusline(settingsPath = DEFAULT_SETTINGS_PATH, launcherPath = buildPluginCommand()) {
    const settings = await loadSettings(settingsPath);
    return {
        settingsPath,
        launcherPath,
        hasStatusLine: Boolean(settings.statusLine),
        needsRepair: shouldRepairStatusline(settings, launcherPath),
    };
}
