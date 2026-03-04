# ccbar

**Cross-session cost tracking for Claude Code. Zero dependencies.**

Most Claude Code statusline tools show your **current session** cost — it resets when you restart. ccbar scans your local JSONL logs to show **today / week / month** totals, per-model pricing, per-project breakdown, and real OAuth quota bars — all in ~500 lines of pure Python.

<!-- ![demo](screenshots/demo.png) -->

## Install

```bash
pip install ccbar
ccbar --install   # writes statusLine to ~/.claude/settings.json
```

Restart Claude Code. Done.

## What it shows

```
5h ━━━━━━━━─ 95% 1h22m │ 7d ━━──────── 22% 5d21h        │ Opus 4.6 ctx 42% 17:37
today 6.2M ⟳167M/96% $328 │ week 18.6M $816 › proj 278k $2.26 │ month 19.5M $835 › proj $3.97
```

**Row 1:** 5-hour quota bar + reset countdown │ 7-day quota bar + reset countdown │ model · context% · clock

**Row 2:** today tokens · cache/hit% · cost │ week tokens · cost [› proj] │ month tokens · cost [› proj]

## How is this different?

### vs other statusline tools (ccstatusline, cc-statusline, CCometixLine...)

Most statusline tools are **display formatters** — they render what Claude Code provides via stdin JSON (`cost.total_cost_usd`, model name, context%). That session cost is accurate, but **resets every session**.

ccbar adds a data layer on top:

| Feature | ccbar | Typical statusline tool |
|---------|-------|------------------------|
| Session cost | ✅ `session` item | ✅ Built-in |
| Cross-session history (today/week/month) | ✅ JSONL scan | ❌ |
| Per-project cost breakdown | ✅ `› proj` | ❌ |
| Per-model pricing | ✅ Opus/Sonnet/Haiku rates | N/A |
| Streaming dedup | ✅ msg_id | N/A |
| Cache hit rate | ✅ `⟳148M/96%` | ❌ |
| Real OAuth quota bars | ✅ 5h + 7d API | ❌ (some show session blocks) |
| Dependencies | None (Python stdlib) | Node.js+React / Go / Rust |

### vs ccusage

[ccusage](https://github.com/ryoppippi/ccusage) is a great **CLI reporting tool** — it also does per-model pricing, streaming dedup, and session-level analytics. Different use case:

| | ccbar | ccusage |
|---|-------|---------|
| **Purpose** | Always-visible statusline | On-demand CLI reports |
| **Quota** | Real OAuth API (5h + 7d bars, countdown) | 5h billing block analysis |
| **Burn rate / projection** | ❌ | ✅ |
| **Session-level reports** | ❌ | ✅ (daily/weekly/session) |
| **Dependencies** | 0 | 15+ npm packages |

They complement each other. Use ccbar for at-a-glance monitoring, ccusage for deep analysis.

## Configurable layout

Default: 2 rows × 3 items. You can customize what appears and how many rows.

### Quick: environment variable

```bash
# Single row (avoids "context left until" overlap)
export CCBAR_LAYOUT="5h,7d,session,model"

# Add session to row 1, path to row 2
export CCBAR_LAYOUT="5h,7d,session,model|today,path,month"

# Three rows
export CCBAR_LAYOUT="5h,7d,model|session,today,path|week,month"
```

Pipe `|` separates rows, comma `,` separates items.

### Config file

```bash
ccbar --init-config   # creates ~/.config/ccbar.json
```

```json
{
  "rows": [
    ["5h", "7d", "session", "model"],
    ["today", "week", "month"]
  ],
  "colors": {
    "cost": [255, 100, 100]
  }
}
```

### Available items

| Item | Shows |
|------|-------|
| `5h` | 5-hour quota bar + reset countdown |
| `7d` | 7-day quota bar + per-model breakdown + countdown |
| `model` | Model name + context% + clock |
| `session` | Session cost + duration + lines changed |
| `today` | Today tokens + cache hit% + cost [› proj] |
| `week` | Week tokens + cost [› proj] |
| `month` | Month tokens + cost [› proj] |
| `path` | Current working directory (shortened) |

### "context left until" workaround

When context is high, Claude Code overlays "context left until auto-compact" on the right side of the statusline, which can hide your second row. Fix: use a single-row layout:

```bash
export CCBAR_LAYOUT="5h,7d,session,model"
```

## How it works

1. Claude Code pipes JSON to stdin on each update (model, context, cost, workspace)
2. ccbar fetches OAuth quota from `api.anthropic.com` (cached 30s)
3. ccbar scans `~/.claude/projects/**/*.jsonl` for token usage (cached 60s)
4. Streaming entries are deduplicated by `message.id` — last entry per ID wins
5. Per-model pricing: Opus $75/M output, Sonnet $15/M, Haiku $4/M
6. Configurable multi-row output is rendered with adaptive column widths

### Per-model pricing table

| Model | Input | Output | Cache Write | Cache Read |
|-------|------:|-------:|------------:|-----------:|
| Opus 4.5/4.6 | $15/M | $75/M | $18.75/M | $1.50/M |
| Sonnet 4.5/4.6 | $3/M | $15/M | $3.75/M | $0.30/M |
| Haiku 4.5 | $0.80/M | $4/M | $1/M | $0.08/M |

### Why streaming dedup matters

When Claude streams a response, the JSONL log records 2–7 entries for the same message (intermediate chunks with partial `output_tokens`). ccbar keeps only the final entry per `message.id`, preventing 2–7x cost inflation.

### OAuth token

On macOS, ccbar reads from Keychain automatically. On Linux or in CI:

```bash
export CLAUDE_OAUTH_TOKEN="your-token-here"
```

Without OAuth, quota bars show `--` but cost tracking works fine.

## Customize colors

Override any color in config:

```json
{
  "colors": {
    "cost":  [255, 210, 80],
    "model": [80, 220, 180],
    "proj":  [255, 150, 100]
  }
}
```

All values are `[R, G, B]` for true-color terminals.

## Uninstall

```bash
ccbar --uninstall
pip uninstall ccbar
```

## CLI reference

```
ccbar                Read JSON from stdin → render statusbar
ccbar --install      Register as Claude Code statusline
ccbar --uninstall    Remove from settings + clean caches
ccbar --init-config  Create ~/.config/ccbar.json with defaults
ccbar --version      Print version
```

## License

MIT
