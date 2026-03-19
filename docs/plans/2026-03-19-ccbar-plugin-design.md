# ccbar Native Claude Code Plugin Design

Date: 2026-03-19
Scope: `Claude Code plugin + Node.js/TypeScript runtime`
Status: Approved

## Goal

Transform `ccbar` from a Python CLI installed via PyPI into a native Claude Code plugin that:
- installs through Claude Code's plugin workflow
- owns its `statusLine` integration
- auto-repairs its setup on session start
- preserves the existing cost/quota monitoring behavior

## User-Facing Outcome

After installation, `ccbar` should feel like a first-class Claude Code plugin rather than an external script.

The plugin must:
- expose Claude Code plugin metadata and commands
- configure Claude Code to render `ccbar` through `statusLine.command`
- remain usable without `pip install`
- keep the current `ccbar` visual model: quota bars, cost summaries, projections, and project-aware history

## Non-Goals

This design does not include:
- long-term co-maintenance of Python and TypeScript implementations
- preserving PyPI as a primary runtime path
- rethinking the product into a dashboard or multi-pane UI
- adding brand-new metrics unrelated to current `ccbar` behavior

## Product Rules

- `ccbar` becomes a Claude Code native plugin.
- Runtime implementation is Node.js/TypeScript.
- Python source is backed up locally but removed from active tracked implementation.
- The plugin owns setup, repair, and statusline integration.
- When correctness is uncertain, the statusline renders less information rather than stale or misleading data.

## Repository Shape

The repository should be reorganized around Claude Code plugin conventions:

```text
ccbar/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── commands/
│   ├── setup.md
│   ├── configure.md
│   └── doctor.md
├── hooks/
│   └── hooks.json
├── bin/
│   └── ccbar
├── src/
│   ├── cli.ts
│   ├── statusline.ts
│   ├── config.ts
│   ├── install.ts
│   ├── pricing.ts
│   ├── transcript.ts
│   ├── quota.ts
│   └── render/
│       ├── items.ts
│       └── layout.ts
├── tests/
├── package.json
└── tsconfig.json
```

## Architecture

`ccbar` runs as a command-style plugin entrypoint.

Runtime flow:

```text
Claude Code
  -> statusLine.command
  -> plugin launcher
  -> Node dist entry
  -> stdin JSON parsed
  -> local transcript and quota state loaded
  -> adaptive statusline rendered to stdout
```

The plugin remains single-purpose:
- no web UI
- no dashboard server
- no persistent daemon requirement for correctness

## Core Runtime Modules

### `transcript.ts`

Responsibilities:
- scan `~/.claude/projects/**/*.jsonl`
- skip irrelevant progress entries
- deduplicate streaming records by `message.id`
- aggregate totals for `today`, `week`, `month`, and `all-time`
- compute per-project rollups

### `pricing.ts`

Responsibilities:
- maintain model pricing defaults
- support model alias and version-prefix matching
- compute base input/output/cache-creation cost
- compute cache-read cost separately

### `quota.ts`

Responsibilities:
- detect current Claude auth mode
- read current OAuth token when relevant
- call the Anthropic OAuth usage endpoint
- cache successful quota payloads
- back off on failures and rate limits
- refuse to present cached quota as truth when it no longer matches the live auth context

### `statusline.ts`

Responsibilities:
- parse Claude Code stdin payload
- collect workspace, model, and context usage metadata
- load plugin config
- assemble render context from transcript and quota data
- produce one or two statusline rows

### `render/*`

Responsibilities:
- keep the current widget model:
  - `5h`
  - `7d`
  - `today`
  - `history`
  - `session`
  - `model`
  - `total`
- keep adaptive width behavior
- drop trailing columns rather than truncating cell content

## Setup And Auto-Repair

The plugin handles installation in two layers.

### Explicit setup command

`/ccbar:setup` updates `~/.claude/settings.json` to point `statusLine.command` at the plugin launcher.

Setup behavior:
- read current settings
- back up the file before mutation
- replace only the `statusLine` block
- leave unrelated settings untouched

### Session start repair

A `SessionStart` hook verifies that:
- the `statusLine.command` still points at `ccbar`
- required config files exist
- schema defaults are present after upgrades

If not, the hook repairs the configuration.

This makes plugin setup self-healing even when the user edits settings manually or upgrades from older plugin versions.

## Installation Semantics

The design should treat "auto start" as:
- no separate `pip install`
- no manual `ccbar --install`
- best-effort immediate activation through plugin setup flow
- guaranteed repair on future session starts through hooks

The design must not depend on undocumented post-install lifecycle hooks.

## Config Model

Configuration should move from `~/.config/ccbar.json` to a plugin-owned config path under Claude's plugin directory, while still preserving the existing layout concepts:
- rows
- optional columns override
- colors
- pricing overrides
- API overrides for diagnostics

The plugin commands should provide:
- `/ccbar:setup`
- `/ccbar:configure`
- `/ccbar:doctor`

## Data Correctness Rules

- Token and cost metrics come from Claude transcript JSONL.
- Quota metrics only render when current auth mode and cached/live quota data match.
- API-key mode must not display subscription quota.
- Unknown auth state must render `--` for quota widgets.
- Projection depends on confirmed quota availability.

## Migration Strategy

Migration should be one-way.

1. Back up Python implementation outside tracked source control.
2. Introduce plugin-native Node/TypeScript structure.
3. Port Python behavior module-by-module into TypeScript.
4. Add regression coverage for each migrated subsystem.
5. Remove tracked Python runtime implementation.
6. Rewrite docs around plugin installation and plugin commands.

## Testing Strategy

The rewrite needs behavior-focused tests rather than superficial snapshot-only coverage.

Required coverage:
- transcript deduplication
- pricing calculations per model
- quota auth-mode gating
- quota rate-limit retry behavior
- project-name normalization
- narrow terminal layout fallback
- setup/repair preserving unrelated Claude settings

## Release Strategy

Release should target Claude Code plugin distribution first.

The repository must be publishable as a plugin marketplace source with:
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- built runtime artifacts included or generated by release process

## Invariant

`ccbar` must behave like a native Claude Code plugin without regressing the correctness guarantees that made the original tool useful.
