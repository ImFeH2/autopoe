from __future__ import annotations

from base64 import b64encode
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlparse

from opentelemetry.context import Context
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, Span, SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter
from pydantic_ai import InstrumentationSettings
from pydantic_ai.capabilities import Instrumentation

from flowent.domain import Reminder


@dataclass(frozen=True)
class ObservabilityConfig:
    enabled: bool
    base_url: str
    public_key: str
    secret_key: str = field(repr=False)
    environment: str = "development"
    capture_content: bool = False

    @classmethod
    def restore(cls, values: dict[str, Any]) -> ObservabilityConfig:
        config = cls(
            enabled=values["enabled"],
            base_url=values["base_url"],
            public_key=values["public_key"],
            secret_key=values["secret_key"],
            environment=values["environment"],
            capture_content=values["capture_content"],
        )
        config.validate()
        return config

    def validate(self) -> None:
        if type(self.enabled) is not bool or type(self.capture_content) is not bool:
            raise RuntimeError("Persisted observability configuration is invalid")
        if not self.enabled:
            return
        parsed_url = urlparse(self.base_url)
        if parsed_url.scheme not in ("http", "https") or not parsed_url.netloc:
            raise ValueError("base_url must be an HTTP or HTTPS URL")
        if not self.public_key:
            raise ValueError("public_key must not be empty")
        if not self.secret_key:
            raise ValueError("secret_key must not be empty")
        if not self.environment:
            raise ValueError("environment must not be empty")

    def persistence_data(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "base_url": self.base_url,
            "public_key": self.public_key,
            "secret_key": self.secret_key,
            "environment": self.environment,
            "capture_content": self.capture_content,
        }


@dataclass(frozen=True)
class ReminderTrace:
    agent_id: int
    discussion_ids: str
    message_count: int
    session_id: str | None

    @classmethod
    def create(cls, reminder: Reminder) -> ReminderTrace:
        discussion_ids = sorted({item.discussion_id for item in reminder.mentions})
        return cls(
            agent_id=reminder.agent_id,
            discussion_ids=",".join(str(item) for item in discussion_ids),
            message_count=len(reminder.mentions),
            session_id=f"flowent-agent-{reminder.agent_id}",
        )

    def run_metadata(self) -> dict[str, str | int]:
        return {
            "flowent.agent.id": self.agent_id,
            "flowent.discussion.ids": self.discussion_ids,
            "flowent.message.count": self.message_count,
        }


_active_trace: ContextVar[ReminderTrace | None] = ContextVar(
    "flowent_active_trace",
    default=None,
)


class LangfuseSpanProcessor(SpanProcessor):
    def on_start(
        self,
        span: Span,
        parent_context: Context | None = None,
    ) -> None:
        del parent_context
        trace = _active_trace.get()
        if trace is None or span.instrumentation_scope.name != "pydantic-ai":
            return
        span.set_attribute("langfuse.trace.name", "Agent turn")
        span.set_attribute("langfuse.trace.tags", ["flowent", "agent"])
        span.set_attribute("langfuse.trace.metadata.agent_id", trace.agent_id)
        span.set_attribute(
            "langfuse.trace.metadata.discussion_ids",
            trace.discussion_ids,
        )
        span.set_attribute(
            "langfuse.trace.metadata.message_count",
            trace.message_count,
        )
        if trace.session_id is not None:
            span.set_attribute("langfuse.session.id", trace.session_id)

    def on_end(self, span: ReadableSpan) -> None:
        del span

    def shutdown(self) -> None:
        return None


class TraceProvider(Protocol):
    def shutdown(self) -> None: ...


@dataclass(frozen=True)
class PydanticAIRunObservability:
    trace: ReminderTrace

    @contextmanager
    def activate(self) -> Iterator[None]:
        token = _active_trace.set(self.trace)
        try:
            yield
        finally:
            _active_trace.reset(token)

    def metadata(self) -> dict[str, str | int]:
        return self.trace.run_metadata()


@dataclass(frozen=True)
class PydanticAIObservability:
    _provider: TraceProvider = field(repr=False)
    _instrumentation: InstrumentationSettings = field(repr=False)

    def capability(self) -> Instrumentation:
        return Instrumentation(settings=self._instrumentation)

    def bind(self, reminder: Reminder) -> PydanticAIRunObservability:
        return PydanticAIRunObservability(ReminderTrace.create(reminder))

    def shutdown(self) -> None:
        self._provider.shutdown()


def create_pydantic_ai_observability(
    config: ObservabilityConfig,
    span_exporter: SpanExporter | None = None,
) -> PydanticAIObservability:
    config.validate()
    tracer_provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": "flowent",
                "deployment.environment.name": config.environment,
            }
        )
    )
    tracer_provider.add_span_processor(LangfuseSpanProcessor())
    if span_exporter is None:
        credentials = b64encode(
            f"{config.public_key}:{config.secret_key}".encode()
        ).decode()
        span_exporter = OTLPSpanExporter(
            endpoint=(f"{config.base_url.rstrip('/')}/api/public/otel/v1/traces"),
            headers={
                "Authorization": f"Basic {credentials}",
                "x-langfuse-ingestion-version": "4",
            },
        )
    tracer_provider.add_span_processor(
        BatchSpanProcessor(span_exporter, schedule_delay_millis=500)
    )
    instrumentation = InstrumentationSettings(
        tracer_provider=tracer_provider,
        include_content=config.capture_content,
        include_binary_content=False,
        include_model_request_parameters=False,
    )
    return PydanticAIObservability(tracer_provider, instrumentation)
