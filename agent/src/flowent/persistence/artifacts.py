import asyncio
import hashlib
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from flowent.persistence.database import Database, utc_now


class ArtifactRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    workflow_run_id: str | None = None
    agent_run_id: str | None = None
    kind: str
    name: str
    mime_type: str
    storage_path: str
    content_hash: str
    size: int
    metadata: dict[str, Any]
    created_at: str


class ArtifactStore:
    def __init__(self, data_dir: Path, database: Database) -> None:
        self.data_dir = data_dir
        self.root = data_dir / "artifacts"
        self.database = database

    async def write_bytes(
        self,
        content: bytes,
        kind: str,
        name: str,
        mime_type: str = "application/octet-stream",
        workflow_run_id: str | None = None,
        agent_run_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ArtifactRecord:
        digest = hashlib.sha256(content).hexdigest()
        path = self.root / digest[:2] / digest
        await asyncio.to_thread(self._write_atomic, path, content)

        record = ArtifactRecord(
            id=uuid4().hex,
            workflow_run_id=workflow_run_id,
            agent_run_id=agent_run_id,
            kind=kind,
            name=name,
            mime_type=mime_type,
            storage_path=str(path.relative_to(self.data_dir)),
            content_hash=digest,
            size=len(content),
            metadata=metadata or {},
            created_at=utc_now(),
        )
        async with self.database.write_lock:
            await self.database.connection.execute(
                "INSERT INTO artifacts(id, workflow_run_id, agent_run_id, kind, name, mime_type, storage_path, content_hash, size, metadata_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    record.id,
                    record.workflow_run_id,
                    record.agent_run_id,
                    record.kind,
                    record.name,
                    record.mime_type,
                    record.storage_path,
                    record.content_hash,
                    record.size,
                    json.dumps(
                        record.metadata, separators=(",", ":"), ensure_ascii=False
                    ),
                    record.created_at,
                ),
            )
            await self.database.connection.commit()
        return record

    async def write_json(
        self,
        value: Any,
        kind: str,
        name: str,
        workflow_run_id: str | None = None,
        agent_run_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ArtifactRecord:
        content = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return await self.write_bytes(
            content,
            kind,
            name,
            "application/json",
            workflow_run_id,
            agent_run_id,
            metadata,
        )

    async def read_bytes(self, artifact: ArtifactRecord) -> bytes:
        path = (self.data_dir / artifact.storage_path).resolve()
        root = self.root.resolve()
        if not path.is_relative_to(root):
            raise ValueError("Artifact path is outside the artifact store")
        return await asyncio.to_thread(path.read_bytes)

    @staticmethod
    def _write_atomic(path: Path, content: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            return
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        temporary.write_bytes(content)
        os.replace(temporary, path)
