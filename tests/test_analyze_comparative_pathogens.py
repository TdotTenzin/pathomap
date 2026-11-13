"""Known-answer tests for comparative pathogen analysis."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from analyze_comparative_pathogens import analyze, average_linkage, distance_matrix
from identifiers import entity_id


def dataset() -> dict:
    pathogens = [
        {"pathogen_id": 1, "entity_id": entity_id("pathogen", 1), "name": "Pathogen One", "strategy": "escape"},
        {"pathogen_id": 2, "entity_id": entity_id("pathogen", 2), "name": "Pathogen Two", "strategy": "arrest"},
    ]
    effectors = []
    for pathogen_id, domains in ((1, ["PF1", "PF2"]), (2, ["PF2", "PF3"])):
        for index in range(3):
            effectors.append({
                "entity_id": entity_id("effector", pathogen_id * 10 + index),
                "effector_name": f"Shared{index}",
                "pathogen_id": pathogen_id,
                "type_class": "toxin" if index == 0 else "enzyme",
                "domains": [{"accession": domains[index % len(domains)], "name": ""}],
                "go_terms": [],
            })
    host_proteins = [
        {"entity_id": entity_id("host_protein", index), "protein_name": f"Host {index}", "gene_name": f"H{index}"}
        for index in (1, 2)
    ]
    interactions = [
        {
            "interaction_id": entity_id("interaction", 1),
            "effector_id": entity_id("effector", 10),
            "host_protein_id": entity_id("host_protein", 1),
        },
        {
            "interaction_id": entity_id("interaction", 2),
            "effector_id": entity_id("effector", 20),
            "host_protein_id": entity_id("host_protein", 1),
        },
    ]
    return {
        "meta": {"schema_version": "3.0", "built_at": "2026-01-01T00:00:00Z"},
        "pathogens": pathogens,
        "effectors": effectors,
        "host_proteins": host_proteins,
        "interactions": interactions,
    }


class ComparativeTests(unittest.TestCase):
    def test_distance_and_average_linkage(self):
        ids = ["1", "2"]
        matrix = distance_matrix(ids, {"1": {"a", "b"}, "2": {"b", "c"}})
        self.assertAlmostEqual(matrix[0][1], 2 / 3, places=5)
        merges, assignments = average_linkage(ids, matrix)
        self.assertEqual(len(merges), 1)
        self.assertEqual(assignments["1"], assignments["2"])

    def test_analyze(self):
        result = analyze(dataset(), b"{}", dataset_path=Path("fixture.json"))
        self.assertEqual(result["statistics"]["pathogen_count"], 2)
        self.assertEqual(result["statistics"]["eligible_pathogen_count"], 2)
        self.assertEqual(result["statistics"]["shared_host_target_count"], 1)
        domain_pairs = result["similarity"]["domain_families"]["pairs"]
        self.assertAlmostEqual(domain_pairs[0]["similarity"], 1 / 3, places=5)
        self.assertEqual(result["status"], "low_power")


if __name__ == "__main__":
    unittest.main()
