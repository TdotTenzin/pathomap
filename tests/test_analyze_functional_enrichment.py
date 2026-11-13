"""Known-answer tests for GO over-representation analysis."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from analyze_functional_enrichment import analyze
from identifiers import entity_id


def dataset() -> dict:
    host_proteins = []
    for index in range(1, 11):
        terms = [{"id": "GO:0000001", "term": "Term One", "aspect": "P"}]
        if index <= 3:
            terms.append({"id": "GO:0000002", "term": "Term Two", "aspect": "P"})
        host_proteins.append({
            "entity_id": entity_id("host_protein", index),
            "protein_name": f"Protein {index}",
            "gene_name": f"G{index}",
            "go_terms": terms,
        })
    interactions = [
        {
            "interaction_id": entity_id("interaction", index),
            "effector_id": entity_id("effector", index),
            "host_protein_id": entity_id("host_protein", index),
        }
        for index in range(1, 4)
    ]
    return {
        "meta": {"schema_version": "3.0", "built_at": "2026-01-01T00:00:00Z"},
        "host_proteins": host_proteins,
        "interactions": interactions,
    }


class FunctionalEnrichmentTests(unittest.TestCase):
    def test_known_enrichment(self):
        result = analyze(dataset(), b"{}", dataset_path=Path("fixture.json"))
        terms = {row["term_id"]: row for row in result["terms"]}
        self.assertEqual(result["statistics"]["foreground_protein_count"], 3)
        self.assertEqual(result["statistics"]["background_protein_count"], 10)
        self.assertAlmostEqual(terms["GO:0000002"]["p_value"], 1 / 120, places=5)
        self.assertEqual(terms["GO:0000002"]["input_count"], 3)
        self.assertEqual(terms["GO:0000002"]["background_count"], 3)
        self.assertTrue(terms["GO:0000002"]["significant"])

    def test_insufficient_foreground(self):
        data = dataset()
        data["interactions"] = data["interactions"][:1]
        result = analyze(data, b"{}", dataset_path=Path("fixture.json"))
        self.assertEqual(result["status"], "insufficient_data")
        self.assertTrue(result["status_reasons"])


if __name__ == "__main__":
    unittest.main()
