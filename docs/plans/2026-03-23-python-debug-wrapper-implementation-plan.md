# Python Debug Wrapper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a debug-only Python entrypoint that delegates to the existing Node CLI so developers can run `python -m ccbar` locally without reintroducing a second runtime implementation.

**Architecture:** The Python package is a thin subprocess wrapper around `dist/cli.js`. It resolves the repository root from the package location, validates the local Node build is present, spawns `node dist/cli.js`, forwards arguments and stdin/stdout/stderr unchanged, and returns the child exit code. The plugin and Node CLI remain the only production implementation.

**Tech Stack:** Python 3 standard library (`pathlib`, `subprocess`, `shutil`, `sys`, `unittest`), existing Node/TypeScript CLI, Markdown docs.

---

### Task 1: Add failing Python wrapper tests

**Files:**
- Create: `tests/test_python_debug_wrapper.py`
- Reference: `src/cli.ts`

**Step 1: Write the failing test**

```python
import io
import unittest
from unittest import mock

from ccbar import main as ccbar_main


class PythonDebugWrapperTests(unittest.TestCase):
    def test_run_node_cli_forwards_arguments_and_exit_code(self):
        completed = mock.Mock(returncode=7)

        with mock.patch.object(ccbar_main, "_repo_root", return_value="/repo"), \
             mock.patch.object(ccbar_main, "_dist_cli_path", return_value="/repo/dist/cli.js"), \
             mock.patch.object(ccbar_main, "_find_node", return_value="node"), \
             mock.patch.object(ccbar_main.os.path, "exists", return_value=True), \
             mock.patch("subprocess.run", return_value=completed) as run_mock, \
             mock.patch("sys.argv", ["ccbar", "doctor"]):
            exit_code = ccbar_main.cli()

        self.assertEqual(exit_code, 7)
        run_mock.assert_called_once()
```

**Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_python_debug_wrapper.py -v`
Expected: FAIL because `ccbar.main` does not exist yet.

**Step 3: Commit**

Do not commit in red state.

### Task 2: Implement package skeleton and minimal subprocess wrapper

**Files:**
- Create: `pyproject.toml`
- Create: `ccbar/__init__.py`
- Create: `ccbar/__main__.py`
- Create: `ccbar/main.py`
- Test: `tests/test_python_debug_wrapper.py`

**Step 1: Write minimal implementation**

```python
from pathlib import Path
import os
import shutil
import subprocess
import sys


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _dist_cli_path() -> Path:
    return _repo_root() / "dist" / "cli.js"


def _find_node() -> str | None:
    return shutil.which("node")


