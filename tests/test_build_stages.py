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


class SequenceFeatureTests(unittest.TestCase):
    def test_clean_sequence_matches_browser_normalization(self) -> None:
        self.assertEqual(
            build_effectors_host_proteins.clean_sequence(">x\nMKX 123*"),
            "MKX",
        )

    def test_features_match_browser_known_answers(self) -> None:
        features = build_effectors_host_proteins.calculate_molecular_features(
            "MKTAILVFVKRLREGYDCPHQNA"
        )
        self.assertEqual(
            features,
            {
                "molecular_weight_da": 2690.2,
                "isoelectric_point": 9.37,
                "gravy_score": -0.291,
            },
        )

        features = build_effectors_host_proteins.calculate_molecular_features(
            "MKKLLLFFFVVVAAAKKRRRX"
        )
        self.assertEqual(
            features,
            {
                "molecular_weight_da": 2422.11,
                "isoelectric_point": 12.73,
                "gravy_score": 0.53,
            },
        )

    def test_sequences_without_standard_residues_are_invalid(self) -> None:
        self.assertEqual(
            build_effectors_host_proteins.calculate_molecular_features("XXX"),
            {
                "molecular_weight_da": None,
                "isoelectric_point": None,
                "gravy_score": None,
            },
        )


if __name__ == "__main__":
    unittest.main()
