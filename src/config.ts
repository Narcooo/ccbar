import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LAYOUT = [
  ["5h", "today", "history"],
  ["7d", "session", "total"],
];

export const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "ccbar",
  "config.json",
);

export type PluginConfig = {
  rows: string[][];
  columns?: number | null;
};

export async function loadConfig(
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<PluginConfig> {
  try {
    const content = await readFile(configPath, "utf8");
    const parsed = JSON.parse(content) as Partial<PluginConfig>;
    return {
      rows: parsed.rows ?? DEFAULT_LAYOUT,
      columns: parsed.columns ?? null,
    };
  } catch {
    return {
      rows: DEFAULT_LAYOUT,
      columns: null,
    };
  }
}