def cli(argv: list[str] | None = None, stdin_data: bytes | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    dist_cli = _dist_cli_path()
    node = _find_node()
    if not dist_cli.exists():
        print("ccbar debug wrapper requires a built Node CLI. Run `npm run build` first.", file=sys.stderr)
        return 1
    if not node:
        print("ccbar debug wrapper requires Node 20+. Install Node or run `node dist/cli.js` directly.", file=sys.stderr)
        return 1

    if stdin_data is None:
        stdin_data = sys.stdin.buffer.read()

    completed = subprocess.run([node, str(dist_cli), *argv], input=stdin_data)
    return completed.returncode
```

**Step 2: Wire module entrypoint**

```python
from .main import cli


if __name__ == "__main__":
    raise SystemExit(cli())
```

**Step 3: Add package metadata**

```toml
[project]
name = "ccbar"
version = "1.0.0"
requires-python = ">=3.9"

[project.scripts]
ccbar = "ccbar.main:main"
```

Adjust the final script target to the actual exported function name.

**Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_python_debug_wrapper.py -v`
Expected: PASS for the first forwarding test.

**Step 5: Commit**

```bash
git add pyproject.toml ccbar/__init__.py ccbar/__main__.py ccbar/main.py tests/test_python_debug_wrapper.py
git commit -m "feat: add python debug wrapper entrypoint"
```

### Task 3: Add failing tests for stdin passthrough and actionable errors

**Files:**
- Modify: `tests/test_python_debug_wrapper.py`
- Reference: `ccbar/main.py`

**Step 1: Write the failing tests**

```python
    def test_run_node_cli_forwards_stdin_bytes(self):
        completed = mock.Mock(returncode=0)
        fake_stdin = io.BytesIO(b'{"session_id":"abc"}')

        with mock.patch.object(ccbar_main, "_repo_root", return_value="/repo"), \
             mock.patch.object(ccbar_main, "_dist_cli_path", return_value="/repo/dist/cli.js"), \
             mock.patch.object(ccbar_main, "_find_node", return_value="node"), \
             mock.patch.object(ccbar_main.os.path, "exists", return_value=True), \
             mock.patch("sys.stdin", mock.Mock(buffer=fake_stdin)), \
             mock.patch("subprocess.run", return_value=completed) as run_mock:
            ccbar_main.cli([])

        self.assertEqual(run_mock.call_args.kwargs["input"], b'{"session_id":"abc"}')

    def test_missing_build_prints_npm_run_build_hint(self):
        stderr = io.StringIO()

        with mock.patch.object(ccbar_main, "_dist_cli_path", return_value="/repo/dist/cli.js"), \
             mock.patch.object(ccbar_main.os.path, "exists", return_value=False), \
             mock.patch("sys.stderr", stderr):
            exit_code = ccbar_main.cli([])

        self.assertEqual(exit_code, 1)
        self.assertIn("npm run build", stderr.getvalue())
```

**Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_python_debug_wrapper.py -v`
Expected: FAIL because stdin forwarding and missing-build error handling are not fully implemented or not testable yet.

**Step 3: Commit**

Do not commit in red state.

### Task 4: Implement stdin passthrough and explicit error handling

**Files:**
- Modify: `ccbar/main.py`
- Test: `tests/test_python_debug_wrapper.py`

**Step 1: Update implementation minimally**

```python
def cli(argv: list[str] | None = None, stdin_data: bytes | None = None) -> int:
    ...
    if stdin_data is None:
        stdin_data = sys.stdin.buffer.read()

    completed = subprocess.run(
        [node, str(dist_cli), *argv],
        input=stdin_data,
        stdout=sys.stdout.buffer,
        stderr=sys.stderr.buffer,
    )
    return completed.returncode
```

If direct stream handles make testing awkward, prefer `subprocess.Popen(...).communicate(stdin_data)` and keep the public behavior the same.

**Step 2: Run test to verify it passes**

Run: `python -m unittest tests/test_python_debug_wrapper.py -v`
Expected: PASS for the new stdin and missing-build tests.

**Step 3: Commit**

```bash
git add ccbar/main.py tests/test_python_debug_wrapper.py
git commit -m "test: cover python wrapper stdin and build errors"
```

### Task 5: Add failing test for missing `node`

**Files:**
- Modify: `tests/test_python_debug_wrapper.py`
- Reference: `ccbar/main.py`

**Step 1: Write the failing test**

```python
    def test_missing_node_prints_install_hint(self):
        stderr = io.StringIO()

        with mock.patch.object(ccbar_main, "_dist_cli_path", return_value="/repo/dist/cli.js"), \
             mock.patch.object(ccbar_main.os.path, "exists", return_value=True), \
             mock.patch.object(ccbar_main, "_find_node", return_value=None), \
             mock.patch("sys.stderr", stderr):
            exit_code = ccbar_main.cli([])

        self.assertEqual(exit_code, 1)
        self.assertIn("Node 20+", stderr.getvalue())
```

**Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_python_debug_wrapper.py -v`
Expected: FAIL until the missing-node path emits the intended message.

**Step 3: Commit**

Do not commit in red state.

### Task 6: Implement missing-`node` handling

**Files:**
- Modify: `ccbar/main.py`
- Test: `tests/test_python_debug_wrapper.py`

**Step 1: Implement the minimal missing-node branch**

```python
if not node:
    print(
        "ccbar debug wrapper requires Node 20+. Install Node or run `node dist/cli.js` directly.",
        file=sys.stderr,
    )
    return 1
```

**Step 2: Run test to verify it passes**

Run: `python -m unittest tests/test_python_debug_wrapper.py -v`
Expected: PASS for the missing-node test.

**Step 3: Commit**

```bash
git add ccbar/main.py tests/test_python_debug_wrapper.py
git commit -m "test: cover python wrapper node detection"
```

### Task 7: Add debug-only documentation

**Files:**
- Modify: `README.md`
- Modify: `README_CN.md`

**Step 1: Write the docs update**

Add a short section near local development installation that states:

- the Python path is for local debugging only
- run `npm run build` first
- use `python -m ccbar doctor` or `python -m ccbar setup`

**Step 2: Run targeted checks**

Run: `rg -n "Python debug|本地 Python" README.md README_CN.md`
Expected: new debug-only section appears in both files.

**Step 3: Commit**

```bash
git add README.md README_CN.md
git commit -m "docs: document python debug wrapper"
```

### Task 8: Final verification

**Files:**
- Verify: `pyproject.toml`
- Verify: `ccbar/__init__.py`
- Verify: `ccbar/__main__.py`
- Verify: `ccbar/main.py`
- Verify: `tests/test_python_debug_wrapper.py`
- Verify: `README.md`
- Verify: `README_CN.md`

**Step 1: Run Python tests**

Run: `python -m unittest tests/test_python_debug_wrapper.py -v`
Expected: all wrapper tests PASS.

**Step 2: Run Node test suite**

Run: `npm test`
Expected: exit 0 with all current Node tests passing.

**Step 3: Smoke test the wrapper against the built CLI**

Run: `python -m ccbar doctor`
Expected: wrapper invokes the Node CLI successfully and prints the doctor report JSON.

**Step 4: Review diff**

Run: `git diff --stat HEAD~4..HEAD`
Expected: only Python wrapper files, tests, and README updates for this feature.

**Step 5: Commit any remaining verification-related adjustments**

```bash
git add pyproject.toml ccbar README.md README_CN.md tests/test_python_debug_wrapper.py
git commit -m "chore: finalize python debug wrapper"
```
