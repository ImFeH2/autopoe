import importlib.util
import json
import os
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "freeze.py"


def load_module():
    spec = importlib.util.spec_from_file_location("flowent_freeze", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FreezeArgumentsTest(unittest.TestCase):
    def test_arguments_include_application_and_staged_runtime_inputs(self):
        freeze = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "runtime"
            input_root.mkdir()
            input_path = input_root / "pyinstaller-input.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 2,
                        "target": "linux-x64",
                        "bundleDirectory": "flowent-runtime",
                        "executableFiles": [
                            {
                                "source": "flowent-runtime/bin/rg",
                                "destination": "flowent-runtime/bin/rg",
                            }
                        ],
                        "data": [
                            {
                                "source": "flowent-runtime/resources.json",
                                "destination": "flowent-runtime",
                            }
                        ],
                    }
                ),
                encoding="utf8",
            )

            with (
                patch.object(freeze.sys, "platform", "linux"),
                patch.object(freeze.platform, "machine", return_value="x86_64"),
            ):
                arguments = freeze.create_arguments(
                    project_root=root,
                    input_path=input_path,
                    output_dir=root / "dist",
                    work_dir=root / "build",
                    spec_dir=root / "spec",
                )

        self.assertEqual(
            arguments[:9],
            [
                "--noconfirm",
                "--clean",
                "--onedir",
                "--noupx",
                "--console",
                "--name",
                "flowent",
                "--contents-directory",
                "_internal",
            ],
        )
        self.assertIn(str(root / "backend" / "src"), arguments)
        self.assertIn("flowent_native", arguments)
        self.assertNotIn(str(input_root / "flowent-runtime" / "bin" / "rg"), arguments)
        self.assertEqual(
            arguments[-1],
            str(root / "scripts" / "package-runtime" / "entrypoint.py"),
        )

    def test_installs_runtime_executables_without_modifying_contents(self):
        freeze = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "runtime"
            source = input_root / "flowent-runtime" / "bin" / "rg"
            source.parent.mkdir(parents=True)
            content = b"\xcf\xfa\xed\xfeexact-runtime-file"
            source.write_bytes(content)
            source.chmod(0o755)
            input_path = input_root / "pyinstaller-input.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 2,
                        "target": "linux-x64",
                        "bundleDirectory": "flowent-runtime",
                        "executableFiles": [
                            {
                                "source": "flowent-runtime/bin/rg",
                                "destination": "flowent-runtime/bin/rg",
                            }
                        ],
                        "data": [],
                    }
                ),
                encoding="utf8",
            )
            output_dir = root / "dist"
            (output_dir / "flowent" / "_internal").mkdir(parents=True)

            freeze.install_runtime_executables(
                input_path=input_path,
                output_dir=output_dir,
            )

            installed = (
                output_dir / "flowent" / "_internal" / "flowent-runtime" / "bin" / "rg"
            )
            self.assertEqual(installed.read_bytes(), content)
            self.assertEqual(
                sha256(installed.read_bytes()).digest(),
                sha256(content).digest(),
            )
            if os.name != "nt":
                self.assertNotEqual(installed.stat().st_mode & 0o111, 0)

    def test_unsupported_runtime_input_is_rejected(self):
        freeze = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_path = root / "pyinstaller-input.json"
            input_path.write_text("{}", encoding="utf8")

            with self.assertRaisesRegex(
                ValueError, "Unsupported PyInstaller runtime input"
            ):
                freeze.create_arguments(
                    project_root=root,
                    input_path=input_path,
                    output_dir=root / "dist",
                    work_dir=root / "build",
                    spec_dir=root / "spec",
                )

    def test_cross_platform_target_is_rejected(self):
        freeze = load_module()

        with (
            patch.object(freeze.sys, "platform", "linux"),
            patch.object(freeze.platform, "machine", return_value="x86_64"),
        ):
            with self.assertRaisesRegex(
                ValueError, "darwin-arm64 must be built on darwin arm64"
            ):
                freeze.validate_target("darwin-arm64")


if __name__ == "__main__":
    unittest.main()
