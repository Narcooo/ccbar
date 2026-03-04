<div align="center">

<br>

<img src="assets/icon.svg" alt="ccbar" width="200">

# ccbar

**Vibe coding is no longer for fun. Know what it costs.**

One file. Zero dependencies. Pure Python stdlib.

[![PyPI](https://img.shields.io/pypi/v/ccbar?style=flat-square&color=blue)](https://pypi.org/project/ccbar/)
[![Python](https://img.shields.io/pypi/pyversions/ccbar?style=flat-square)](https://pypi.org/project/ccbar/)
[![License](https://img.shields.io/github/license/Narcooo/ccbar?style=flat-square)](LICENSE)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)

[![English](https://img.shields.io/badge/lang-English-blue?style=flat-square)](#)
[![中文](https://img.shields.io/badge/lang-中文-grey?style=flat-square)](README_CN.md)

<br>

<img src="assets/demo.svg" alt="ccbar demo" width="880">

</div>

<br>

## Install

```bash
pip install ccbar
ccbar --install
```

Restart Claude Code. Two lines appear at the bottom. Done.

## What you see

| Row | Content |
|-----|---------|
| **1** | `5h` quota bar + countdown · `today` tokens + ♻cache + cost › per-project breakdown · `week` total · `month` total |
| **2** | `7d` quota bar + countdown · `session` cost + $/h burn rate + →projection + duration + lines changed · `context`% + model + clock · `total` project cost + path |

Terminal too narrow? Trailing columns drop automatically. Content within columns is never modified.

## Why the numbers are right

- **Per-model pricing** — Opus output costs $75/M, Haiku costs $4/M. ccbar reads the model ID from every message. No flat-rate guessing.
- **Streaming dedup** — Each API call writes 2–7 JSONL entries. ccbar deduplicates by `message.id`. Each message counted exactly once.
- **Cache separation** — Cache reads cost 10% of fresh input. ccbar tracks them separately and shows ♻hit rate per project.
- **Cross-session history** — Session cost resets when you restart. Your bill doesn't. ccbar scans all JSONL — today, this week, this month, per project.

## More

- **Burn rate** — `$8.50/h` tells you how fast this session is spending. `→$18` projects the total by quota reset.
- **Quota bars** — Green→yellow→red HSL gradient. 5-hour and 7-day limits at a glance.
- **Per-project** — `› proj ♻56M/97% $124` — which project is eating your budget.
- **Adaptive layout** — 2 rows × 4 columns by default. Columns drop when terminal narrows. Content never truncates.

## Configure

```bash
export CCBAR_LAYOUT="5h,today,week,month|7d,session,model,total"
# or
ccbar --init-config   # → ~/.config/ccbar.json
```

<details>
<summary>Config reference</summary>

```json
{
  "rows": [["5h", "today", "week", "month"], ["7d", "session", "model", "total"]],
  "columns": null,
  "colors": {},
  "pricing": {
    "claude-opus-4-6":    { "in": 15,  "out": 75, "cc": 18.75, "cr": 1.5  },
    "claude-sonnet-4-6":  { "in": 3,   "out": 15, "cc": 3.75,  "cr": 0.3  },
    "claude-haiku-4-5":   { "in": 0.8, "out": 4,  "cc": 1,     "cr": 0.08 }
  }
}
```

| Field | Description |
|-------|-------------|
| `rows` | Layout grid — items: `5h` `7d` `today` `week` `month` `session` `model` `total` |
| `columns` | Override terminal width (`null` = auto-detect) |
| `pricing` | $/million tokens per model |
| `colors` | `[R, G, B]` overrides |

</details>

## How it works

```
stdin JSON → detect terminal width → fetch OAuth quota (cached 30s)
           → scan ~/.claude/projects/**/*.jsonl (cached 60s)
           → dedup by message.id → per-model pricing → adaptive layout → stdout
```

OAuth — macOS: auto-reads Keychain. Linux/CI: `export CLAUDE_OAUTH_TOKEN="..."`. Without it, quota bars show `--`.

## Uninstall

```bash
ccbar --uninstall && pip uninstall ccbar
```

---

<div align="center">

MIT · For developers who treat AI compute as a budget line item.

</div>
