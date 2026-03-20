# ccbar Marketplace Submission Pack

Date: 2026-03-20
Target marketplace: `claude-plugins-official`

## Official submission path

- Official plugin directory repo: `https://github.com/anthropics/claude-plugins-official`
- Claude.ai submission form: `https://claude.ai/settings/plugins/submit`
- Console submission form: `https://platform.claude.com/plugins/submit`
- Short link referenced by the directory README: `https://clau.de/plugin-directory-submission`
- Marketplace docs: `https://code.claude.com/docs/en/plugin-marketplaces`
- Plugin reference docs: `https://code.claude.com/docs/en/plugins-reference`

## Submission checklist

- [x] Public source repository exists: `https://github.com/Narcooo/ccbar`
- [x] Plugin manifest validates with `claude plugin validate .claude-plugin/plugin.json`
- [x] Marketplace manifest validates with `claude plugin validate .claude-plugin/marketplace.json`
- [x] Plugin version is stable and aligned at `1.0.0`
- [x] `README.md` documents official marketplace install and local development install
- [x] `LICENSE` exists
- [x] `CHANGELOG.md` exists
- [x] Test suite passes with `npm test`
- [ ] Push the `1.0.0` changes to GitHub
- [ ] Create and push git tag `v1.0.0`
- [ ] Submit the form
- [ ] Watch for follow-up requests from Anthropic on security, docs, or support

## Form-ready metadata

### Plugin name

`ccbar`

### Repository URL

`https://github.com/Narcooo/ccbar`

### Homepage / docs URL

`https://github.com/Narcooo/ccbar#readme`

### License

`MIT`

### Author / maintainer

- Name: `majunxian`
- Contact: use the GitHub repository issues page unless you want to add a dedicated support email before submission

### Category suggestion

`productivity`

### Tag suggestions

- `claude-code`
- `statusline`
- `cost-tracking`
- `quota`
- `monitoring`

## Short description

Real-time cost tracking and quota monitoring for Claude Code in the status line.

## Medium description

`ccbar` is a native Claude Code plugin that shows real-time cost and quota data directly in the status line. It tracks token usage and spend across sessions and projects, prices usage per model, and surfaces 5-hour and 7-day quota bars for subscription users.

## Long description

`ccbar` helps Claude Code users understand what a coding session is costing while they work. The plugin reads Claude Code's local transcript logs, deduplicates streaming records by message ID, and calculates model-aware token costs for session, day, week, month, and per-project views.

For Pro and Max users, `ccbar` also shows 5-hour and 7-day quota progress with reset countdowns. The plugin is lightweight, runs as a native Claude Code plugin, and does not require a separate dashboard or always-on daemon for correctness.

## Why this plugin belongs in the official directory

- It solves a common Claude Code pain point: users can see spend and quota pressure without leaving the terminal.
- It uses the native plugin model instead of external shell glue.
- It is easy to evaluate: the behavior is visible immediately in the status line after install.
- It has automated validation and tests around plugin structure, install wiring, transcript parsing, pricing, quota gating, and rendering.

## Security / behavior notes

- The plugin reads local Claude transcript JSONL files under `~/.claude/projects`.
- It updates Claude Code `statusLine.command` only when the user runs `/ccbar:setup`, and later repairs that same setting via its `SessionStart` hook if the wiring drifts.
- It does not require external services for core transcript-based cost reporting.
- Quota display is conservative: when auth or quota correctness is uncertain, the plugin renders less information rather than stale values.

## Install text for marketplace listing

```bash
/plugin install ccbar@claude-plugins-official
/ccbar:setup
```

## Reviewer verification steps

```bash
git clone https://github.com/Narcooo/ccbar.git
cd ccbar
npm install
npm test
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
```

Then in Claude Code:

```bash
/plugin marketplace add /absolute/path/to/ccbar
/plugin install ccbar@ccbar-dev
/ccbar:setup
/ccbar:doctor
```

## Suggested answers for open text fields

### What problem does this plugin solve?

Claude Code users often do not have a clear view of how quickly they are consuming API spend or subscription quota while they work. `ccbar` makes that visible in the status line so users can adjust model choice, session duration, and project behavior before they hit budget or quota limits.

### Why is this useful to Claude Code users?

It reduces surprise costs, makes quota pressure visible in real time, and surfaces project-level usage patterns without requiring users to open a separate dashboard or manually inspect logs.

### What makes this implementation trustworthy?

The plugin uses Claude Code's native plugin system, validates its manifests with the Claude CLI, and has automated tests covering transcript deduplication, pricing logic, quota gating, install wiring, and adaptive status-line rendering.

## Remaining non-blocking improvements

- Add a dedicated maintainer contact email in `.claude-plugin/plugin.json`.
- Push the `1.0.0` release tag before submitting.
- Consider adding screenshots tailored for the submission form if the form supports attachments.
