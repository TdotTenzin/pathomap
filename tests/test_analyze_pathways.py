"""Tests for Reactome/KEGG pathway analysis."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from analyze_pathways import analyze, enrich_database
from identifiers import entity_id


def dataset() -> dict:
    host_proteins = []
    for index in range(1, 7):
        pathways = [{"database": "Reactome", "id": "R-HSA-1", "name": "Pathway One"}]
        if index <= 2:
            pathways.append({"database": "Reactome", "id": "R-HSA-2", "name": "Pathway Two"})
        host_proteins.append({
            "entity_id": entity_id("host_protein", index),
            "protein_name": f"Protein {index}",
            "pathways_detailed": pathways,
        })
    interactions = [
        {
            "interaction_id": entity_id("interaction", index),
            "effector_id": entity_id("effector", index),
            "host_protein_id": entity_id("host_protein", index),
        }
        for index in range(1, 3)
    ]
    return {
        "meta": {"schema_version": "3.0", "built_at": "2026-01-01T00:00:00Z"},
        "host_proteins": host_proteins,
        "interactions": interactions,
    }


class PathwayTests(unittest.TestCase):
    def test_enrich_database_known_answer(self):
        result = enrich_database(
            database="Reactome",
            proteins_by_pathway={"R-HSA-2": {entity_id("host_protein", 1), entity_id("host_protein", 2)}},
            names={"R-HSA-2": "Pathway Two"},
            foreground_ids={entity_id("host_protein", index) for index in range(1, 3)},
            background_ids={entity_id("host_protein", index) for index in range(1, 7)},
        )
        row = result["pathways"][0]
        self.assertEqual(row["input_count"], 2)
        self.assertEqual(row["background_count"], 2)
        self.assertAlmostEqual(row["p_value"], 1 / 15, places=5)

    def test_reactome_analysis(self):
        result = analyze(dataset(), b"{}", dataset_path=Path("fixture.json"))
        self.assertEqual(result["statistics"]["reactome_pathway_count"], 2)
        self.assertEqual(result["statistics"]["pathway_count"], 2)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["statistics"]["kegg_gene_id_count"], 0)

    @patch("analyze_pathways.fetch_kegg_pathway_names")
    @patch("analyze_pathways.fetch_kegg_gene_pathways")
    def test_kegg_mapping(self, gene_pathways, pathway_names):
        pathway_names.return_value = {"hsa04144": "Endocytosis"}
        gene_pathways.return_value = [{"gene_id": "hsa:1", "pathway_id": "hsa04144"}]
        data = dataset()
        for row in data["host_proteins"]:
            row["pathways_detailed"] = [{"database": "KEGG", "id": "hsa:1", "name": ""}]
        result = analyze(data, b"{}", dataset_path=Path("fixture.json"))
        self.assertEqual(result["statistics"]["kegg_pathway_count"], 1)
        self.assertEqual(result["statistics"]["kegg_resolved_gene_count"], 1)
        self.assertEqual(result["pathways"][0]["pathway_name"], "Endocytosis")

    @patch("analyze_pathways.fetch_kegg_pathway_names")
    @patch("analyze_pathways.fetch_kegg_gene_pathways")
    def test_non_human_kegg_gene_is_excluded(self, gene_pathways, pathway_names):
        pathway_names.return_value = {}
        data = dataset()
        for row in data["host_proteins"]:
            row["pathways_detailed"] = [{"database": "KEGG", "id": "mmu:1", "name": ""}]
        result = analyze(data, b"{}", dataset_path=Path("fixture.json"))
        gene_pathways.assert_not_called()
        self.assertEqual(result["statistics"]["kegg_pathway_count"], 0)
        self.assertEqual(result["statistics"]["kegg_unresolved_gene_count"], 1)
        self.assertIn("unsupported KEGG species prefix", result["kegg_mapping"]["unresolved_genes"][0]["reason"])


if __name__ == "__main__":
    unittest.main()
