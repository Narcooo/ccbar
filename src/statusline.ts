import {
  DEFAULT_AUTO_COLUMNS,
  DEFAULT_COMPACT_BREAKPOINT,
  DEFAULT_COMPACT_LAYOUT,
  DEFAULT_LAYOUT,
  type PluginConfig,
} from "./config.js";
import type { TokenStats } from "./transcript.js";

type StatuslineInput = {
  model?: string | { display_name?: string };
  workspace?: {
    current_dir?: string;
    project_dir?: string;
  };
  cwd?: string;
  context_window?: {
    used_percentage?: number;
  };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
};

type RenderState = {
  tokens: TokenStats;
  quota: Record<string, any> | null;
  columns?: number;
  now?: Date;
  config?: PluginConfig;
};

type Cell = {
  left: string;
  right?: string;
};

type StatsBucket = Omit<TokenStats, "projects">;

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const RESET = "\u001b[0m";

const COLORS = {
  sep: [60, 60, 70],
  label: [70, 110, 180],
  sess: [80, 105, 170],
  today: [65, 120, 175],
  week: [75, 115, 165],
  month: [85, 100, 160],
  ctx: [60, 125, 185],
  cost: [255, 210, 60],
  burn: [255, 190, 50],
  proj_: [240, 180, 50],
  tleft: [170, 150, 230],
  dur: [180, 155, 220],
  time: [240, 170, 110],
  tok: [200, 210, 230],
  model: [80, 220, 170],
  proj: [255, 140, 80],
  hit: [200, 170, 100],
  cache: [170, 145, 110],
  dim: [120, 120, 140],
  empty: [45, 45, 45],
  total: [110, 155, 200],
  "lines+": [80, 210, 100],
  "lines-": [220, 90, 90],
} as const;

type ColorName = keyof typeof COLORS;

function rgb(r: number, g: number, b: number): string {
  return `\u001b[1;38;2;${r};${g};${b}m`;
}

function paint(name: ColorName, value: string): string {
  const [r, g, b] = COLORS[name];
  return `${rgb(r, g, b)}${value}${RESET}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hslRgb(h: number, s = 0.8, l = 0.52): [number, number, number] {
  const hue = clamp(h, 0, 120);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else {
    r = x;
    g = c;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function gradientColor(pct: number): string {
  const ratio = clamp(pct, 0, 100) / 100;
  const hue = 120 * (1 - ratio * ratio);
  const [r, g, b] = hslRgb(hue);
  return rgb(r, g, b);
}

function contextColor(pct: number): string {
  const ratio = clamp(pct, 0, 100) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (ratio < 0.5) {
    const f = ratio / 0.5;
    r = 140 + 95 * f;
    g = 150 - 10 * f;
    b = 170 - 100 * f;
  } else {
    const f = (ratio - 0.5) / 0.5;
    r = 235 + 20 * f;
    g = 140 - 80 * f;
    b = 70 - 40 * f;
  }

  return rgb(Math.round(r), Math.round(g), Math.round(b));
}

function gradientBar(pct: number, width = 10): string {
  const clamped = clamp(pct, 0, 100);
  let filled = Math.floor((clamped * width) / 100);
  if (clamped > 0 && filled === 0) {
    filled = 1;
  }

  let bar = "";
  for (let index = 0; index < filled; index += 1) {
    const hue = 120 * (1 - (index + 0.5) / width);
    const [r, g, b] = hslRgb(hue);
    bar += `${rgb(r, g, b)}━`;
  }

  if (filled < width) {
    bar += `${paint("empty", "─".repeat(width - filled))}`;
  } else {
    bar += RESET;
  }

  return `${bar}${RESET}`;
}

function formatTimeLeft(value: unknown, now: Date, compact = false): string {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const resetAt = new Date(value);
  if (Number.isNaN(resetAt.getTime())) {
    return "";
  }

  const seconds = Math.floor((resetAt.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) {
    return paint("tleft", "resetting");
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 24) {
    return paint("tleft", `${Math.floor(hours / 24)}d${hours % 24}h`);
  }

  const suffix = minutes.toString().padStart(2, "0");
  return paint("tleft", compact ? `${hours}h${suffix}` : `${hours}h${suffix}m`);
}

function visibleLength(value: string): number {
  return value.replaceAll(ANSI_RE, "").length;
}

function padVisible(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleLength(value)));
}

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1e3).toFixed(1)}k`;
  return `${Math.trunc(value)}`;
}

