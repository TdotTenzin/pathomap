"""Tests for pipeline orchestration, ordering, and staleness detection."""

from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_all import Stage, run_pipeline, stage_kwargs
from io_utils import read_json, write_json


def make_stage(name: str, output: Path, calls: list[str], code: int = 0, *, write: bool = False) -> Stage:
    def run(**kwargs) -> int:
        calls.append(name)
        if write:
            write_json(output, {"stage": name, "kwargs": sorted(kwargs)})
        return code

    return Stage(name, (output,), run)


class PipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.manifest = self.root / "manifest.json"
        self.calls: list[str] = []

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def stages(self, *, write: bool = True, codes: dict[str, int] | None = None) -> list[Stage]:
        codes = codes or {}
        return [
            make_stage(name, self.root / f"{name}.json", self.calls, codes.get(name, 0), write=write)
            for name in ("pathogens", "effectors", "interactions", "analysis")
        ]

    def test_runs_in_order_and_writes_manifest(self) -> None:
        code = run_pipeline(manifest_path=self.manifest, stages=self.stages())
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, ["pathogens", "effectors", "interactions", "analysis"])
        manifest = read_json(self.manifest)
        self.assertEqual(set(manifest["stages"]), set(self.calls))
        self.assertTrue(manifest["built_at"].endswith("Z"))

    def test_stops_on_first_failure_without_writing_manifest(self) -> None:
        stages = self.stages(codes={"effectors": 1})
        code = run_pipeline(manifest_path=self.manifest, stages=stages)
        self.assertEqual(code, 1)
        self.assertEqual(self.calls, ["pathogens", "effectors"])
        self.assertFalse(self.manifest.exists())

    def test_only_runs_selected_stage(self) -> None:
        code = run_pipeline(manifest_path=self.manifest, stages=self.stages(), only="interactions")
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, ["interactions"])
        self.assertEqual(set(read_json(self.manifest)["stages"]), {"interactions"})

    def test_check_detects_stale_artifacts(self) -> None:
        run_pipeline(manifest_path=self.manifest, stages=self.stages())
        self.calls.clear()
        output = self.root / "effectors.json"
        write_json(output, {"stage": "changed"})

        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = run_pipeline(check=True, manifest_path=self.manifest, stages=self.stages(write=False))
        self.assertEqual(code, 1)
        self.assertIn("stale artifact", stderr.getvalue())
        self.assertIn("effectors", stderr.getvalue())

    def test_check_writes_nothing(self) -> None:
        stages = self.stages(write=True)
        code = run_pipeline(check=True, manifest_path=self.manifest, stages=stages)
        self.assertEqual(code, 0)
        self.assertFalse(self.manifest.exists())
        for stage in stages:
            self.assertFalse(stage.outputs[0].exists())

    def test_failure_restores_previous_artifacts(self) -> None:
        path = self.root / "pathogens.json"
        write_json(path, {"original": True})

        def fail(**kwargs) -> int:
            write_json(path, {"corrupted": True})
            return 1

        stages = [
            Stage("pathogens", (path,), fail),
            make_stage("effectors", self.root / "effectors.json", self.calls),
        ]
        code = run_pipeline(manifest_path=self.manifest, stages=stages)
        self.assertEqual(code, 1)
        self.assertEqual(read_json(path), {"original": True})
        self.assertEqual(self.calls, [])

    def test_exception_is_reported_and_artifacts_restored(self) -> None:
        path = self.root / "pathogens.json"
        write_json(path, {"original": True})

        def explode(**kwargs) -> int:
            write_json(path, {"corrupted": True})
            raise RuntimeError("boom")

        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = run_pipeline(
                manifest_path=self.manifest,
                stages=[Stage("pathogens", (path,), explode)],
            )
        self.assertEqual(code, 1)
        self.assertIn("raised boom", stderr.getvalue())
        self.assertEqual(read_json(path), {"original": True})

    def test_stage_kwargs_are_scoped(self) -> None:
        shared = dict(check=False, refresh=True, no_network=True, enrich_effectors=True, strict=True)
        self.assertNotIn("refresh", stage_kwargs("analysis", **shared))
        self.assertTrue(stage_kwargs("analysis", **shared)["strict"])
        self.assertTrue(stage_kwargs("effectors", **shared)["enrich_effectors"])
        self.assertNotIn("strict", stage_kwargs("pathogens", **shared))


if __name__ == "__main__":
    unittest.main()
