# Changelog

## 1.3.0 - 2026-11-17

- Fixed statusline renders taking seconds and gigabytes of memory on large transcript histories. Every render used to re-read and re-parse every `*.jsonl` under `~/.claude/projects` (measured: 3.8 GB in 1133 files, 7–9 s and 2.6 GB RSS per render). Token totals now come from an incremental index under `~/.cache/ccbar` (`CCBAR_CACHE_DIR` overrides the location): a render reads only the bytes appended since the previous one (40–70 ms and about 60 MB RSS on the same data), and the first render streams the files instead of loading them whole (2.6–3.4 s, about 200 MB RSS) and publishes its progress every half second, so a render that Claude Code cancels does not start over.
- Totals are unchanged: the index keeps the same per-project dedupe by `message.id` (latest timestamp, then largest output, then scan order), stores token counts per quarter hour and model, and applies today/week/month boundaries and prices at render time. Files that shrink, are replaced, are rewritten in place or disappear are detected and rescanned; index updates are published atomically, so concurrent renders and renders cancelled by Claude Code cannot corrupt it. The cache directory is created private to the user (0700), like the transcripts it is derived from.
- A damaged cache file (for example after a power loss) is discarded and rebuilt from the transcripts in the same render; each rebuild is recorded with its time, file and parse error in `~/.cache/ccbar/rebuild.log`.
- Quota no longer blocks the render. `claude auth status`, the keychain lookup and the usage API call moved into a detached background refresh (one at a time, guarded by a lock, at most every 30 s; the auth mode is re-checked every 5 minutes or when the OAuth token changes). The render shows the last fetched quota, and `--` when there is none, the last refresh failed, or it is older than 10 minutes. It no longer checks the live token itself, so after switching accounts the previous quota can stay visible until the next refresh. The quota cache moved from the system temp directory to `~/.cache/ccbar/quota-v1.json` and records the failure code of an unsuccessful refresh.
- `setup` and `repair` now write a direct `node '<plugin dir>/dist/cli.js' --append-model` statusline command instead of a `sh -lc` login shell that searched the plugin cache with `find` on every render. The new `--append-model` flag appends the model display name to the first line, so statuslines wired by `setup` or `repair` now end their first line with the model name. The `SessionStart` hook still runs `repair`, which rewrites the path when the plugin moves to a new version directory.
- Terminal width detection reads `/dev/tty` directly instead of spawning a login shell.
- The keychain lookup for the OAuth token selects the item of the current account (`-a <user>`) and has a 5 s timeout, so a locked keychain cannot hang it.
- A line without a trailing newline at the end of a transcript is now counted once it is complete, not while it is still being written.

## 1.2.1 - 2026-07-17

- Restyled the scoped weekly overlay from half-block glyphs to line glyphs: `━` where both the overall and scoped 7d limits reach, `─` (colored) where only one does, matching the 5h bar aesthetic.

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
