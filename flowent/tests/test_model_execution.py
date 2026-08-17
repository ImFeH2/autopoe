from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from threading import Thread

import pytest
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from test_model_runner import activation_context

from flowent.diagnostics import configure_diagnostics, shutdown_diagnostics
from flowent.model_execution import (
    ModelExecutionLoop,
    ModelRequestLimiter,
    ModelRequestPolicy,
    RetryingModel,
)
from flowent.model_runner import ModelConfig, ModelRuntime, PydanticAgentRunner
from flowent.persistence import SQLiteStore
from flowent.runtime import AgentRunFailure, AgentRunOutcome
from flowent.todos import AgentTodos


def test_model_execution_loop_owns_calls_from_multiple_threads() -> None:
    execution_loop = ModelExecutionLoop()
    loop_ids: list[int] = []

    async def record_loop() -> None:
        loop_ids.append(id(asyncio.get_running_loop()))
        await asyncio.sleep(0.01)

    threads = [
        Thread(target=lambda: execution_loop.run(record_loop())) for _ in range(6)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    execution_loop.shutdown()

    assert len(loop_ids) == 6
    assert len(set(loop_ids)) == 1


def test_model_request_policy_retries_before_stream_events(tmp_path: Path) -> None:
    attempts = 0
    delays: list[float] = []

    async def respond(_messages: list[ModelMessage], _info: AgentInfo):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ModelAPIError("test-model", "connection failed")
        yield "Recovered"

    async def record_sleep(delay: float) -> None:
        delays.append(delay)

    policy = ModelRequestPolicy(
        "openai-chat",
        sleep=record_sleep,
        random_value=lambda: 0.5,
    )
    runner = PydanticAgentRunner(
        ModelConfig("openai-chat", "https://example.invalid", "test-key", "test-model"),
        request_policy=policy,
    )
    reminder, context = activation_context(tmp_path)

    with runner._agent.override(
        model=RetryingModel(FunctionModel(stream_function=respond), policy)
    ):
        outcome = runner.run(reminder, context)

    assert attempts == 2
    assert delays == [1.5]
    assert "Recovered" in str(outcome.messages)


def test_model_request_policy_does_not_retry_after_stream_events(
    tmp_path: Path,
) -> None:
    attempts = 0

    async def respond(_messages: list[ModelMessage], _info: AgentInfo):
        nonlocal attempts
        attempts += 1
        yield "Partial"
        raise ModelAPIError("test-model", "stream failed")

    policy = ModelRequestPolicy(
        "openai-chat",
        sleep=lambda _delay: asyncio.sleep(0),
        random_value=lambda: 0.5,
    )
    runner = PydanticAgentRunner(
        ModelConfig("openai-chat", "https://example.invalid", "test-key", "test-model"),
        request_policy=policy,
    )
    reminder, context = activation_context(tmp_path)

    with (
        runner._agent.override(
            model=RetryingModel(FunctionModel(stream_function=respond), policy)
        ),
        pytest.raises(AgentRunFailure, match="^Model request failed$"),
    ):
        runner.run(reminder, context)

    assert attempts == 1


def test_model_request_policy_does_not_retry_non_transient_http_error(
    tmp_path: Path,
) -> None:
    attempts = 0

    async def respond(_messages: list[ModelMessage], _info: AgentInfo):
        nonlocal attempts
        attempts += 1
        raise ModelHTTPError(401, "test-model")
        yield

    policy = ModelRequestPolicy(
        "openai-chat",
        sleep=lambda _delay: asyncio.sleep(0),
        random_value=lambda: 0.5,
    )
    runner = PydanticAgentRunner(
        ModelConfig("openai-chat", "https://example.invalid", "test-key", "test-model"),
        request_policy=policy,
    )
    reminder, context = activation_context(tmp_path)

    with (
        runner._agent.override(
            model=RetryingModel(FunctionModel(stream_function=respond), policy)
        ),
        pytest.raises(AgentRunFailure, match="^Model request failed$"),
    ):
        runner.run(reminder, context)

    assert attempts == 1


def test_model_request_policy_retries_transient_http_error_with_capped_delay(
    tmp_path: Path,
) -> None:
    attempts = 0
    delays: list[float] = []

    async def respond(_messages: list[ModelMessage], _info: AgentInfo):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ModelHTTPError(
                503,
                "test-model",
                headers={"retry-after": "45"},
            )
        yield "Recovered"

    async def record_sleep(delay: float) -> None:
        delays.append(delay)

    policy = ModelRequestPolicy("openai-chat", sleep=record_sleep)
    runner = PydanticAgentRunner(
        ModelConfig("openai-chat", "https://example.invalid", "test-key", "test-model"),
        request_policy=policy,
    )
    reminder, context = activation_context(tmp_path)

    with runner._agent.override(
        model=RetryingModel(FunctionModel(stream_function=respond), policy)
    ):
        outcome = runner.run(reminder, context)

    assert attempts == 2
    assert delays == [30.0]
    assert "Recovered" in str(outcome.messages)


def test_model_request_retry_diagnostics_exclude_error_content(
    tmp_path: Path,
) -> None:
    attempts = 0

    async def respond(_messages: list[ModelMessage], _info: AgentInfo):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ModelAPIError("test-model", "private provider response")
        yield "Recovered"

    path = configure_diagnostics(tmp_path / "diagnostics")
    assert path is not None
    policy = ModelRequestPolicy(
        "openai-chat",
        sleep=lambda _delay: asyncio.sleep(0),
    )
    runner = PydanticAgentRunner(
        ModelConfig("openai-chat", "https://example.invalid", "test-key", "test-model"),
        request_policy=policy,
    )
    reminder, context = activation_context(tmp_path)
    try:
        with runner._agent.override(
            model=RetryingModel(FunctionModel(stream_function=respond), policy)
        ):
            runner.run(reminder, context)
    finally:
        shutdown_diagnostics()

    content = path.read_text()
    assert "private provider response" not in content
    assert "model.request.retry.scheduled" in content
    assert "model.request.retry.recovered" in content


def test_model_request_policy_exhausts_one_flowent_retry(tmp_path: Path) -> None:
    attempts = 0
    delays: list[float] = []

    async def respond(_messages: list[ModelMessage], _info: AgentInfo):
        nonlocal attempts
        attempts += 1
        raise ModelAPIError("test-model", "connection failed")
        yield

    async def record_sleep(delay: float) -> None:
        delays.append(delay)

    policy = ModelRequestPolicy(
        "openai-chat",
        sleep=record_sleep,
        random_value=lambda: 0.5,
    )
    runner = PydanticAgentRunner(
        ModelConfig("openai-chat", "https://example.invalid", "test-key", "test-model"),
        request_policy=policy,
    )
    reminder, context = activation_context(tmp_path)

    with (
        runner._agent.override(
            model=RetryingModel(FunctionModel(stream_function=respond), policy)
        ),
        pytest.raises(AgentRunFailure, match="^Model request failed$"),
    ):
        runner.run(reminder, context)

    assert attempts == 2
    assert delays == [1.5]


def test_model_request_retry_does_not_repeat_completed_tool(tmp_path: Path) -> None:
    attempts = 0

    async def respond(_messages: list[ModelMessage], _info: AgentInfo):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            yield {
                0: DeltaToolCall(
                    name="todo",
                    json_args='{"action":"create","subject":"Inspect once"}',
                    tool_call_id="todo-once",
                )
            }
        elif attempts == 2:
            raise ModelAPIError("test-model", "connection failed")
        else:
            yield "Finished"

    store = SQLiteStore(tmp_path / "data")
    todos = AgentTodos(store)
    policy = ModelRequestPolicy(
        "openai-chat",
        sleep=lambda _delay: asyncio.sleep(0),
    )
    runner = PydanticAgentRunner(
        ModelConfig("openai-chat", "https://example.invalid", "test-key", "test-model"),
        request_policy=policy,
    )
    reminder, context = activation_context(tmp_path)
    context = replace(context, todos=todos)

    with runner._agent.override(
        model=RetryingModel(FunctionModel(stream_function=respond), policy)
    ):
        outcome = runner.run(reminder, context)

    assert attempts == 3
    assert todos.list(2)["count"] == 1
    assert "Finished" in str(outcome.messages)


def test_model_request_policy_limits_concurrent_requests_across_runners() -> None:
    limiter = ModelRequestLimiter(3)
    policies = [
        ModelRequestPolicy("openai-chat", limiter=limiter),
        ModelRequestPolicy("openai-responses", limiter=limiter),
    ]
    active = 0
    maximum = 0

    @asynccontextmanager
    async def factory(_run_context):
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        try:
            await asyncio.sleep(0.02)
            yield object()
        finally:
            active -= 1

    async def exercise() -> None:
        async def request(policy: ModelRequestPolicy) -> None:
            async with policy.request_stream(factory, None):
                await asyncio.sleep(0.02)

        await asyncio.gather(*[request(policies[index % 2]) for index in range(8)])

    asyncio.run(exercise())

    assert maximum == 3


def test_model_runtime_runs_concurrent_agents_on_one_event_loop(
    tmp_path: Path,
) -> None:
    loop_ids: list[int] = []
    started = 0
    closed = 0
    errors: list[BaseException] = []

    class RecordingRunner(PydanticAgentRunner):
        async def start(self) -> None:
            nonlocal started
            started += 1

        async def close(self) -> None:
            nonlocal closed
            closed += 1

        async def run_async(self, _reminder, _context) -> AgentRunOutcome:
            loop_ids.append(id(asyncio.get_running_loop()))
            await asyncio.sleep(0.02)
            return AgentRunOutcome()

    runner = object.__new__(RecordingRunner)
    runtime = ModelRuntime(
        ModelConfig("openai-chat", "https://example.invalid", "test-key", "test-model"),
        runner_factory=lambda _config, _observability: runner,
    )
    reminder, context = activation_context(tmp_path)

    def invoke() -> None:
        try:
            runtime.run(reminder, context)
        except (AgentRunFailure, RuntimeError) as error:
            errors.append(error)

    threads = [Thread(target=invoke) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    runtime.shutdown()

    assert errors == []
    assert len(loop_ids) == 6
    assert len(set(loop_ids)) == 1
    assert started == 1
    assert closed == 1


def test_model_runtime_closes_retired_runner_on_its_model_loop(
    tmp_path: Path,
) -> None:
    lifecycle: list[tuple[str, str, int]] = []
    runners: list[PydanticAgentRunner] = []

    class RecordingRunner(PydanticAgentRunner):
        def __init__(self, name: str) -> None:
            self.name = name

        async def start(self) -> None:
            lifecycle.append(("start", self.name, id(asyncio.get_running_loop())))

        async def close(self) -> None:
            lifecycle.append(("close", self.name, id(asyncio.get_running_loop())))

        async def run_async(self, _reminder, _context) -> AgentRunOutcome:
            lifecycle.append(("run", self.name, id(asyncio.get_running_loop())))
            return AgentRunOutcome()

    def factory(config, _observability):
        runner = RecordingRunner(config.model if config is not None else "unavailable")
        runners.append(runner)
        return runner

    runtime = ModelRuntime(
        ModelConfig("openai-chat", "https://example.invalid", "test-key", "first"),
        runner_factory=factory,
    )
    reminder, context = activation_context(tmp_path)

    runtime.run(reminder, context)
    runtime.configure(
        "openai-chat",
        "https://example.invalid",
        "test-key",
        "second",
    )
    runtime.run(reminder, context)
    runtime.shutdown()

    assert len(runners) == 2
    assert [item[:2] for item in lifecycle] == [
        ("start", "first"),
        ("run", "first"),
        ("close", "first"),
        ("start", "second"),
        ("run", "second"),
        ("close", "second"),
    ]
    assert len({item[2] for item in lifecycle}) == 1
