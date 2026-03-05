<div align="center">

<br>

<img src="assets/logo.svg" alt="ccbar" width="400">

<br>
<br>

**From vibe coding to cost-conscious engineering.**

Zero dependencies. Pure Python stdlib. One `pip install` and you're done.

[![PyPI](https://img.shields.io/pypi/v/ccbar?style=flat-square&color=blue)](https://pypi.org/project/ccbar/)
[![Downloads](https://img.shields.io/pypi/dm/ccbar?style=flat-square&color=green)](https://pypi.org/project/ccbar/)
[![Python](https://img.shields.io/pypi/pyversions/ccbar?style=flat-square)](https://pypi.org/project/ccbar/)
[![License](https://img.shields.io/github/license/Narcooo/ccbar?style=flat-square)](LICENSE)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)

[![English](https://img.shields.io/badge/lang-English-blue?style=flat-square)](#)
[![中文](https://img.shields.io/badge/lang-中文-grey?style=flat-square)](README_CN.md)

</div>

<br>

<div align="center">
<img src="assets/demo.svg" alt="ccbar demo" width="920">
</div>

<br>

## Why ccbar

You're burning through API credits or a $200/month Max subscription — but Claude Code doesn't tell you how fast, which project, or what it'll cost by end of day. ccbar fills that gap.

It works with **both billing models**: whether you're on the API (pay-per-token) or a Pro/Max subscription (quota-based), ccbar tracks your spend in real time. No guessing, no surprises at the end of the month.

## Install

```bash
pip install ccbar
ccbar --install
```

Restart Claude Code. Two status lines appear at the bottom. That's it.

## What you get

```
Row 1:  5h quota bar + countdown · today tokens + ♻cache + cost › per-project · week · month
Row 2:  7d quota bar + countdown · session cost + $/h + →projection + duration + lines · context% + model · total cost
```

Terminal too narrow? Trailing columns drop automatically. Content within columns is never truncated.

## Lightweight by design

ccbar is a single Python file. No frameworks, no background daemons, no node_modules. It reads JSONL logs that Claude Code already writes and the OAuth API you already have. The entire package installs in under a second.

| | ccbar | typical alternatives |
|---|---|---|
| Dependencies | **0** | 10–50+ npm/pip packages |
| Install time | **< 1s** | 30s – 2min |
| Background process | **None** — runs on each statusline refresh | Persistent daemon |
| Config | 1 JSON file or 1 env var | YAML + env + dashboard setup |

## Accurate to the cent

Most tools estimate costs with a flat rate. That's wrong — Opus output is **19x** more expensive than Haiku. ccbar gets it right:

- **Per-model pricing** — reads the model ID from every message. Opus, Sonnet, Haiku each priced correctly.
- **Streaming dedup** — each API call writes 2–7 JSONL entries. ccbar deduplicates by `message.id`. Every message counted exactly once.
- **Cache separation** — cache reads cost 10% of fresh input. ccbar tracks them separately and shows ♻hit rate per project.
- **Cross-session history** — session cost resets when you restart. Your bill doesn't. ccbar scans all JSONL — today, this week, this month, per project.

## Full-spectrum monitoring

| Metric | What it tells you |
|--------|-------------------|
| **5h / 7d quota bars** | Green→yellow→red gradient. Know when you'll hit the limit before you hit it. |
| **Burn rate** `$8.50/h` | How fast this session is spending. |
| **Projection** `→$18` | Where you'll land by quota reset at the current pace. |
| **Per-project** `› proj ♻56M/97% $124` | Which project is eating your budget. Cache hit rate included. |
| **Lines changed** `+250/-40` | Code output this session — are you getting value for the spend? |
| **Context %** | How full the context window is. Helps you decide when to compact. |
| **Today / Week / Month** | Running totals so you always know where the bill stands. |

## API & Subscription — both covered

**API users** — ccbar calculates exact costs from per-model token pricing. You see dollars spent per session, per project, per day.

**Pro / Max subscribers** — ccbar reads your OAuth quota via the Anthropic API. The 5-hour and 7-day progress bars show exactly how much runway you have left, with countdowns to reset.

Either way, you get a single statusline that tells the full story.

## Configure

```bash
export CCBAR_LAYOUT="5h,today,history|7d,session,total"
# or
ccbar --init-config   # → ~/.config/ccbar.json
```

<details>
<summary>Config reference</summary>

```json
{
  "rows": [["5h", "today", "history"], ["7d", "session", "total"]],
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
| `rows` | Layout grid — items: `5h` `7d` `today` `history` `session` `model` `total` |
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
