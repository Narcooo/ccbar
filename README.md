# ccbar

**Accurate cost tracking for Claude Code. Zero dependencies.**

See exactly what you're spending — across sessions, projects, and time windows — right in your statusline.

<!-- ![demo](screenshots/demo.png) -->

## Why ccbar?

Most statusline tools display the **session cost** that Claude Code provides via stdin. That number resets every session. ccbar goes further:

- **Cross-session history** — scans your JSONL logs to compute today / week / month totals
- **Per-model pricing** — Opus output costs 75$/M, Haiku costs 4$/M. ccbar applies the right rate per message, not a flat average
- **Streaming dedup** — each API call produces 2–7 JSONL entries during streaming. ccbar deduplicates by message ID so tokens are counted once
- **Cache hit rate** — shows what percentage of your input tokens came from cache (and how much that saved)
- **Per-project breakdown** — `proj` column shows the current project's share of your spending
- **OAuth quota bars** — real 5-hour and 7-day limit utilization with countdown timers
- **Zero dependencies** — pure Python stdlib, ~500 lines, no Node/Go/Rust runtime needed

### What it looks like

```
5h ━━━━──── 60% 2h30m │ 7d ━──────── 19% 5d22h │ Opus 4.6 ctx 53% 16:39
today 5.5M ⟳148M/96% $291 › proj 4.2M ⟳111M/96% $202 │ week 8.1M $420 › proj 6.3M $310 │ month 22M $1.2k › proj $890
```

**Row 1:** 5-hour quota bar + reset countdown │ 7-day quota bar + reset countdown │ model · context % · clock

**Row 2:** today tokens · cache/hit% · cost › project │ week │ month

Colors use true-color gradients — green→yellow→red for quota bars, cool→warm for context usage.

## Install

```bash
pip install ccbar
ccbar --install
```

That's it. Restart Claude Code and the statusline appears.

`--install` writes this to `~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "ccbar" }
}
```

Your existing settings (permissions, plugins, etc.) are preserved. A timestamped backup is created before any changes.

## How it works

1. Claude Code pipes JSON to stdin on each statusline update (model, context, workspace info)
2. ccbar fetches OAuth quota from `api.anthropic.com` (cached 30s)
3. ccbar scans `~/.claude/projects/*/*.jsonl` for token usage (cached 60s)
4. Streaming entries are deduplicated by `message.id` — last entry per ID wins
5. Per-model pricing is applied: Opus/Sonnet/Haiku each have distinct input/output/cache rates
6. Two-line output is rendered with adaptive column widths

### Per-model pricing table

| Model | Input | Output | Cache Write | Cache Read |
|-------|------:|-------:|------------:|-----------:|
| Opus 4.5/4.6 | $15/M | $75/M | $18.75/M | $1.50/M |
| Sonnet 4.5/4.6 | $3/M | $15/M | $3.75/M | $0.30/M |
| Haiku 4.5 | $0.80/M | $4/M | $1/M | $0.08/M |

### Why streaming dedup matters

When Claude streams a response, the JSONL log records multiple entries for the same message — intermediate chunks with partial `output_tokens`. Without dedup, you'd count every chunk separately and inflate costs 2–7x. ccbar keeps only the final entry per `message.id`.

### Why per-model pricing matters

If you use Opus heavily, a tool that assumes Sonnet pricing will **undercount by 5x** on output tokens ($75 vs $15 per million). If you use Haiku for sub-agents, it would **overcount by 3.75x**. ccbar reads the model ID from each message and applies the correct rate.

## Customize

### Colors

Edit the `COLORS` dict at the top of `src/ccbar/main.py` (or your installed copy). All values are `(R, G, B)` tuples for true-color terminals:

```python
COLORS = {
    "cost":  (255, 210, 80),   # gold
    "model": (80, 220, 180),   # teal
    "proj":  (255, 150, 100),  # coral
    # ...
}
```

### OAuth token

On macOS, ccbar reads from Keychain automatically. On Linux or in CI, set:

```bash
export CLAUDE_OAUTH_TOKEN="your-token-here"
```

Without OAuth, quota bars show `--` but cost tracking works fine.

## Uninstall

```bash
ccbar --uninstall
pip uninstall ccbar
```

`--uninstall` removes the `statusLine` key from settings and cleans up cache files in your temp directory.

## CLI reference

```
ccbar              Read JSON from stdin → render statusbar
ccbar --install    Register as Claude Code statusline
ccbar --uninstall  Remove from settings + clean caches
ccbar --version    Print version
ccbar --help       Show help
```

## License

MIT
