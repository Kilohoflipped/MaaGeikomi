import json
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.resources.project_interface import interface_imports, resource_directories

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class ResourceContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.assets = self.root / "assets"
        self.assets.mkdir()
        self.interface = self.assets / "interface.json"

    def manifest(self, paths):
        self.interface.write_text(
            json.dumps(
                {
                    "interface_version": 2,
                    "name": "test",
                    "controller": [],
                    "resource": [{"name": "test", "path": paths}],
                    "task": [],
                }
            ),
            encoding="utf-8",
        )

    def resource(self, name, node):
        pipeline = self.assets / name / "pipeline"
        pipeline.mkdir(parents=True)
        (pipeline / "task.json").write_text(json.dumps(node), encoding="utf-8")

    def fragment(self, text, name="interface_game.json"):
        manifest = json.loads(self.interface.read_text(encoding="utf-8"))
        manifest["import"] = [f"./{name}"]
        self.interface.write_text(json.dumps(manifest), encoding="utf-8")
        fragment = self.assets / name
        fragment.write_text(text, encoding="utf-8")
        return fragment

    def test_packaging_copies_all_declared_roots_and_sets_version(self):
        self.manifest(["./resource", "./resource_game", "./resource"])
        fragment = self.fragment('// 游戏声明\n{"task": [{"name": "Game", "entry": "Start"}]}')
        for name in ("resource", "resource_game"):
            self.resource(name, {"Start": {"recognition": "DirectHit"}})
        with patch.object(sys, "argv", ["install.py", "v-test", "win", "x86_64"]):
            namespace = runpy.run_module("tools.build.install", run_name="test_install")
        install_resource = namespace["install_resource"]
        output = self.root / "install"
        output.mkdir()
        with patch.dict(
            install_resource.__globals__,
            {
                "working_dir": self.root,
                "install_path": output,
                "configure_ocr_model": lambda: None,
            },
        ):
            install_resource()
        for name in ("resource", "resource_game"):
            self.assertTrue((output / name / "pipeline/task.json").is_file())
        manifest = json.loads((output / "interface.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], "v-test")
        self.assertEqual(manifest["import"], ["./interface_game.json"])
        self.assertEqual((output / fragment.name).read_bytes(), fragment.read_bytes())
        self.assertEqual(list(interface_imports(output / "interface.json")), [Path(fragment.name)])
        self.assertEqual(len(resource_directories(self.interface)), 2)

    def test_imports_reject_missing_outside_duplicate_and_unsupported_files(self):
        self.manifest(["./resource"])
        fragment = self.fragment('{"task": []}')
        self.assertEqual(interface_imports(self.interface), {Path(fragment.name): fragment})
        (self.assets / "games").mkdir()
        manifest = json.loads(self.interface.read_text(encoding="utf-8"))
        manifest["import"] = [f"./games/../{fragment.name}"]
        self.interface.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertEqual(
            interface_imports(self.interface), {Path(f"games/../{fragment.name}"): fragment}
        )
        (self.root / "outside.json").write_text('{"task": []}', encoding="utf-8")
        for imports, error in [
            (["missing.json"], FileNotFoundError),
            (["../outside.json"], ValueError),
            ([fragment.name, f"./games/../{fragment.name}"], ValueError),
            ("interface_game.json", ValueError),
        ]:
            with self.subTest(imports=imports):
                manifest = json.loads(self.interface.read_text(encoding="utf-8"))
                manifest["import"] = imports
                self.interface.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises(error):
                    interface_imports(self.interface)
        for text in ['{"import": ["other.json"]}', '{"group": []}']:
            with self.subTest(text=text):
                self.fragment(text)
                with self.assertRaisesRegex(ValueError, "Unsupported PI fragment fields"):
                    interface_imports(self.interface)

    def test_schema_automatically_validates_only_declared_imports(self):
        self.manifest(["./resource"])
        self.resource("resource", {"Start": {"recognition": "DirectHit"}})
        fragment = self.fragment('{"task": [{"name": "Game", "entry": "Start"}]}')
        (self.assets / "interface_unused.json").write_text("invalid json", encoding="utf-8")
        command = [
            sys.executable,
            "-m",
            "tools.check.validate_schema",
            "--schema-dir",
            str(PROJECT_ROOT / "deps/tools"),
            "--interface-files",
            str(self.interface),
        ]
        result = subprocess.run(
            command, cwd=PROJECT_ROOT, capture_output=True, text=True, encoding="utf-8"
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(fragment.name, result.stdout)
        fragment.write_text('{"task": [{"name": "Game", "entry": 123}]}', encoding="utf-8")
        result = subprocess.run(
            command, cwd=PROJECT_ROOT, capture_output=True, text=True, encoding="utf-8"
        )
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(fragment.name, result.stdout)
        self.assertIn("Validation failed", result.stdout)

    def test_missing_import_fails_default_schema_check(self):
        self.manifest(["./resource"])
        fragment = self.fragment('{"task": []}')
        fragment.unlink()
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "tools.check.validate_schema",
                "--schema-dir",
                str(PROJECT_ROOT / "deps/tools"),
                "--interface-files",
                str(self.interface),
            ],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("PI import file not found", result.stdout)

    def test_missing_resource_fails(self):
        self.manifest(["./missing"])
        with self.assertRaises(FileNotFoundError):
            resource_directories(self.interface)

    def test_outside_resource_fails(self):
        for value in ("../outside", str(self.root), "."):
            with self.subTest(path=value):
                self.manifest([value])
                with self.assertRaises(ValueError):
                    resource_directories(self.interface)

    def test_default_schema_check_rejects_invalid_game_pipeline(self):
        self.manifest(["./resource", "./resource_game"])
        self.resource("resource", {"Common": {"recognition": "DirectHit"}})
        self.resource("resource_game", {"Game": {"recognition": "NotARecognition"}})
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "tools.check.validate_schema",
                "--schema-dir",
                str(PROJECT_ROOT / "deps/tools"),
                "--interface-files",
                str(self.interface),
            ],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("resource_game", result.stdout)
        self.assertIn("Validation failed", result.stdout)


if __name__ == "__main__":
    unittest.main()
