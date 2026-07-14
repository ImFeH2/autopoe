import ast
from pathlib import Path

SOURCE_ROOT = Path(__file__).parents[1] / "src" / "flowent"


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
    return modules


def test_workflow_modules_depend_on_protocols_and_pure_rules() -> None:
    forbidden_imports = {
        "agent_runtime.py": {"flowent.workflow_service"},
        "workflow_tools.py": {"flowent.workflow_service"},
        "workflows.py": {
            "flowent.agent_runtime",
            "flowent.workflow_scheduler",
        },
    }

    for filename, forbidden in forbidden_imports.items():
        imports = imported_modules(SOURCE_ROOT / filename)
        assert imports.isdisjoint(forbidden), f"{filename}: {imports & forbidden}"


def test_workspace_core_does_not_depend_on_fastapi() -> None:
    for path in (
        SOURCE_ROOT / "provider_connections.py",
        SOURCE_ROOT / "workspace" / "context.py",
        SOURCE_ROOT / "workspace" / "runtime.py",
    ):
        assert "fastapi" not in imported_modules(path), path
