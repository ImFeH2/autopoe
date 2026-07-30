from dataclasses import dataclass
from pathlib import Path

from flowent.persistence.approvals import ApprovalStore
from flowent.persistence.artifacts import ArtifactStore
from flowent.persistence.database import Database, RecoveryResult
from flowent.persistence.events import EventStore
from flowent.persistence.runs import AgentRunStore
from flowent.persistence.settings import CredentialStore, SettingsStore
from flowent.persistence.workflows import WorkflowStore


@dataclass
class RuntimeServices:
    data_dir: Path
    database: Database
    events: EventStore
    artifacts: ArtifactStore
    approvals: ApprovalStore
    runs: AgentRunStore
    settings: SettingsStore
    credentials: CredentialStore
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
            approvals=ApprovalStore(database),
            runs=AgentRunStore(database),
            settings=SettingsStore(database),
            credentials=CredentialStore(),
            workflows=WorkflowStore(database),
            recovery=recovery,
        )

    async def close(self) -> None:
        await self.database.close()
