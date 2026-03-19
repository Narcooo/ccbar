---
description: Diagnose ccbar plugin setup and statusline wiring
allowed-tools: Read, Bash
---

# Diagnose ccbar

Check:
- whether `~/.claude/settings.json` exists
- whether `statusLine` is present
- whether the configured command points to `ccbar`
- whether a plugin install exists under `~/.claude/plugins/cache/ccbar/ccbar`

Report:
- current status
- anything missing or mismatched
- the exact fix needed if setup is broken
