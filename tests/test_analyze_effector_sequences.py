"""Known-answer tests for effector sequence and domain analysis."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from analyze_effector_sequences import (
    aliphatic_index,
    analyze,
    composition,
    domain_coverage,
    entropy,
    motif_hits,
)
from identifiers import entity_id

SEQUENCE = "ACDEFGHIKLMNPQRSTVWY"


def dataset() -> dict:
    return {
        "meta": {"schema_version": "3.0", "built_at": "2026-01-01T00:00:00Z"},
        "pathogens": [
            {"pathogen_id": 1, "entity_id": entity_id("pathogen", 1), "name": "Pathogen One"},
        ],
        "effectors": [
            {
                "entity_id": entity_id("effector", 1),
                "pathogen_id": 1,
                "effector_name": "Effector A",
                "type_class": "toxin",
                "sequence": SEQUENCE,
                "domains": [{"name": "Domain A", "accession": "PF00001", "start": 1, "end": 10}],
                "go_terms": [],
                "signal_peptide": None,
                "transmembrane_regions": [],
            },
            {
                "entity_id": entity_id("effector", 2),
                "pathogen_id": 1,
                "effector_name": "Effector B",
                "type_class": "enzyme",
                "sequence": None,
                "domains": [],
                "go_terms": [],
                "signal_peptide": None,
                "transmembrane_regions": [],
            },
        ],
    }


class EffectorSequenceTests(unittest.TestCase):
    def test_composition(self):
        values = composition(SEQUENCE)
        self.assertEqual(len(values), 20)
        self.assertAlmostEqual(sum(values.values()), 1.0)
        self.assertAlmostEqual(values["A"], 0.05)

    def test_entropy(self):
        self.assertAlmostEqual(entropy(SEQUENCE), math.log2(20), places=4)

    def test_aliphatic_index(self):
        self.assertAlmostEqual(aliphatic_index(SEQUENCE), 58.5, places=3)

    def test_motif_hits(self):
        hits = motif_hits("MRALRTPEXELRILDEQ")
        names = {item["name"] for item in hits}
        self.assertIn("RxLR", names)
        self.assertIn("PEXEL", names)

    def test_domain_coverage_merges_intervals(self):
        domains = [
            {"start": 1, "end": 5},
            {"start": 4, "end": 10},
            {"start": 12, "end": 13},
        ]
        self.assertAlmostEqual(domain_coverage(domains, 20), 0.6)

    def test_analyze(self):
        data = dataset()
        result = analyze(data, b"{}", dataset_path=Path("fixture.json"))
        self.assertEqual(result["statistics"]["effector_count"], 2)
        self.assertEqual(result["statistics"]["sequenced_count"], 1)
        self.assertEqual(result["statistics"]["missing_sequence_count"], 1)
        self.assertEqual(result["statistics"]["domain_family_count"], 1)
        self.assertEqual(result["features"][0]["domain_coverage"], 0.5)
        self.assertTrue(result["status"] == "complete")


if __name__ == "__main__":
    unittest.main()