function formatCost(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1e3).toFixed(1)}k`;
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}

function formatDuration(durationMs: number): string {
  if (durationMs <= 0) {
    return "";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours >= 24) {
    return `${Math.floor(totalHours / 24)}d${totalHours % 24}h`;
  }

  return `${totalHours}h${totalMinutes % 60}m`;
}

function formatTokenCache(
  tokens: number,
  cacheReadTokens: number,
  inputTokens: number,
  includeHitRate: boolean,
): string {
  let value = paint("tok", formatTokens(tokens));
  if (cacheReadTokens <= 0) {
    return value;
  }

  value += ` ${paint("cache", "♻")}${paint("hit", formatTokens(cacheReadTokens))}`;
  if (includeHitRate && inputTokens > 0) {
    const totalInput = cacheReadTokens + inputTokens;
    const hitRate = totalInput > 0 ? Math.trunc((cacheReadTokens * 100) / totalInput) : 0;
    value += `${paint("cache", `/${hitRate}%`)}`;
  }

  return value;
}

function shortenPath(input: string, maxLength = 25): string {
  if (!input || input.length <= maxLength) {
    return input;
  }

  const parts = input.split("/").filter(Boolean);
  const basename = parts.at(-1) ?? "";
  const lastTwo = parts.slice(-2).join("/");

  if (lastTwo && lastTwo.length + 2 <= maxLength) {
    return `…/${lastTwo}`;
  }

  if (basename && basename.length + 2 <= maxLength) {
    return `…/${basename}`;
  }

  return `${input.slice(0, maxLength - 1)}…`;
}

function getModelName(input: StatuslineInput): string {
  if (typeof input.model === "string") {
    return input.model;
  }

  return input.model?.display_name ?? "?";
}

function getProjectStats(tokens: TokenStats, projectDir: string): StatsBucket | null {
  const normalized = projectDir.replaceAll("/", "-").replaceAll("_", "-");

  for (const [name, stats] of Object.entries(tokens.projects)) {
    if (name.replaceAll("_", "-") === normalized) {
      return stats;
    }
  }

  return null;
}

function hasConfiguredRows(rows: PluginConfig["rows"] | PluginConfig["compactRows"]): rows is string[][] {
  return Array.isArray(rows) && rows.length > 0;
}

function rowsEqual(left: string[][], right: string[][]): boolean {
  return (
    left.length === right.length &&
    left.every((row, rowIndex) =>
      row.length === (right[rowIndex]?.length ?? -1) &&
      row.every((item, columnIndex) => item === right[rowIndex]?.[columnIndex]),
    )
  );
}

function resolveLayout(
  config: PluginConfig | undefined,
  maxColumns: number,
): { rows: string[][]; compact: boolean } {
  const configuredRows = hasConfiguredRows(config?.rows) ? config.rows : null;
  const configuredCompactRows = hasConfiguredRows(config?.compactRows)
    ? config.compactRows
    : null;
  const hasCustomWideRows =
    configuredRows != null && !rowsEqual(configuredRows, DEFAULT_LAYOUT);
  const wideRows: string[][] = hasCustomWideRows ? configuredRows : DEFAULT_LAYOUT;

  if (hasCustomWideRows && configuredCompactRows == null) {
    return {
      rows: wideRows,
      compact: false,
    };
  }

  const compactRows: string[][] = configuredCompactRows ?? DEFAULT_COMPACT_LAYOUT;
  const compactBreakpoint = Math.max(
    1,
    config?.compactBreakpoint ?? DEFAULT_COMPACT_BREAKPOINT,
  );

  const compact = maxColumns <= compactBreakpoint;
  return {
    rows: compact ? compactRows : wideRows,
    compact,
  };
}

function render5h(quota: Record<string, any> | null, now: Date, compact = false): Cell {
  const fiveHour = quota?.five_hour as Record<string, any> | undefined;
  const utilization =
    typeof fiveHour?.utilization === "number" ? Math.trunc(fiveHour.utilization) : null;

  if (utilization == null) {
    return {
      left: `${paint("label", "5h")} ${paint("dim", "--")}`,
    };
  }

  const resetAt = typeof fiveHour?.resets_at === "string" ? fiveHour.resets_at : null;

  return {
    left:
      `${paint("label", "5h")} ${gradientBar(utilization, compact ? 7 : 10)} ` +
      `${gradientColor(utilization)}${utilization}%${RESET}`,
    right: formatTimeLeft(resetAt, now, compact),
  };
}

function render7d(quota: Record<string, any> | null, now: Date, compact = false): Cell {
  const sevenDay = quota?.seven_day as Record<string, any> | undefined;
  const utilization =
    typeof sevenDay?.utilization === "number" ? Math.trunc(sevenDay.utilization) : null;

  if (utilization == null) {
    return {
      left: `${paint("label", "7d")} ${paint("dim", "--")}`,
    };
  }

  const resetAt = typeof sevenDay?.resets_at === "string" ? sevenDay.resets_at : null;

  return {
    left:
      `${paint("label", "7d")} ${gradientBar(utilization, compact ? 7 : 10)} ` +
      `${gradientColor(utilization)}${utilization}%${RESET}`,
    right: formatTimeLeft(resetAt, now, compact),
  };
}

function renderToday(
  globalStats: StatsBucket,
  projectStats: StatsBucket | null,
  compact = false,
): Cell {
  const left =
    `${paint("today", "today")} ${paint("tok", formatTokens(globalStats.today_tok))}`;

  if (!projectStats) {
    return {
      left,
      right: paint("cost", formatCost(globalStats.today_cost + globalStats.today_ccost)),
    };
  }

  return {
    left:
      `${left} ${paint("cost", formatCost(globalStats.today_cost + globalStats.today_ccost))}` +
      ` ${paint("dim", "›")} ${compact ? "" : `${paint("proj", "proj")} `}` +
      `${formatTokenCache(
        projectStats.today_tok,
        projectStats.today_cr_tok,
        projectStats.today_in_tok,
        true,
      )}`,
    right: paint("cost", formatCost(projectStats.today_cost + projectStats.today_ccost)),
  };
}

function renderHistory(globalStats: StatsBucket, projectStats: StatsBucket | null): Cell {
  let left =
    `${paint("week", "week")} ` +
    `${paint("cost", formatCost(globalStats.week_cost + globalStats.week_ccost))}`;

  if (projectStats) {
    left +=
      ` ${paint("dim", "›")} ${paint("proj", "proj")} ` +
      `${paint("tok", formatTokens(projectStats.week_tok))} ` +
      `${paint("cost", formatCost(projectStats.week_cost + projectStats.week_ccost))}`;
  }

  left +=
    ` ${paint("sep", "│")} ${paint("month", "month")} ` +
    `${paint("tok", formatTokens(globalStats.month_tok))} ` +
    `${paint("cost", formatCost(globalStats.month_cost + globalStats.month_ccost))}`;

  if (projectStats) {
    left +=
      ` ${paint("dim", "›")} ${paint("proj", "proj")} ` +
      `${paint("cost", formatCost(projectStats.month_cost + projectStats.month_ccost))}`;
  }

  return { left };
}

function renderSession(input: StatuslineInput, quota: Record<string, any> | null, now: Date): Cell {
  const sessionCost = input.cost?.total_cost_usd ?? 0;
  const totalDurationMs = input.cost?.total_duration_ms ?? 0;
  const hours = totalDurationMs > 0 ? totalDurationMs / 3_600_000 : 0;
  const burnRate = hours > 0.01 ? sessionCost / hours : 0;
  const duration = formatDuration(totalDurationMs);
  const ctx = input.context_window?.used_percentage ?? 0;
  let left = `${paint("sess", "sess")} ${paint("cost", formatCost(sessionCost))}`;

  if (burnRate > 0) {
    left += ` ${paint("burn", `${formatCost(burnRate)}/h`)}`;
  }

  const resetAt = quota?.five_hour && typeof quota.five_hour === "object"
    ? (quota.five_hour as Record<string, any>).resets_at
    : null;
  if (burnRate > 0 && typeof resetAt === "string" && resetAt) {
    const remainingHours = Math.max(0, (new Date(resetAt).getTime() - now.getTime()) / 3_600_000);
    if (!Number.isNaN(remainingHours) && remainingHours > 0) {
      const projected = sessionCost + burnRate * remainingHours;
      left += ` ${paint("proj_", `→${formatCost(projected)}`)}`;
    }
  }

  if (duration) {
    left += ` ${paint("dur", duration)}`;
  }

  if (ctx > 0) {
    left += ` ${contextColor(ctx)}${Math.trunc(ctx)}%${RESET}`;
  }

  return {
    left,
    right:
      `${paint("lines+", `+${input.cost?.total_lines_added ?? 0}`)}` +
      `${paint("dim", "/")}` +
      `${paint("lines-", `-${input.cost?.total_lines_removed ?? 0}`)}`,
  };
}

function renderTotal(
  globalStats: StatsBucket,
  projectStats: StatsBucket | null,
  cwd: string,
  compact = false,
): Cell {
  let left = `${paint("total", "total")} ${paint("cost", formatCost(globalStats.all_cost + globalStats.all_ccost))}`;

  if (projectStats) {
    left +=
      ` ${paint("dim", "›")} ${compact ? "" : `${paint("proj", "proj")} `}` +
      `${formatTokenCache(
        projectStats.all_tok,
        projectStats.all_cr_tok,
        projectStats.all_in_tok,
        false,
      )} ` +
      `${paint("cost", formatCost(projectStats.all_cost + projectStats.all_ccost))}`;
  }

  return {
    left,
    right: paint("dim", shortenPath(cwd, compact ? 12 : 25)),
  };
}

function renderModel(input: StatuslineInput, now: Date): Cell {
  const ctx = Math.trunc(input.context_window?.used_percentage ?? 0);
  return {
    left:
      `${paint("ctx", "ctx")} ${contextColor(ctx)}${ctx}%${RESET} ` +
      `${paint("model", getModelName(input))}`,
    right: paint("time", now.toTimeString().slice(0, 5)),
  };
}

function renderItem(
  item: string,
  input: StatuslineInput,
  tokens: TokenStats,
  projectStats: StatsBucket | null,
  quota: Record<string, any> | null,
  now: Date,
  compact: boolean,
): Cell {
  switch (item) {
    case "5h":
      return render5h(quota, now, compact);
    case "7d":
      return render7d(quota, now, compact);
    case "today":
      return renderToday(tokens, projectStats, compact);
    case "history":
      return renderHistory(tokens, projectStats);
    case "session":
      return renderSession(input, quota, now);
    case "total":
      return renderTotal(
        tokens,
        projectStats,
        input.workspace?.current_dir ?? input.cwd ?? "",
        compact,
      );
    case "model":
      return renderModel(input, now);
    default:
      return { left: item };
  }
}

function inlineCell(cell: Cell): string {
  return cell.right ? `${cell.left} ${cell.right}` : cell.left;
}

export function renderStatusline(input: StatuslineInput, state: RenderState): string {
  const tokens = state.tokens;
  const quota = state.quota;
  const now = state.now ?? new Date();
  const projectDir = input.workspace?.project_dir ?? input.workspace?.current_dir ?? input.cwd ?? "";
  const projectStats = getProjectStats(tokens, projectDir);
  const separator = ` ${paint("sep", "│")} `;
  const maxColumns = Math.max(1, state.columns ?? state.config?.columns ?? DEFAULT_AUTO_COLUMNS);
  const layout = resolveLayout(state.config, maxColumns);
  const rows = layout.rows;

  const renderedRows = rows.map((row) =>
    row.map((item) => renderItem(item, input, tokens, projectStats, quota, now, layout.compact)),
  );

  let activeColumnCount = Math.max(...renderedRows.map((row) => row.length), 1);

  while (activeColumnCount > 1) {
    const trimmedRows = renderedRows.map((row) => row.slice(0, activeColumnCount));

    if (layout.compact) {
      const widestRow = Math.max(
        ...trimmedRows.map((row) =>
          visibleLength(row.map((cell) => inlineCell(cell)).join(separator))),
      );

      if (widestRow <= maxColumns) {
        return trimmedRows
          .map((row) => row.map((cell) => inlineCell(cell)).join(separator).trimEnd())
          .join("\n");
      }

      activeColumnCount -= 1;
      continue;
    }

    const columnWidths = Array.from({ length: activeColumnCount }, (_, columnIndex) =>
      Math.max(
        ...trimmedRows.map((row) => {
          const cell = row[columnIndex];
          if (!cell) return 0;
          const leftWidth = visibleLength(cell.left);
          const rightWidth = cell.right ? visibleLength(cell.right) + 1 : 0;
          return leftWidth + rightWidth;
        }),
      ),
    );

    const widestRow =
      columnWidths.reduce((sum, width) => sum + width, 0) +
      visibleLength(separator) * Math.max(0, activeColumnCount - 1);

    if (widestRow <= maxColumns) {
      return trimmedRows
        .map((row) =>
          row
            .map((cell, columnIndex) => {
              const targetWidth = columnWidths[columnIndex] ?? visibleLength(cell.left);
              if (!cell.right) {
                return padVisible(cell.left, targetWidth);
              }

              const gap = Math.max(
                1,
                targetWidth - visibleLength(cell.left) - visibleLength(cell.right),
              );
              return `${cell.left}${" ".repeat(gap)}${cell.right}`;
            })
            .join(separator)
            .trimEnd(),
        )
        .join("\n");
    }

    activeColumnCount -= 1;
  }

  return renderedRows
    .map((row) => row[0]?.left ?? "")
    .join("\n")
    .trim();
}
