from __future__ import annotations

from collections.abc import Callable
from typing import Any

from e2e_support.runner import DeterministicRunner
from flowent.__main__ import main
from flowent.model_runner import ModelConfig, ModelRuntime, ObservabilityConfig
from flowent.runtime import AgentRunner


def create_e2e_runtime(
    stored_config: dict[str, str] | None = None,
    stored_observability_config: dict[str, Any] | None = None,
    on_configure: Callable[[dict[str, str]], None] | None = None,
    on_configure_observability: Callable[[dict[str, Any]], None] | None = None,
) -> ModelRuntime:
    config = ModelConfig.restore(stored_config) if stored_config is not None else None
    observability_config = (
        ObservabilityConfig.restore(stored_observability_config)
        if stored_observability_config is not None
        else None
    )

    def create_runner(
        _config: ModelConfig | None, _instrumentation: Any
    ) -> AgentRunner:
        return DeterministicRunner()

    return ModelRuntime(
        config,
        observability_config,
        on_configure=on_configure,
        on_configure_observability=on_configure_observability,
        runner_factory=create_runner,
        observability_session_factory=lambda _config: None,
    )


if __name__ == "__main__":
    main(create_model_runtime=create_e2e_runtime)
