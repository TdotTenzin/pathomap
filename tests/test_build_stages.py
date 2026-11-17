"""Read-only smoke tests for the four dataset build stages."""

from __future__ import annotations

import hashlib
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import analyze_interactions
import build_effectors_host_proteins
import build_interactions
import build_pathogens

ARTIFACTS = (
    "pathomap-dataset.json",
    "sample-dataset.json",
    "pathomap.db",
    "schema.sql",
    "derived/effector_features.json",
    "derived/interaction_analysis.json",
)


def artifact_hashes() -> dict[str, str]:
    return {
        name: hashlib.sha256((ROOT / "data" / name).read_bytes()).hexdigest()
        for name in ARTIFACTS
        if (ROOT / "data" / name).exists()
    }


class StageSmokeTests(unittest.TestCase):
    def test_all_stages_check_mode_succeed_without_writing(self) -> None:
        before = artifact_hashes()
        self.assertEqual(build_pathogens.build(check=True, no_network=True), 0)
        self.assertEqual(build_effectors_host_proteins.build(check=True, no_network=True), 0)
        self.assertEqual(build_interactions.build(check=True), 0)
        self.assertEqual(analyze_interactions.build(check=True), 0)
        self.assertEqual(artifact_hashes(), before)


if __name__ == "__main__":
    unittest.main()
