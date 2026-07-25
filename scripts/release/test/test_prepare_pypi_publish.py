from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from scripts.release.prepare_pypi_publish import (
    PyPIArtifactError,
    prepare_pypi_publish,
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PreparePyPIPublishTest(unittest.TestCase):
    def test_removes_matching_remote_files_and_keeps_new_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            existing = root / "flowent-0.3.10-py3-none-any.whl"
            pending = root / "flowent_native-0.3.10-py3-none-win_amd64.whl"
            existing.write_bytes(b"existing")
            pending.write_bytes(b"pending")
            remote = {
                "flowent": {existing.name: digest(existing)},
                "flowent-native": {},
            }

            remaining = prepare_pypi_publish(
                root,
                "0.3.10",
                remote_files=lambda project: remote[project],
            )

            self.assertEqual(remaining, (pending,))
            self.assertFalse(existing.exists())
            self.assertTrue(pending.exists())

    def test_rejects_a_remote_file_with_different_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "flowent-0.3.10.tar.gz"
            artifact.write_bytes(b"local")

            with self.assertRaisesRegex(PyPIArtifactError, "SHA256 does not match"):
                prepare_pypi_publish(
                    root,
                    "0.3.10",
                    remote_files=lambda project: {artifact.name: "0" * 64},
                )

            self.assertTrue(artifact.exists())

    def test_keeps_all_local_files_when_any_remote_digest_differs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            matching = root / "flowent-0.3.10-py3-none-any.whl"
            different = root / "flowent-0.3.10.tar.gz"
            matching.write_bytes(b"matching")
            different.write_bytes(b"different")

            with self.assertRaises(PyPIArtifactError):
                prepare_pypi_publish(
                    root,
                    "0.3.10",
                    remote_files=lambda project: {
                        matching.name: digest(matching),
                        different.name: "0" * 64,
                    },
                )

            self.assertTrue(matching.exists())
            self.assertTrue(different.exists())

    def test_rejects_an_unexpected_artifact_name(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "other-0.3.10.whl").write_bytes(b"unexpected")

            with self.assertRaisesRegex(PyPIArtifactError, "Unexpected artifact"):
                prepare_pypi_publish(
                    root,
                    "0.3.10",
                    remote_files=lambda project: {},
                )


if __name__ == "__main__":
    unittest.main()
