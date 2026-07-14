from pathlib import Path

from flowent.state.database import SQLiteDatabase
from flowent.state.models import WorkflowDraft
from flowent.state.store import StateStore
from flowent.state.workflow_repository import WorkflowRepository


def workflow_draft() -> WorkflowDraft:
    return WorkflowDraft.model_validate(
        {
            "id": "workflow-repository",
            "name": "Repository Workflow",
            "spec": {
                "nodes": [
                    {
                        "id": "input",
                        "kind": "input",
                        "config": {"default_value": "hello", "input_type": "text"},
                    },
                    {
                        "id": "output",
                        "kind": "output",
                        "config": {"output_key": "result"},
                    },
                ],
                "connections": [
                    {
                        "id": "input-output",
                        "from": {"node_id": "input", "port": "output"},
                        "to": {"node_id": "output", "port": "input"},
                    }
                ],
            },
            "presentation": {
                "nodes": {
                    "input": {
                        "name": "Input",
                        "description": "",
                        "position": {"x": 0, "y": 0},
                    },
                    "output": {
                        "name": "Output",
                        "description": "",
                        "position": {"x": 260, "y": 0},
                    },
                },
                "connections": {"input-output": {"label": ""}},
            },
        }
    )


def test_state_and_workflow_repositories_share_one_database(tmp_path: Path) -> None:
    database = SQLiteDatabase(tmp_path)
    state_store = StateStore(database=database)
    workflow_repository = WorkflowRepository(database)
    state_store.read_state()

    saved = workflow_repository.save_workflow(
        workflow_draft(),
        base_revision=None,
        executable=True,
    )

    assert state_store.read_state().workflows == [saved]
    active_revision = workflow_repository.read_active_workflow_revision(saved.id)
    assert active_revision is not None
    assert active_revision.revision == 1


def test_state_store_does_not_expose_workflow_persistence() -> None:
    workflow_methods = {
        "delete_workflow",
        "read_active_workflow_revision",
        "read_workflow",
        "read_workflow_agent_history",
        "read_workflow_revision",
        "read_workflow_run",
        "read_workflow_schedule",
        "read_workflow_schedules",
        "read_workflows",
        "save_workflow",
        "save_workflow_agent_history",
        "save_workflow_run",
        "save_workflow_schedule",
    }

    assert workflow_methods.isdisjoint(vars(StateStore))
