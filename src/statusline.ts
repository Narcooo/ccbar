import { DEFAULT_LAYOUT, type PluginConfig } from "./config.js";
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

function shortenPath(input: string, maxLength = 25): string {
  if (!input || input.length <= maxLength) {
    return input;
  }

  const parts = input.split("/");
  const short = parts.slice(-2).join("/");
  if (short.length + 2 < input.length) {
    return `…/${short}`;
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

function render5h(quota: Record<string, any> | null): Cell {
  const utilization = quota?.five_hour?.utilization;
  return {
    left: utilization == null ? "5h --" : `5h ${Math.trunc(utilization)}%`,
  };
}

function render7d(quota: Record<string, any> | null): Cell {
  const utilization = quota?.seven_day?.utilization;
  return {
    left: utilization == null ? "7d --" : `7d ${Math.trunc(utilization)}%`,
  };
}

function renderToday(globalStats: StatsBucket, projectStats: StatsBucket | null): Cell {
  const left = `today ${formatTokens(globalStats.today_tok)} ${formatCost(globalStats.today_cost + globalStats.today_ccost)}`;

  if (!projectStats) {
    return { left };
  }

  return {
    left: `${left} › proj ${formatTokens(projectStats.today_tok)}`,
    right: formatCost(projectStats.today_cost + projectStats.today_ccost),
  };
}

function renderHistory(globalStats: StatsBucket, projectStats: StatsBucket | null): Cell {
  let left =
    `week ${formatCost(globalStats.week_cost + globalStats.week_ccost)} ` +
    `│ month ${formatTokens(globalStats.month_tok)} ${formatCost(globalStats.month_cost + globalStats.month_ccost)}`;

  if (projectStats) {
    left += ` › proj ${formatCost(projectStats.month_cost + projectStats.month_ccost)}`;
  }

  return { left };
}

function renderSession(input: StatuslineInput): Cell {
  const sessionCost = input.cost?.total_cost_usd ?? 0;
  const totalDurationMs = input.cost?.total_duration_ms ?? 0;
  const hours = totalDurationMs > 0 ? totalDurationMs / 3_600_000 : 0;
  const burnRate = hours > 0.01 ? sessionCost / hours : 0;
  const duration = formatDuration(totalDurationMs);
  const ctx = input.context_window?.used_percentage ?? 0;
  let left = `sess ${formatCost(sessionCost)}`;

  if (burnRate > 0) {
    left += ` ${formatCost(burnRate)}/h`;
  }

  if (duration) {
    left += ` ${duration}`;
  }

  if (ctx > 0) {
    left += ` ${Math.trunc(ctx)}%`;
  }

  return {
    left,
    right: `+${input.cost?.total_lines_added ?? 0}/-${input.cost?.total_lines_removed ?? 0}`,
  };
}

function renderTotal(
  globalStats: StatsBucket,
  projectStats: StatsBucket | null,
  cwd: string,
): Cell {
  let left = `total ${formatCost(globalStats.all_cost + globalStats.all_ccost)}`;

  if (projectStats) {
    left +=
      ` › proj ${formatTokens(projectStats.all_tok)} ` +
      `${formatCost(projectStats.all_cost + projectStats.all_ccost)}`;
  }

  return {
    left,
    right: shortenPath(cwd),
  };
}

function renderModel(input: StatuslineInput): Cell {
  const ctx = Math.trunc(input.context_window?.used_percentage ?? 0);
  return {
    left: `ctx ${ctx}% ${getModelName(input)}`,
  };
}

function renderItem(
  item: string,
  input: StatuslineInput,
  tokens: TokenStats,
  projectStats: StatsBucket | null,
  quota: Record<string, any> | null,
): Cell {
  switch (item) {
    case "5h":
      return render5h(quota);
    case "7d":
      return render7d(quota);
    case "today":
      return renderToday(tokens, projectStats);
    case "history":
      return renderHistory(tokens, projectStats);
    case "session":
      return renderSession(input);
    case "total":
      return renderTotal(tokens, projectStats, input.workspace?.current_dir ?? input.cwd ?? "");
    case "model":
      return renderModel(input);
    default:
      return { left: item };
  }
}

export function renderStatusline(input: StatuslineInput, state: RenderState): string {
  const tokens = state.tokens;
  const quota = state.quota;
  const projectDir = input.workspace?.project_dir ?? input.workspace?.current_dir ?? input.cwd ?? "";
  const projectStats = getProjectStats(tokens, projectDir);
  const rows = state.config?.rows ?? DEFAULT_LAYOUT;
  const separator = " │ ";
  const maxColumns = Math.max(1, state.columns ?? state.config?.columns ?? 140);

  const renderedRows = rows.map((row) =>
    row.map((item) => renderItem(item, input, tokens, projectStats, quota)),
  );

  let activeColumnCount = Math.max(...renderedRows.map((row) => row.length), 1);

  while (activeColumnCount > 1) {
    const trimmedRows = renderedRows.map((row) => row.slice(0, activeColumnCount));
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
      separator.length * Math.max(0, activeColumnCount - 1);

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
