import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LAYOUT = [
  ["5h", "today", "history"],
  ["7d", "session", "total"],
];

export const DEFAULT_COMPACT_LAYOUT = [
  ["5h", "today"],
  ["7d", "session"],
];

export const DEFAULT_AUTO_COLUMNS = 110;
export const DEFAULT_COMPACT_BREAKPOINT = 113;

export const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "ccbar",
  "config.json",
);

export type PluginConfig = {
  rows?: string[][] | null;
  compactRows?: string[][] | null;
  columns?: number | null;
  compactBreakpoint?: number | null;
};

function parseRows(value: unknown): string[][] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const rows = value.map((row) =>
    Array.isArray(row)
      ? row.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [],
  );

  return rows.length > 0 && rows.every((row) => row.length > 0) ? rows : null;
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

export async function loadConfig(
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<PluginConfig> {
  try {
    const content = await readFile(configPath, "utf8");
    const parsed = JSON.parse(content) as Partial<PluginConfig>;
    return {
      rows: parseRows(parsed.rows),
      compactRows: parseRows(parsed.compactRows),
      columns: parsePositiveInteger(parsed.columns),
      compactBreakpoint: parsePositiveInteger(parsed.compactBreakpoint),
    };
  } catch {
    return {
      rows: null,
      compactRows: null,
      columns: null,
      compactBreakpoint: null,
    };
  }
}
