<div align="center">

<br>

<img src="assets/logo.svg" alt="ccbar" width="400">

<br>
<br>

**Vibe coding is no longer just for fun. Know what it costs.**

Real-time cost tracking and quota monitoring for Claude Code. Zero dependencies.

[![PyPI](https://img.shields.io/pypi/v/ccbar?style=flat-square&color=blue)](https://pypi.org/project/ccbar/)
[![Downloads](https://img.shields.io/pypi/dm/ccbar?style=flat-square&color=green)](https://pypi.org/project/ccbar/)
[![Python](https://img.shields.io/pypi/pyversions/ccbar?style=flat-square)](https://pypi.org/project/ccbar/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)

[![English](https://img.shields.io/badge/lang-English-blue?style=flat-square)](#)
[![中文](https://img.shields.io/badge/lang-中文-grey?style=flat-square)](./README_CN.md)

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
/plugin install ccbar
/ccbar:setup
```

`ccbar` now installs as a native Claude Code plugin. `setup` wires the plugin into `statusLine.command`, and the bundled `SessionStart` hook repairs the wiring if it drifts later.

## What you get

```
Row 1:  5h quota bar + countdown · today tokens + cost › proj tokens ♻cache/hit% cost · week cost › proj tokens cost │ month tokens cost › proj cost
Row 2:  7d quota bar + countdown · session cost + $/h + →projection + duration + ctx% + lines · total cost › proj tokens ♻cache cost + path
```

Terminal too narrow? Trailing columns drop automatically. Content within columns is never truncated.

## Lightweight by design

ccbar is now a native Claude Code plugin built on Node.js/TypeScript. There is no PyPI bootstrap layer, no extra daemon requirement for correctness, and no separate `ccbar --install` step. It reads the JSONL logs Claude Code already writes and renders directly through Claude's plugin-driven statusline flow.

| | ccbar | typical alternatives |
|---|---|---|
| Runtime path | **Native Claude plugin** | external script + manual wiring |
| Setup | **`/plugin install` + `/ccbar:setup`** | package install + shell glue |
| Background process | **None required** | Persistent daemon |
| Config | plugin config JSON + slash commands | YAML + env + dashboard setup |

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
/ccbar:configure
/ccbar:doctor
```

<details>
<summary>Config reference</summary>

```json
{
  "rows": [["5h", "today", "history"], ["7d", "session", "total"]],
  "columns": null
}
```

| Field | Description |
|-------|-------------|
| `rows` | Layout grid — items: `5h` `7d` `today` `history` `session` `model` `total` |
| `columns` | Override terminal width (`null` = auto-detect) |

</details>

The plugin stores config under `~/.claude/plugins/ccbar/config.json`.

## How it works

```
stdin JSON → plugin runtime → scan ~/.claude/projects/**/*.jsonl
           → dedup by message.id → per-model pricing
           → adaptive layout → stdout
```

Plugin commands:
- `/ccbar:setup` wires `statusLine.command`
- `/ccbar:configure` edits plugin config
- `/ccbar:doctor` checks plugin cache and statusline wiring

## Uninstall

```bash
/plugin remove ccbar
```

---

<div align="center">

MIT

</div>
