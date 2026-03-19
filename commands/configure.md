---
description: Configure ccbar plugin settings
allowed-tools: Read, Write
---

# Configure ccbar

Edit `~/.claude/plugins/ccbar/config.json`.

Rules:
- If the file does not exist, create it.
- Keep valid JSON formatting.
- Preserve unknown fields already present.
- If the user did not specify exact changes, ask what they want to change before editing.

Default shape:

```json
{
  "rows": [["5h", "today", "history"], ["7d", "session", "total"]],
  "columns": null,
  "colors": {},
  "pricing": {}
}
```
