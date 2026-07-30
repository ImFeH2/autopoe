from dataclasses import dataclass
from pathlib import Path

from flowent_agent.persistence.artifacts import ArtifactStore
from flowent_agent.persistence.database import Database, RecoveryResult
from flowent_agent.persistence.events import EventStore
from flowent_agent.persistence.runs import AgentRunStore
from flowent_agent.persistence.workflows import WorkflowStore


@dataclass
class RuntimeServices:
    data_dir: Path
    database: Database
    events: EventStore
    artifacts: ArtifactStore
    runs: AgentRunStore
    workflows: WorkflowStore
    recovery: RecoveryResult

    @classmethod
    async def create(cls, data_dir: Path) -> "RuntimeServices":
        database = await Database.open(data_dir)
        recovery = await database.recover_interrupted_runs()
        return cls(
            data_dir=data_dir,
            database=database,
            events=EventStore(database),
            artifacts=ArtifactStore(data_dir, database),
            runs=AgentRunStore(database),
            workflows=WorkflowStore(database),
            recovery=recovery,
        )

    async def close(self) -> None:
        await self.database.close()
