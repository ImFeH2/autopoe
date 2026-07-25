import json
import tempfile
import unittest
from pathlib import Path

from scripts.release.check_versions import VersionMismatchError, validate_versions


class CheckVersionsTest(unittest.TestCase):
    def write_repository(self, root: Path, versions: dict[str, str]) -> None:
        (root / "backend").mkdir()
        (root / "native" / "flowent-native").mkdir(parents=True)
        (root / "native" / "flowent-sandbox-windows").mkdir(parents=True)
        (root / "package.json").write_text(
            json.dumps({"version": versions["package"]}),
            encoding="utf8",
        )
        (root / "backend" / "pyproject.toml").write_text(
            "\n".join(
                [
                    "[project]",
                    f'version = "{versions["backend"]}"',
                    f'dependencies = ["flowent-native=={versions["dependency"]}"]',
                ]
            ),
            encoding="utf8",
        )
        for crate in ("flowent-native", "flowent-sandbox-windows"):
            (root / "native" / crate / "Cargo.toml").write_text(
                "\n".join(
                    [
                        "[package]",
                        f'version = "{versions[crate]}"',
                    ]
                ),
                encoding="utf8",
            )

    def test_matching_versions_return_the_release_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_repository(
                root,
                {
                    "package": "0.3.10",
                    "backend": "0.3.10",
                    "dependency": "0.3.10",
                    "flowent-native": "0.3.10",
                    "flowent-sandbox-windows": "0.3.10",
                },
            )

            self.assertEqual(validate_versions(root), "0.3.10")

    def test_mismatched_versions_stop_the_release(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_repository(
                root,
                {
                    "package": "0.3.10",
                    "backend": "0.3.10",
                    "dependency": "0.3.10",
                    "flowent-native": "0.1.0",
                    "flowent-sandbox-windows": "0.3.10",
                },
            )

            with self.assertRaisesRegex(
                VersionMismatchError,
                "native/flowent-native/Cargo.toml",
            ):
                validate_versions(root)


if __name__ == "__main__":
    unittest.main()
