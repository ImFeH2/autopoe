import os
import stat
import sys
import tempfile
import types
from pathlib import Path

import pytest

_test_environment = Path(tempfile.mkdtemp(prefix="flowent-tests-"))
_test_bin = _test_environment / "bin"
_test_bin.mkdir(parents=True, exist_ok=True)
_test_bwrap = _test_bin / "bwrap"
_test_bwrap.write_text("#!/bin/sh\nexit 0\n")
_test_bwrap.chmod(_test_bwrap.stat().st_mode | stat.S_IXUSR)
_test_rg = _test_bin / "rg"
_test_rg.write_text(
    f"""#!{sys.executable}
from __future__ import annotations

import fnmatch
import sys
from pathlib import Path

args = sys.argv[1:]
glob = None
line_number = False
max_count = None
positionals = []
index = 0
while index < len(args):
    arg = args[index]
    if arg == "--line-number":
        line_number = True
        index += 1
    elif arg == "--max-count":
        max_count = int(args[index + 1])
        index += 2
    elif arg == "--glob":
        glob = args[index + 1]
        index += 2
    else:
        positionals.append(arg)
        index += 1

if len(positionals) < 2:
    sys.exit(2)

pattern = positionals[0]
root = Path(positionals[1])
paths = [root] if root.is_file() else sorted(path for path in root.rglob("*") if path.is_file())
matches = 0
for path in paths:
    if glob is not None:
        try:
            relative = str(path.relative_to(root))
        except ValueError:
            relative = path.name
        if not fnmatch.fnmatch(relative, glob) and not fnmatch.fnmatch(path.name, glob):
            continue
    for line_index, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
        if pattern not in line:
            continue
        if line_number:
            print(f"{{path}}:{{line_index}}:{{line}}")
        else:
            print(line)
        matches += 1
        if max_count is not None and matches >= max_count:
            sys.exit(0)

sys.exit(0 if matches else 1)
"""
)
_test_rg.chmod(_test_rg.stat().st_mode | stat.S_IXUSR)

os.environ.setdefault("FLOWENT_DATA_DIR", str(_test_environment / "data"))
os.environ["PATH"] = f"{_test_bin}{os.pathsep}{os.environ.get('PATH', '')}"


@pytest.fixture(autouse=True)
def sandbox_available(monkeypatch):
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: "/usr/bin/bwrap")
    monkeypatch.setattr("flowent.system_tools.ripgrep_binary", lambda: str(_test_rg))


@pytest.fixture
def make_executable_file():
    def make(path: Path, content: str = "#!/bin/sh\nexit 0\n") -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
        return path

    return make


@pytest.fixture
def fake_litellm_responses_transformer(monkeypatch):
    transformation_module = types.ModuleType(
        "litellm.completion_extras.litellm_responses_transformation.transformation"
    )

    class OpenAiResponsesToChatCompletionStreamIterator:
        @staticmethod
        def translate_responses_chunk_to_openai_stream(parsed_chunk):
            return {"choices": [{"delta": {"content": ""}, "finish_reason": None}]}

    transformation_module.OpenAiResponsesToChatCompletionStreamIterator = (
        OpenAiResponsesToChatCompletionStreamIterator
    )
    monkeypatch.setitem(sys.modules, "litellm", types.ModuleType("litellm"))
    monkeypatch.setitem(
        sys.modules,
        "litellm.completion_extras",
        types.ModuleType("litellm.completion_extras"),
    )
    monkeypatch.setitem(
        sys.modules,
        "litellm.completion_extras.litellm_responses_transformation",
        types.ModuleType("litellm.completion_extras.litellm_responses_transformation"),
    )
    monkeypatch.setitem(
        sys.modules,
        "litellm.completion_extras.litellm_responses_transformation.transformation",
        transformation_module,
    )

    import flowent.llm as llm_module

    monkeypatch.setattr(llm_module, "_litellm_stream_error_patch_installed", False)
    llm_module.configure_litellm_stream_error_handling()
