import importlib.util
import json
import os
import tempfile
import unittest
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
                        "schemaVersion": 1,
                        "target": "linux-x64",
                        "bundleDirectory": "flowent-runtime",
                        "binaries": [
                            {
                                "source": "flowent-runtime/bin/rg",
                                "destination": "flowent-runtime/bin",
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
        self.assertIn(
            f"{input_root / 'flowent-runtime' / 'bin' / 'rg'}{os.pathsep}flowent-runtime/bin",
            arguments,
        )
        self.assertEqual(
            arguments[-1],
            str(root / "scripts" / "package-runtime" / "entrypoint.py"),
        )

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
