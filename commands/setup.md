---
description: Configure ccbar as the active Claude Code statusline
allowed-tools: Bash
---

# Set Up ccbar

Run this command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" setup
```

It updates `statusLine` in `~/.claude/settings.json` to run this plugin's `dist/cli.js` directly (`node '<plugin dir>/dist/cli.js' --append-model`, `padding: 0`), preserves unrelated settings and creates a timestamped backup of an existing settings file first.

Rules:
- Do not edit `~/.claude/settings.json` by hand; the command writes the exact value.
- If the command fails, show the user its output instead of working around it.
- After it succeeds, tell the user that `ccbar` is now configured as the statusline.
