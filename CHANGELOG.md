# Changelog

## 1.2.0 - 2026-07-17

- Fixed the pricing table for current Claude models: added `claude-fable-5` ($10/$50), `claude-opus-4-8`/`4-7` ($5/$25), and `claude-sonnet-5`; corrected `claude-opus-4-6`/`4-5` from legacy $15/$75 to $5/$25 and `claude-haiku-4-5` from $0.8/$4 to $1/$5. Cost stats previously underestimated Fable 5 usage ~3.3x and Opus 4.8 usage ~40%.
- Added model-scoped weekly quota (e.g. the Fable 7d limit) as an overlay inside the existing 7d cell: a half-block dual bar (`▀` overall / `▄` scoped / `█` both) plus a `41%·F66%` readout, sourced from the usage API `limits[]` `weekly_scoped` entries. No extra row or cell is used.

## 1.1.2 - 2026-03-24

- Fixed compact quota statusline rendering so narrow Claude Code layouts stay on two lines instead of collapsing back into one long row.
- Shortened compact quota bars, compact countdown text, and narrow-path rendering to keep project and quota data visible on constrained widths.
- Added a regression test that enforces the compact quota rows stay within narrow UI width limits.

## 1.1.1 - 2026-03-24

- Fixed live quota rendering so `ccbar` now resolves Claude auth mode, reads the Claude Code OAuth token, fetches `/api/oauth/usage`, and passes real 5h/7d quota data into the statusline.
- Added auth-aware quota tests covering `claude.ai` detection, API-mode suppression, and live quota cache refresh.

## 1.1.0 - 2026-03-24

- Added a responsive statusline layout that automatically switches to a compact two-row view on narrow widths.
- Added safer width detection with runtime probing and a narrow-screen fallback when Claude does not expose terminal width.
- Fixed plugin launcher, setup docs, and hook repair commands to resolve `ccbar` installs across marketplace cache paths instead of relying on one hardcoded cache layout.

## 1.0.0 - 2026-03-20

- Rebased `ccbar` around the native Claude Code plugin system.
- Made plugin marketplace distribution the primary release path.
- Kept local-development installation available through the repository marketplace manifest.
