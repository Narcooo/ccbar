# Public GitHub Marketplace Design

**Date:** 2026-03-23

## Goal

Publish `ccbar` through a public GitHub-backed Claude Code marketplace so users can install it directly with `/plugin marketplace add <repo>` instead of only using a local development marketplace or waiting for the official Anthropic marketplace listing.

## Current State

- The plugin itself is already packaged as a Claude Code plugin in `.claude-plugin/plugin.json`.
- The repository already contains a marketplace manifest at `.claude-plugin/marketplace.json`, but it is explicitly development-oriented:
  - marketplace name is `ccbar-dev`
  - description says “Local development marketplace”
- The READMEs document:
  - official Anthropic marketplace install
  - local development marketplace install from a filesystem path
  - local Python debug wrapper usage
- The Python wrapper is intentionally debug-only and should not become a public installation headline.

## Constraints

- Keep the public distribution path plugin-first.
- Do not create a second repository unless there is a clear technical need.
- Do not turn the Python wrapper into a public runtime option.
- Preserve the ability to use the same repository for local development installs.
- Avoid ambiguous naming between marketplace name and plugin name.

## Approaches Considered

### 1. Single-repository public marketplace (recommended)

Keep `.claude-plugin/marketplace.json` in the main `ccbar` repository and make it suitable for public GitHub distribution. Users add the GitHub repository as a marketplace and install `ccbar` from it.

**Pros**

- Minimal change from current structure.
- Lowest maintenance cost.
- Keeps plugin source, marketplace manifest, and docs in one place.

**Cons**

- Requires replacing the current development-facing marketplace name and description.
- Public documentation must clearly distinguish GitHub marketplace installs from local path installs.

### 2. Single repository with a more explicit remote source format

Keep one repository, but replace `plugins[].source: "./"` with a more explicit repository reference if the marketplace tooling supports it.

**Pros**

- More explicit remote intent.

**Cons**

- Adds complexity without solving a current problem.
- Risks drifting from the already validated local marketplace pattern.

### 3. Separate public marketplace repository

Move the marketplace manifest into a dedicated repository while keeping `ccbar` implementation in the current repository.

**Pros**

- Clean separation between plugin implementation and marketplace curation.
- Scales if many plugins are later added.

**Cons**

- Overbuilt for a single-plugin release.
- Creates a second public maintenance surface immediately.

## Recommended Design

Implement approach 1.

### Marketplace identity

- Change marketplace name from `ccbar-dev` to `narcooo`.
- Keep plugin name as `ccbar`.
- Public install flow becomes:

```bash
/plugin marketplace add https://github.com/Narcooo/ccbar
/plugin install ccbar@narcooo
/ccbar:setup
```

This avoids the confusing `ccbar@ccbar` shape while leaving room for future plugins under the same public marketplace owner.

### Repository structure

- Keep `.claude-plugin/marketplace.json` in the main repository.
- Keep `plugins[].source` as `./`.
- Continue to treat the repository root as the marketplace entrypoint for GitHub-backed installs.

### Documentation split

The READMEs should explicitly document three installation modes:

1. Official Anthropic marketplace install
2. Public GitHub marketplace install
3. Local development marketplace install

The GitHub marketplace path should be the new public self-serve route. The local filesystem path route remains for development and pre-release testing only.

### Python wrapper positioning

- Keep the Python wrapper section in the READMEs.
- Keep it labeled debug-only.
- Do not mention Python in the public GitHub marketplace installation instructions.

### Testing and validation

Update tests so the repository shape enforces the public marketplace contract:

- marketplace manifest name is `narcooo`
- README and README_CN mention the GitHub marketplace install command
- local development install instructions still exist
- plugin-first installation remains the headline path

Validation should continue to include:

- `claude plugin validate .claude-plugin/plugin.json`
- `claude plugin validate .claude-plugin/marketplace.json`
- `npm test`

## Error Handling and Compatibility

- No compatibility alias will be maintained for `ccbar-dev` in public docs.
- Existing local development installs using `ccbar@ccbar-dev` are acceptable as a development-only legacy path, but public-facing docs should stop advertising that name.
- The marketplace manifest should use a public description rather than a development-only description.

## Risks

- Users may confuse the GitHub marketplace path with the official Anthropic marketplace path if the README sections are not distinct enough.
- If GitHub marketplace support has subtle expectations around repository path handling, relative plugin source resolution must remain valid.

## Mitigations

- Separate the three install modes with clear labels and explicit commands.
- Keep the validated manifest structure as close to the current working version as possible.
- Preserve local development instructions so regression testing remains easy.

## Success Criteria

- A user can add the GitHub repository as a marketplace and see `narcooo` as the marketplace identifier.
- Public docs tell users to install `ccbar@narcooo` from GitHub.
- Local development docs still explain path-based installation.
- Automated validation and tests remain green.
