# Changelog

## 1.1.0 - 2026-03-24

- Added a responsive statusline layout that automatically switches to a compact two-row view on narrow widths.
- Added safer width detection with runtime probing and a narrow-screen fallback when Claude does not expose terminal width.
- Fixed plugin launcher, setup docs, and hook repair commands to resolve `ccbar` installs across marketplace cache paths instead of relying on one hardcoded cache layout.

## 1.0.0 - 2026-03-20

- Rebased `ccbar` around the native Claude Code plugin system.
- Made plugin marketplace distribution the primary release path.
- Kept local-development installation available through the repository marketplace manifest.
