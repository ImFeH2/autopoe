from __future__ import annotations

from collections.abc import Callable

from e2e_support.runner import DeterministicRunner
from flowent.__main__ import main
from flowent.model_runner import ModelConfig, ModelRuntime
from flowent.runtime import AgentRunner


def create_e2e_runtime(
    stored_config: dict[str, str] | None = None,
    on_configure: Callable[[dict[str, str]], None] | None = None,
) -> ModelRuntime:
    config = ModelConfig.restore(stored_config) if stored_config is not None else None

    def create_runner(_config: ModelConfig | None) -> AgentRunner:
        return DeterministicRunner()

    return ModelRuntime(
        config,
        on_configure=on_configure,
        runner_factory=create_runner,
    )


if __name__ == "__main__":
    main(create_model_runtime=create_e2e_runtime)
