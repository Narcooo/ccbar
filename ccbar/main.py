"""Thin Python wrapper that delegates to the built Node CLI."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional, Sequence


def _repo_root() -> str:
    return str(Path(__file__).resolve().parent.parent)


def _dist_cli_path() -> str:
    return os.path.join(_repo_root(), "dist", "cli.js")


def _find_node() -> Optional[str]:
    return shutil.which("node")


def cli(argv: Optional[Sequence[str]] = None, stdin_data: Optional[bytes] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    dist_cli = _dist_cli_path()

    if not os.path.exists(dist_cli):
        print(
            "ccbar debug wrapper requires a built Node CLI. Run `npm run build` first.",
            file=sys.stderr,
        )
        return 1

    node = _find_node()
    if not node:
        print(
            "ccbar debug wrapper requires Node 20+. Install Node or run `node dist/cli.js` directly.",
            file=sys.stderr,
        )
        return 1

    if stdin_data is None:
        stdin_data = sys.stdin.buffer.read()

    completed = subprocess.run(
        [node, dist_cli, *args],
        input=stdin_data,
    )
    return int(completed.returncode)


def main() -> None:
    raise SystemExit(cli())

