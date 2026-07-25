from __future__ import annotations

import sys

PYTHON_RUNNER_SOURCE = r"""
import contextlib
import io
import json
import sys

payload = json.loads(sys.stdin.read() or "{}")
namespace = {
    "input": payload.get("input", ""),
    "inputs": payload.get("inputs", []),
    "output": "",
}
stdout = io.StringIO()
with contextlib.redirect_stdout(stdout):
    exec(str(payload.get("code", "")), namespace)
captured = stdout.getvalue()
result = namespace.get("output")
if result is None:
    result = ""
if result == "" and captured:
    result = captured.rstrip("\n")
if not isinstance(result, str):
    result = json.dumps(result, ensure_ascii=False)
print(result, end="")
"""


def flowent_command(*arguments: str) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, *arguments]
    return [sys.executable, "-m", "flowent.cli", *arguments]


def python_runner_command() -> list[str]:
    if getattr(sys, "frozen", False):
        return flowent_command("_run-python")
    return [sys.executable, "-I", "-c", PYTHON_RUNNER_SOURCE]


def run_python_runner() -> None:
    exec(PYTHON_RUNNER_SOURCE, {})
