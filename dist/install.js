import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
export function buildPluginCommand(mode = "render") {
    const modeArg = mode === "render" ? "" : ` ${mode}`;
    return [
        "sh -lc '",
        'PLUGIN_DIR=$(find "$HOME/.claude/plugins/cache" -mindepth 3 -maxdepth 3 -type d -path "*/ccbar/*" 2>/dev/null | sort | tail -n 1); ',
        '[ -n "$PLUGIN_DIR" ] || exit 0; ',
        `exec node "$PLUGIN_DIR/dist/cli.js"${modeArg}`,
        "'",
    ].join("");
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
