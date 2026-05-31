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

os.environ.setdefault("FLOWENT_DATA_DIR", str(_test_environment / "data"))
os.environ["PATH"] = f"{_test_bin}{os.pathsep}{os.environ.get('PATH', '')}"


@pytest.fixture(autouse=True)
def sandbox_available(monkeypatch):
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: "/usr/bin/bwrap")


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
