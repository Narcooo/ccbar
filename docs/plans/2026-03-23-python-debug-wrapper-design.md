# Python Debug Wrapper Design

**Date:** 2026-03-23

## Goal

Restore a Python entrypoint for local debugging without changing `ccbar`'s primary runtime model. The Claude Code plugin and Node CLI remain the only production implementation. Python exists strictly as a convenience wrapper for developers who want to invoke the current CLI with `python -m ccbar` or an equivalent console script.

## Current State

- The repository is now Node/TypeScript-first.
- The main CLI lives in `src/cli.ts` and builds to `dist/cli.js`.
- Local installation and runtime behavior are driven through the Claude plugin scaffold under `.claude-plugin/`.
- The old Python package metadata existed in `v0.1.3`, but the Python runtime itself is no longer present in the current worktree.

## Constraints

- Do not reintroduce a second implementation of `setup`, `doctor`, `repair`, or statusline rendering in Python.
- Do not move the official installation path away from `/plugin install`.
- Keep the Python surface area small enough that future CLI changes only need one implementation update in Node.
- Errors from the Python path must be explicit when the local Node build is missing or `node` is unavailable.

## Approaches Considered

### 1. Thin Python wrapper around `dist/cli.js` (recommended)

Python restores a familiar debug entrypoint, but delegates all behavior to the existing Node CLI. It resolves the repository root, verifies `dist/cli.js` exists, spawns `node dist/cli.js`, forwards stdin/stdout/stderr, and exits with the same code.

**Pros**

- Single source of truth for runtime behavior.
- Minimal maintenance burden.
- Preserves local debugging ergonomics.

**Cons**

- Requires a prior `npm run build`.
- Still depends on a working local Node installation.

### 2. Python helper script outside package metadata

Add only a standalone script such as `scripts/ccbar_py_debug.py`.

**Pros**

- Lowest initial implementation effort.

**Cons**

- Not discoverable or ergonomic.
- Does not restore `python -m ccbar`.
- Harder to document and reuse consistently.

### 3. Reimplement CLI commands in Python

Bring back Python logic for `setup`, `doctor`, and render flows.

**Pros**

- Python can run independently from the Node build.

**Cons**

- Creates permanent behavior drift risk.
- Doubles the maintenance surface.
- Conflicts with the plugin-first direction.

## Recommended Design

Implement approach 1.

### Python package shape

- Add `pyproject.toml` back to the repository.
- Add `ccbar/__main__.py` so `python -m ccbar` works.
- Add `ccbar/main.py` exposing `cli()` and a helper that shells out to Node.

### Runtime behavior

- The wrapper uses the package file location to resolve the repository root.
- It expects `dist/cli.js` at the repository root.
- It forwards:
  - all CLI arguments
  - stdin bytes
  - stdout/stderr streams
  - child process exit code
- On missing build output, print a short actionable message telling the developer to run `npm run build`.
- On missing `node`, print a short actionable message telling the developer to install Node 20+ or run the CLI through Node directly.

### Documentation

- Keep `/plugin install` and `/ccbar:setup` as the main install path in `README.md` and `README_CN.md`.
- Add a small “local Python debug wrapper” section explaining:
  - this is for local development only
  - `npm run build` is required first
  - example invocation with `python -m ccbar doctor`

### Testing

Add Python tests that verify:

- `python -m ccbar` forwards arguments to the Node process.
- stdin is forwarded unchanged.
- the wrapper returns the same exit code as the child process.
- a missing `dist/cli.js` produces the intended error message.
- a missing `node` executable produces the intended error message.

Node-side tests remain unchanged unless a small compatibility check is useful.

## Plugin Direction Notes

`claude-hud` is a useful reference for keeping the plugin story primary. The takeaway to adopt is structural, not behavioral: the plugin path should remain the headline experience, while any developer-only helper stays obviously secondary. This design follows that rule by making Python a wrapper rather than a parallel runtime.

## Risks

- Developers may mistake the Python wrapper for a supported production install path if the docs are too prominent.
- Repository-relative path resolution can become brittle if the package is copied outside the repo root.

## Mitigations

- Label the Python path as debug-only in both READMEs.
- Fail fast when the repository layout is not present.
- Keep the wrapper logic intentionally small and covered by tests.
