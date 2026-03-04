# ccbar

**Precise project cost accounting for Claude Code. Zero dependencies.**

ccbar is not a dashboard for vibe coding. It's a cost accounting tool — built for developers who treat AI compute as a line item in their project budget.

It scans your local JSONL logs to compute per-model, per-project, cross-session costs with streaming dedup, shows real-time OAuth quota bars, burn rate, and cost projection — all in ~550 lines of pure Python stdlib.

<!-- ![demo](screenshots/demo.png) -->

## Install

```bash
pip install ccbar
ccbar --install
```

Restart Claude Code. Done.

## What it shows

```
5h ━━━━━━━━─ 95% 1h22m │ 7d ━━──────── 22% 5d21h          │ Opus 4.6 ctx 42% 17:37
sess $8.50 $8.50/h →$39 1h +250/-40 │ today 6.2M ⟳167M/96% $328 │ month 19.5M $835 › proj $3.97
```

**Row 1:** 5h quota bar + countdown │ 7d quota bar + countdown │ model · ctx% · clock

**Row 2:** session cost · burn rate · projection · duration · lines │ today · cache hit% · cost │ month · cost [› proj]

When context ≥ 80% (Claude Code overlays "context left until auto-compact"), ccbar auto-compresses to 1 row:
```
5h ━━━━━━━━─ 95% 1h22m │ 7d ━━──────── 22% 5d21h │ Opus 4.6 ctx 85% 17:37 $328/d
```

### Session burn rate & projection

- **`$8.50/h`** — current burn rate (session cost ÷ session duration)
- **`→$39`** — projected total cost by end of current 5-hour quota window, based on burn rate × remaining time

## Why ccbar?

### It tracks project costs, not session vanity metrics

Most statusline tools show the session cost that Claude Code provides via stdin. That number resets every session. ccbar scans all JSONL logs to compute **today / week / month** totals with **per-project breakdown** — so you know "this project cost $202 today" not just "I spent $328 total".

### Per-model pricing matters

Opus output costs **$75/M tokens**. Haiku costs **$4/M**. A tool that assumes flat Sonnet pricing will undercount your Opus spending by 5x, or overcount your Haiku sub-agents by 3.75x. ccbar reads the model ID from each JSONL message and applies the correct rate.

### Streaming dedup prevents inflated numbers

Each Claude API call produces 2–7 JSONL entries during streaming (intermediate chunks with partial `output_tokens`). Without dedup, your cost numbers inflate 2–7x. ccbar deduplicates by `message.id`, keeping only the final entry.

### Cache hit rate shows prompt efficiency

`⟳167M/96%` means 96% of your input tokens came from cache. If this number is low, your prompts or CLAUDE.md might need restructuring. ccbar makes this visible at a glance.

### Visual instant-read

Gradient progress bars tell you quota status in 0.1 seconds — green→yellow→red. You don't need to parse "Block 2/4 (3h left) 🟢 Normal".

### Zero runtime overhead

No Node.js startup, no React rendering pipeline, no background daemon. Pure stdin→stdout, single process, instant exit. ~550 lines of Python stdlib.

## Comparison

| | ccbar | ccusage statusline | Other statuslines |
|---|---|---|---|
| **Focus** | Project cost accounting | Session analysis | Display formatting |
| **OAuth quota bars** | ✅ 5h + 7d with countdown | ❌ | ❌ |
| **Cross-session history** | ✅ today/week/month | ✅ daily/blocks | ❌ session only |
| **Per-project breakdown** | ✅ `› proj` | ❌ in statusline | ❌ |
| **Burn rate / projection** | ✅ $/h → projected | ✅ tok/min + projection | ❌ |
| **Cache hit rate** | ✅ visual | tracks internally | ❌ |
| **Streaming dedup** | ✅ msg_id | ✅ msg_id:req_id | N/A |
| **Per-model pricing** | ✅ configurable | ✅ LiteLLM prefetch | N/A |
| **Auto-adaptive layout** | ✅ ctx ≥ 80% compresses | ❌ | ❌ |
| **Dependencies** | 0 | 15+ npm | Node/Go/Rust |
| **Visual design** | Gradient bars + true-color | Emoji text | Varies |

## Configurable layout

Default: 2 rows × 3 items.

### Environment variable

```bash
# Pipe separates rows, comma separates items
export CCBAR_LAYOUT="5h,7d,model|session,today,month"

# Single row
export CCBAR_LAYOUT="5h,7d,session,model"

# Three rows
export CCBAR_LAYOUT="5h,7d,model|session,today,path|week,month"
```

### Config file

```bash
ccbar --init-config   # creates ~/.config/ccbar.json
```

The generated config includes everything you can customize:

```json
{
  "rows": [["5h", "7d", "model"], ["session", "today", "month"]],
  "compact_threshold": 80,
  "colors": {},
  "pricing": {
    "claude-opus-4-6": {"in": 15, "out": 75, "cc": 18.75, "cr": 1.5},
    "claude-sonnet-4-6": {"in": 3, "out": 15, "cc": 3.75, "cr": 0.3},
    "claude-haiku-4-5": {"in": 0.8, "out": 4, "cc": 1, "cr": 0.08}
  },
  "api": {
    "endpoint": "https://api.anthropic.com/api/oauth/usage",
    "beta_header": "oauth-2025-04-20"
  }
}
```

- **pricing** — $/million tokens. Update when Anthropic changes rates
- **api** — OAuth endpoint and beta header. Change if API evolves
- **compact_threshold** — auto-compress to 1 row when ctx% exceeds this (default: 80)
- **colors** — `[R, G, B]` overrides for any named color

### Available items

| Item | Shows |
|------|-------|
| `5h` | 5-hour quota bar + reset countdown |
| `7d` | 7-day quota bar + per-model breakdown + countdown |
| `model` | Model name + context% + clock |
| `session` | Session cost + $/h burn rate + →projection + duration + lines |
| `today` | Today tokens + cache hit% + cost [› proj] |
| `week` | Week tokens + cost [› proj] |
| `month` | Month tokens + cost [› proj] |
| `path` | Current working directory (shortened) |

## How it works

1. Claude Code pipes JSON to stdin (model, context, cost, workspace)
2. ccbar fetches OAuth quota from Anthropic API (cached 30s)
3. ccbar scans `~/.claude/projects/**/*.jsonl` for token usage (cached 60s)
4. Streaming entries deduplicated by `message.id` — last entry wins
5. Per-model pricing applied per message (configurable in config)
6. Burn rate = session cost ÷ duration; projection = burn rate × remaining 5h window
7. If ctx ≥ 80%, auto-compress to 1 row with today cost suffix

### OAuth token

macOS: auto-reads from Keychain. Linux/CI:
```bash
export CLAUDE_OAUTH_TOKEN="your-token"
```
Without OAuth, quota bars show `--` but everything else works.

## Uninstall

```bash
ccbar --uninstall
pip uninstall ccbar
```

## License

MIT
