import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../dist/cli.js";
import { renderStatusline } from "../dist/statusline.js";

const PROJECT_STATS = {
  today_tok: 1200,
  today_cost: 0.006,
  today_ccost: 0,
  today_cr_tok: 0,
  today_in_tok: 1000,
  week_tok: 1200,
  week_cost: 0.006,
  week_ccost: 0,
  week_cr_tok: 0,
  week_in_tok: 1000,
  month_tok: 1200,
  month_cost: 0.006,
  month_ccost: 0,
  all_tok: 1200,
  all_cost: 0.006,
  all_ccost: 0,
  all_cr_tok: 0,
  all_in_tok: 1000,
};

const TOKENS = {
  ...PROJECT_STATS,
  projects: {
    "-tmp-demo": PROJECT_STATS,
  },
};

const INPUT = {
  model: { display_name: "Claude Sonnet 4.6" },
  workspace: {
    current_dir: "/tmp/demo",
    project_dir: "/tmp/demo",
  },
  context_window: {
    used_percentage: 35,
  },
  cost: {
    total_cost_usd: 1.5,
    total_duration_ms: 3_600_000,
    total_lines_added: 10,
    total_lines_removed: 2,
  },
};

const QUOTA = {
  five_hour: {
    utilization: 42,
    resets_at: "2026-03-19T11:00:00Z",
  },
  seven_day: {
    utilization: 18,
    resets_at: "2026-03-20T10:00:00Z",
  },
};

test("renderStatusline drops trailing columns on narrow widths without truncating cells", () => {
  const output = renderStatusline(INPUT, {
    tokens: TOKENS,
    quota: null,
    columns: 50,
    config: {
      rows: [["5h", "today", "today"], ["7d", "session", "session"]],
    },
    now: new Date("2026-03-19T10:00:00Z"),
  });

  assert.equal(output.includes("..."), false);
  assert.equal(output.includes("5h"), true);
  assert.equal(output.includes("sess"), true);
});

test("renderStatusline treats the legacy default rows as responsive defaults", () => {
  const output = renderStatusline(INPUT, {
    tokens: TOKENS,
    quota: null,
    columns: 110,
    config: {
      rows: [["5h", "today", "history"], ["7d", "session", "total"]],
    },
    now: new Date("2026-03-19T10:00:00Z"),
  });

  assert.equal(output.includes("today"), true);
  assert.equal(output.includes("sess"), true);
  assert.equal(output.includes("total"), false);
});

test("renderStatusline switches to the compact default layout on narrow auto widths", () => {
  const output = renderStatusline(INPUT, {
    tokens: TOKENS,
    quota: null,
    columns: 110,
    config: {},
    now: new Date("2026-03-19T10:00:00Z"),
  });

  assert.equal(output.includes("today"), true);
  assert.equal(output.includes("sess"), true);
  assert.equal(output.includes("total"), false);
  assert.equal(output.includes("month"), false);
});

test("renderStatusline restores ANSI colors for standard metrics", () => {
  const output = renderStatusline(INPUT, {
    tokens: TOKENS,
    quota: null,
    columns: 140,
    now: new Date("2026-03-19T10:00:00Z"),
  });

  assert.equal(output.includes("\u001b["), true);
  assert.equal(output.includes("today"), true);
  assert.equal(output.includes("sess"), true);
});

test("renderStatusline renders colored 5h and 7d quota bars", () => {
  const output = renderStatusline(INPUT, {
    tokens: TOKENS,
    quota: QUOTA,
    columns: 140,
    now: new Date("2026-03-19T10:00:00Z"),
  });

  assert.equal(output.includes("\u001b["), true);
  assert.equal(output.includes("━"), true);
  assert.equal(output.includes("42%"), true);
  assert.equal(output.includes("18%"), true);
});

test("renderStatusline keeps compact quota rows short enough for narrow UIs", () => {
  const output = renderStatusline(INPUT, {
    tokens: TOKENS,
    quota: QUOTA,
    columns: 110,
    now: new Date("2026-03-19T10:00:00Z"),
  });

  const lines = output
    .trimEnd()
    .split("\n")
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));

  assert.equal(lines.length, 2);
  assert.equal(lines.every((line) => line.length <= 64), true);
});

test("main reads Claude stdin JSON and writes rendered statusline", async () => {
  const tmpdir = await mkdtemp(path.join(os.tmpdir(), "ccbar-cli-"));
  const projectDir = path.join(tmpdir, "-tmp-demo");
  const entry = {
    timestamp: "2026-03-19T10:00:00Z",
    type: "assistant",
    message: {
      id: "msg1",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
  const writes = [];
  const previousProjectsDir = process.env.CCBAR_PROJECTS_DIR;

  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "session.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
  process.env.CCBAR_PROJECTS_DIR = tmpdir;

  try {
    await main(
      [],
      {
        readStdin: async () => JSON.stringify(INPUT),
        writeStdout: (value) => {
          writes.push(value);
        },
      },
    );
  } finally {
    if (previousProjectsDir == null) {
      delete process.env.CCBAR_PROJECTS_DIR;
    } else {
      process.env.CCBAR_PROJECTS_DIR = previousProjectsDir;
    }
  }

  assert.equal(writes.length, 2);
  assert.equal(writes[0].includes("5h"), true);
  assert.equal(writes[0].endsWith("\n"), true);
  assert.equal(writes[1].includes("7d"), true);
  assert.equal(writes[1].endsWith("\n"), true);
});
