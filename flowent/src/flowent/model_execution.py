from __future__ import annotations

import asyncio
import random
from collections.abc import AsyncGenerator, Awaitable, Callable, Coroutine
from concurrent.futures import CancelledError
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from threading import Event, Lock, Thread, current_thread
from typing import Any, TypeVar

from httpx import Timeout
from pydantic_ai import RunContext
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models import (
    KnownModelName,
    Model,
    ModelRequestParameters,
    StreamedResponse,
)
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings

from flowent.diagnostics import exception_chain_types, log_event
from flowent.runtime import AgentRunContext, AgentRunFailure

ResultT = TypeVar("ResultT")
Sleep = Callable[[float], Awaitable[None]]
RandomValue = Callable[[], float]
StreamFactory = Callable[
    [RunContext[Any] | None],
    AbstractAsyncContextManager[StreamedResponse],
]


class ModelExecutionLoop:
    def __init__(self) -> None:
        self._started = Event()
        self._stopped = False
        self._lock = Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread = Thread(
            target=self._run,
            name="flowent-model-loop",
            daemon=True,
        )
        self._thread.start()
        self._started.wait()

    @property
    def thread_id(self) -> int | None:
        return self._thread.ident

    def run(self, coroutine: Coroutine[Any, Any, ResultT]) -> ResultT:
        with self._lock:
            if self._stopped or self._loop is None:
                coroutine.close()
                raise RuntimeError("Model execution loop is stopped")
            loop = self._loop
        if current_thread() is self._thread:
            coroutine.close()
            raise RuntimeError("Model execution loop cannot block itself")
        future = asyncio.run_coroutine_threadsafe(coroutine, loop)
        try:
            return future.result()
        except CancelledError as error:
            raise AgentRunFailure("Agent runtime stopped") from error

    def cancel_pending(self) -> None:
        with self._lock:
            if self._stopped or self._loop is None:
                return
        self.run(self._cancel_pending())

    def shutdown(self) -> None:
        with self._lock:
            if self._stopped:
                return
            self._stopped = True
            loop = self._loop
        if loop is not None:
            loop.call_soon_threadsafe(loop.stop)
        self._thread.join(timeout=5)
        log_event("model.loop.stopped", thread_stopped=not self._thread.is_alive())

    async def _cancel_pending(self) -> None:
        current = asyncio.current_task()
        pending = [
            task
            for task in asyncio.all_tasks()
            if task is not current and not task.done()
        ]
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        with self._lock:
            self._loop = loop
        self._started.set()
        log_event("model.loop.started", thread_id=current_thread().ident)
        try:
            loop.run_forever()
        finally:
            pending = [task for task in asyncio.all_tasks(loop) if not task.done()]
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()


class ModelRequestLimiter:
    def __init__(self, max_concurrency: int = 3) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be positive")
        self.max_concurrency = max_concurrency
        self._semaphore: asyncio.Semaphore | None = None
        self._active_requests = 0

    @asynccontextmanager
    async def slot(self) -> AsyncGenerator[int]:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrency)
        await self._semaphore.acquire()
        self._active_requests += 1
        try:
            yield self._active_requests
        finally:
            self._active_requests -= 1
            self._semaphore.release()


@dataclass(init=False)
class ModelRequestPolicy(AbstractCapability[AgentRunContext]):
    def __init__(
        self,
        api_type: str,
        *,
        max_concurrency: int = 3,
        max_retries: int = 1,
        sleep: Sleep = asyncio.sleep,
        random_value: RandomValue = random.random,
        limiter: ModelRequestLimiter | None = None,
    ) -> None:
        if max_retries < 0:
            raise ValueError("max_retries must not be negative")
        self.api_type = api_type
        self.max_retries = max_retries
        self._sleep = sleep
        self._random_value = random_value
        self._limiter = limiter or ModelRequestLimiter(max_concurrency)
        self.max_concurrency = self._limiter.max_concurrency

    def get_model_settings(self) -> ModelSettings:
        timeout: int | float | Timeout
        if self.api_type == "google":
            timeout = 120
        else:
            timeout = Timeout(120, connect=5, write=30, pool=30)
        return {"timeout": timeout}

    @asynccontextmanager
    async def request_stream(
        self,
        factory: StreamFactory,
        run_context: RunContext[Any] | None,
    ) -> AsyncGenerator[StreamedResponse]:
        attempt = 1
        while True:
            started = asyncio.get_running_loop().time()
            yielded = False
            active_requests = 0
            try:
                async with (
                    self._limiter.slot() as active_requests,
                    factory(run_context) as response_stream,
                ):
                    yielded = True
                    yield response_stream
                if attempt > 1:
                    self._log_attempt(
                        "model.request.retry.recovered",
                        run_context,
                        attempt,
                        active_requests,
                        started,
                    )
                return
            except Exception as error:
                retryable, retry_after, reason = _retry_decision(error)
                if yielded or not retryable or attempt > self.max_retries:
                    self._log_attempt(
                        "model.request.retry.skipped"
                        if not retryable or yielded
                        else "model.request.retry.exhausted",
                        run_context,
                        attempt,
                        active_requests,
                        started,
                        error=error,
                        retry_reason=reason,
                        stream_opened=yielded,
                    )
                    raise
                delay = (
                    min(retry_after, 30.0)
                    if retry_after is not None
                    else 1.0 + self._random_value()
                )
                self._log_attempt(
                    "model.request.retry.scheduled",
                    run_context,
                    attempt,
                    active_requests,
                    started,
                    error=error,
                    retry_reason=reason,
                    delay_ms=round(delay * 1000),
                    stream_opened=False,
                )
                await self._sleep(delay)
                attempt += 1

    def _log_attempt(
        self,
        event: str,
        run_context: RunContext[Any] | None,
        attempt: int,
        active_requests: int,
        started: float,
        *,
        error: Exception | None = None,
        **fields: Any,
    ) -> None:
        deps = run_context.deps if run_context is not None else None
        log_event(
            event,
            agent_id=deps.agent_id if isinstance(deps, AgentRunContext) else None,
            turn_id=deps.run_id if isinstance(deps, AgentRunContext) else None,
            model_step=run_context.run_step if run_context is not None else None,
            attempt=attempt,
            max_attempts=self.max_retries + 1,
            root_error_type=(
                exception_chain_types(error)[-1] if error is not None else None
            ),
            active_model_requests=active_requests,
            elapsed_ms=round((asyncio.get_running_loop().time() - started) * 1000),
            **fields,
        )


class RetryingModel(WrapperModel):
    def __init__(
        self,
        wrapped: Model | KnownModelName,
        policy: ModelRequestPolicy,
    ) -> None:
        super().__init__(wrapped)
        self.policy = policy

    @asynccontextmanager
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        run_context: RunContext[Any] | None = None,
    ) -> AsyncGenerator[StreamedResponse]:
        def factory(
            current_context: RunContext[Any] | None,
        ) -> AbstractAsyncContextManager[StreamedResponse]:
            return self.wrapped.request_stream(
                messages,
                model_settings,
                model_request_parameters,
                current_context,
            )

        async with self.policy.request_stream(factory, run_context) as response_stream:
            yield response_stream


def _retry_decision(error: Exception) -> tuple[bool, float | None, str]:
    if isinstance(error, ModelHTTPError):
        status_code = error.status_code
        retryable = status_code in (408, 409, 429) or status_code >= 500
        return (
            retryable,
            error.retry_after if retryable else None,
            f"http_{status_code}",
        )
    if isinstance(error, ModelAPIError):
        root_error_type = exception_chain_types(error)[-1]
        return True, None, root_error_type
    return False, None, type(error).__name__
