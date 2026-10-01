import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools.resources.project_interface import resource_directories

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
        self.interface.write_text(json.dumps({
            "interface_version": 2, "name": "test", "controller": [],
            "resource": [{"name": "test", "path": paths}], "task": [],
        }), encoding="utf-8")

    def resource(self, name, node):
        pipeline = self.assets / name / "pipeline"
        pipeline.mkdir(parents=True)
        (pipeline / "task.json").write_text(json.dumps(node), encoding="utf-8")

    def test_packaging_copies_all_declared_roots_and_sets_version(self):
        self.manifest(["./resource", "./resource_game", "./resource"])
        for name in ("resource", "resource_game"):
            self.resource(name, {"Start": {"recognition": "DirectHit"}})
        with patch.object(sys, "argv", ["install.py", "v-test", "win", "x86_64"]):
            namespace = runpy.run_module("tools.build.install", run_name="test_install")
        install_resource = namespace["install_resource"]
        output = self.root / "install"
        output.mkdir()
        with patch.dict(install_resource.__globals__, {
            "working_dir": self.root, "install_path": output,
            "configure_ocr_model": lambda: None,
        }):
            install_resource()
        for name in ("resource", "resource_game"):
            self.assertTrue((output / name / "pipeline/task.json").is_file())
        manifest = json.loads((output / "interface.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], "v-test")
        self.assertEqual(len(resource_directories(self.interface)), 2)

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
        result = subprocess.run([
            sys.executable, "-m", "tools.check.validate_schema",
            "--schema-dir", str(PROJECT_ROOT / "deps/tools"),
            "--interface-files", str(self.interface),
        ], cwd=PROJECT_ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("resource_game", result.stdout)
        self.assertIn("Validation failed", result.stdout)


if __name__ == "__main__":
    unittest.main()
