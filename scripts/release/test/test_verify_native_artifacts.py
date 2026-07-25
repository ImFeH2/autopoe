import hashlib
import io
import json
import os
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from scripts.release.verify_native_artifacts import (
    ArtifactVerificationError,
    verify_application,
    verify_npm_package,
    verify_python_wheel,
)


TARGET = {
    "id": "linux-x64",
    "rustTarget": "x86_64-unknown-linux-gnu",
    "executableSuffix": "",
    "requiredResources": ["bubblewrap", "ripgrep"],
    "python": {"wheelPlatform": "manylinux_2_17_x86_64"},
    "npm": {
        "name": "flowent",
        "versionTag": "linux-x64",
        "os": "linux",
        "cpu": "x64",
        "libc": "glibc",
    },
}


def add_tar_file(
    archive: tarfile.TarFile,
    path: str,
    contents: bytes,
    mode: int = 0o644,
) -> None:
    info = tarfile.TarInfo(path)
    info.size = len(contents)
    info.mode = mode
    archive.addfile(info, io.BytesIO(contents))


class VerifyNativeArtifactsTest(unittest.TestCase):
    def test_application_failure_includes_process_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Path(directory) / "flowent"
            application.write_text(
                "#!/bin/sh\nprintf 'missing runtime' >&2\nexit 7\n",
                encoding="utf8",
            )
            application.chmod(0o755)

            with self.assertRaisesRegex(
                ArtifactVerificationError,
                "--version failed with exit code 7: missing runtime",
            ):
                verify_application(application, "0.3.10")

    def test_application_npm_package_and_wheel_are_verified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            application = root / "flowent"
            application.write_text(
                """#!/bin/sh
printf '%s\\n' "$1" >> "$FLOWENT_ARTIFACT_TEST_LOG"
case "$1" in
  --version)
    printf 'flowent 0.3.10\\n'
    ;;
  _run-python)
    cat >/dev/null
    printf 'FLOWENT_NATIVE_CODE_READY'
    ;;
  apply-patch)
    shift
    [ "$1" = "--cwd" ] || exit 2
    cat >/dev/null
    printf 'frozen patch ready\\n' > "$2/result.txt"
    ;;
  *)
    exit 2
    ;;
esac
""",
                encoding="utf8",
            )
            application.chmod(0o755)
            npm_dir = root / "npm"
            wheel_dir = root / "python"
            npm_dir.mkdir()
            wheel_dir.mkdir()
            package = {
                "name": "flowent",
                "version": "0.3.10-linux-x64",
                "os": ["linux"],
                "cpu": ["x64"],
                "libc": "glibc",
            }
            resources = {
                "schemaVersion": 1,
                "target": {"id": "linux-x64"},
                "resources": {
                    name: {
                        "path": f"bin/{name}",
                        "size": 0,
                        "sha256": hashlib.sha256(b"").hexdigest(),
                    }
                    for name in TARGET["requiredResources"]
                },
            }
            package_bytes = json.dumps(package).encode()
            with tarfile.open(npm_dir / "flowent.tgz", "w:gz") as archive:
                bundle = "package/vendor/x86_64-unknown-linux-gnu"
                add_tar_file(archive, "package/package.json", package_bytes)
                add_tar_file(
                    archive,
                    f"{bundle}/flowent/flowent",
                    application.read_bytes(),
                    0o755,
                )
                add_tar_file(
                    archive,
                    f"{bundle}/resources.json",
                    json.dumps(resources).encode(),
                )
                for name in TARGET["requiredResources"]:
                    add_tar_file(archive, f"{bundle}/bin/{name}", b"", 0o755)
            wheel = (
                wheel_dir / "flowent_native-0.3.10-py3-none-manylinux_2_17_x86_64.whl"
            )
            with zipfile.ZipFile(wheel, "w") as archive:
                archive.writestr(
                    "flowent_native-0.3.10.dist-info/METADATA",
                    "Name: flowent-native\nVersion: 0.3.10\n",
                )
                archive.writestr(
                    "flowent_native/runtime/resources.json",
                    json.dumps(resources),
                )

            command_log = root / "commands.txt"
            with patch.dict(
                os.environ,
                {"FLOWENT_ARTIFACT_TEST_LOG": str(command_log)},
            ):
                verify_application(application, "0.3.10")
                npm_package = verify_npm_package(npm_dir, TARGET, "0.3.10")
            self.assertEqual(
                command_log.read_text(encoding="utf8").splitlines(),
                [
                    "--version",
                    "_run-python",
                    "apply-patch",
                    "--version",
                    "_run-python",
                    "apply-patch",
                ],
            )
            self.assertEqual(npm_package.name, "flowent.tgz")
            self.assertEqual(
                verify_python_wheel(wheel_dir, TARGET, "0.3.10").name,
                wheel.name,
            )


if __name__ == "__main__":
    unittest.main()
