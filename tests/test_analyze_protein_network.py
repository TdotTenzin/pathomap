"""Known-answer tests for protein network analysis."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from analyze_protein_network import (
    analyze,
    brandes_betweenness,
    greedy_modularity_communities,
    undirected_components,
)
from identifiers import entity_id


def dataset() -> dict:
    return {
        "meta": {"schema_version": "3.0", "built_at": "2026-01-01T00:00:00Z"},
        "host_proteins": [
            {
                "entity_id": entity_id("host_protein", index),
                "host_protein_id": index,
                "protein_name": f"Protein {index}",
                "gene_name": f"G{index}",
                "uniprot_id": f"U{index}",
                "interacting_partners": [],
            }
            for index in range(1, 4)
        ],
        "effectors": [
            {
                "entity_id": entity_id("effector", 1),
                "effector_name": "Effector",
                "pathogen_id": 1,
            }
        ],
        "interactions": [
            {
                "interaction_id": entity_id("interaction", 1),
                "effector_id": entity_id("effector", 1),
                "host_protein_id": entity_id("host_protein", 2),
                "interaction_type": "effector_targets_host_protein",
                "mechanism": "Binds",
                "provenance": "fixture",
            }
        ],
        "interaction_evidence": [
            {
                "evidence_id": entity_id("interaction_evidence", 1),
                "interaction_id": entity_id("interaction", 1),
                "evidence_class": "experimental",
            }
        ],
    }


class ProteinNetworkTests(unittest.TestCase):
    def test_path_betweenness(self):
        adjacency = {"A": {"B"}, "B": {"A", "C"}, "C": {"B"}}
        values = brandes_betweenness(["A", "B", "C"], adjacency)
        self.assertEqual(values["B"], 1.0)
        self.assertEqual(values["A"], 0.0)

    def test_components(self):
        adjacency = {"A": {"B"}, "B": {"A"}, "C": set()}
        components = undirected_components(["A", "B", "C"], adjacency)
        self.assertEqual(components["A"], components["B"])
        self.assertNotEqual(components["A"], components["C"])

    def test_communities_two_cliques(self):
        weighted = {
            "A": {"B": 1.0},
            "B": {"A": 1.0},
            "C": {"D": 1.0},
            "D": {"C": 1.0},
        }
        communities = greedy_modularity_communities(["A", "B", "C", "D"], weighted)
        self.assertEqual(communities["A"], communities["B"])
        self.assertEqual(communities["C"], communities["D"])
        self.assertNotEqual(communities["A"], communities["C"])

    @patch("analyze_protein_network.fetch_string_network_for_ids")
    @patch("analyze_protein_network.resolve_string_id")
    def test_analyze_with_string_edges(self, resolve, fetch):
        resolve.side_effect = lambda uniprot, *_: f"9606.{uniprot}"
        fetch.return_value = [
            {
                "stringId_A": "9606.U1",
                "stringId_B": "9606.U2",
                "preferredName_A": "G1",
                "preferredName_B": "G2",
                "score": 0.9,
            },
            {
                "stringId_A": "9606.U2",
                "stringId_B": "9606.U3",
                "preferredName_A": "G2",
                "preferredName_B": "G3",
                "score": 0.8,
            },
        ]
        result = analyze(dataset(), b"{}", dataset_path=Path("fixture.json"))
        self.assertEqual(
            fetch.call_args.args[0],
            ["9606.U1", "9606.U2", "9606.U3"],
        )
        self.assertEqual(result["statistics"]["host_host_edge_count"], 2)
        self.assertEqual(result["statistics"]["effector_host_edge_count"], 1)
        nodes = {row["id"]: row for row in result["nodes"]}
        self.assertEqual(nodes[entity_id("host_protein", 2)]["degree"], 2)
        self.assertEqual(nodes[entity_id("host_protein", 2)]["effector_target_degree"], 1)
        self.assertEqual(result["status"], "low_power")

    @patch("analyze_protein_network.fetch_string_network_for_ids")
    @patch("analyze_protein_network.resolve_string_id")
    def test_missing_string_is_insufficient(self, resolve, fetch):
        resolve.return_value = None
        fetch.return_value = []
        result = analyze(dataset(), b"{}", dataset_path=Path("fixture.json"))
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["statistics"]["host_host_edge_count"], 0)


if __name__ == "__main__":
    unittest.main()
