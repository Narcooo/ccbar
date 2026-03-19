---
description: Configure ccbar as the active Claude Code statusline
allowed-tools: Read, Write
---

# Set Up ccbar

Update `~/.claude/settings.json` so `statusLine` is exactly:

```json
{
  "type": "command",
  "command": "sh -lc 'PLUGIN_DIR=$(find \"$HOME/.claude/plugins/cache/ccbar/ccbar\" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -n 1); [ -n \"$PLUGIN_DIR\" ] || exit 0; exec node \"$PLUGIN_DIR/dist/cli.js\"'",
  "padding": 0
}
```

Rules:
- Preserve unrelated settings.
- If `~/.claude/settings.json` already exists, create a timestamped backup first.
- If the file is missing, create it with valid JSON.
- After saving, tell the user that `ccbar` is now configured as the statusline.
