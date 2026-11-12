"""Known-answer and validation tests for the interaction analysis engine."""

from __future__ import annotations

import contextlib
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from analyze_interactions import analyze, main
from identifiers import entity_id


def base_dataset() -> dict:
    pathogens = [
        {"pathogen_id": 1, "entity_id": entity_id("pathogen", 1), "name": "Pathogen One", "tax_id": 100},
        {"pathogen_id": 2, "entity_id": entity_id("pathogen", 2), "name": "Pathogen Two", "tax_id": 200},
    ]
    host_proteins = [{
        "host_protein_id": 1,
        "entity_id": entity_id("host_protein", 1),
        "protein_name": "Actin, cytoplasmic 1",
        "gene_name": "ACTB",
        "uniprot_id": "P60709",
    }]
    host_targets = [
        {
            "host_target_id": 1,
            "entity_id": entity_id("host_target", 1),
            "name": "ACTB",
            "host_target_class": "protein",
            "host_protein_id": 1,
            "resolution_status": "resolved_protein",
        },
        {
            "host_target_id": 2,
            "entity_id": entity_id("host_target", 2),
            "name": "Unresolved complex",
            "host_target_class": "protein_complex",
            "host_protein_id": None,
            "resolution_status": "ambiguous",
        },
        {
            "host_target_id": 3,
            "entity_id": entity_id("host_target", 3),
            "name": "Host cells",
            "host_target_class": "cellular_structure",
            "host_protein_id": None,
            "resolution_status": "non_protein",
        },
    ]
    effectors = [
        {"entity_id": entity_id("effector", 1), "effector_name": "SifA", "pathogen_id": 1, "host_target_id": 1},
        {"entity_id": entity_id("effector", 2), "effector_name": "InlA", "pathogen_id": 2, "host_target_id": 1},
        {"entity_id": entity_id("effector", 3), "effector_name": "SopB", "pathogen_id": 2, "host_target_id": 2},
        {"entity_id": entity_id("effector", 4), "effector_name": "OmpA", "pathogen_id": 1, "host_target_id": 3},
    ]
    interactions = [
        {
            "interaction_id": entity_id("interaction", 1),
            "effector_id": entity_id("effector", 1),
            "host_protein_id": entity_id("host_protein", 1),
            "mechanism": "Binds actin",
            "interaction_type": "effector_targets_host_protein",
            "provenance": "fixture",
        },
        {
            "interaction_id": entity_id("interaction", 2),
            "effector_id": entity_id("effector", 2),
            "host_protein_id": entity_id("host_protein", 1),
            "mechanism": "Binds actin",
            "interaction_type": "effector_targets_host_protein",
            "provenance": "fixture",
        },
    ]
    evidence = [
        {
            "evidence_id": entity_id("interaction_evidence", 1),
            "interaction_id": entity_id("interaction", 1),
            "evidence_class": "experimental",
            "doi": "10.1000/example",
            "pmid": None,
            "database_accession": None,
            "provenance": "fixture",
            "note": "Direct binding assay.",
        },
        {
            "evidence_id": entity_id("interaction_evidence", 2),
            "interaction_id": entity_id("interaction", 2),
            "evidence_class": "predicted",
            "doi": None,
            "pmid": "12345678",
            "database_accession": None,
            "provenance": "fixture",
            "note": None,
        },
    ]
    return {
        "meta": {"schema_version": "3.0", "built_at": "2026-01-01T00:00:00Z"},
        "pathogens": pathogens,
        "host_proteins": host_proteins,
        "host_targets": host_targets,
        "effectors": effectors,
        "interactions": interactions,
        "interaction_evidence": evidence,
    }


def analyze_dataset(dataset: dict) -> dict:
    return analyze(dataset, json.dumps(dataset).encode("utf-8"))


def codes(issues: list[dict]) -> set[str]:
    return {item["code"] for item in issues}


def run_cli(argv: list[str]) -> int:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return main(argv)


class InteractionAnalysisTests(unittest.TestCase):
    def test_valid_dataset_statistics_and_network(self):
        result = analyze_dataset(base_dataset())
        stats = result["statistics"]

        self.assertEqual(stats["interaction_count"], 2)
        self.assertEqual(stats["unique_effector_count"], 2)
        self.assertEqual(stats["unique_host_protein_count"], 1)
        self.assertEqual(stats["unique_host_target_count"], 1)
        self.assertEqual(stats["unique_pathogen_count"], 2)
        self.assertEqual(stats["host_proteins_targeted_by_multiple_pathogens_count"], 1)
        self.assertEqual(stats["unresolved_target_count"], 2)
        self.assertEqual(stats["unresolved_effector_count"], 2)
        self.assertEqual(stats["evidence_count"], 2)
        self.assertEqual(stats["interactions_with_evidence_count"], 2)
        self.assertEqual(stats["evidence_coverage"], 1.0)
        self.assertEqual(stats["evidence_by_class"], {"experimental": 1, "predicted": 1})
        self.assertEqual(result["validation"]["result_issues"], [])

        host = result["host_proteins_targeted_by_multiple_pathogens"][0]
        self.assertEqual(host["host_protein_id"], entity_id("host_protein", 1))
        self.assertEqual(host["pathogen_count"], 2)
        self.assertEqual(host["interaction_count"], 2)
        self.assertEqual(len(host["effector_ids"]), 2)

        self.assertEqual(len(result["network"]["nodes"]), 5)
        self.assertEqual(len(result["network"]["edges"]), 2)
        edge = result["network"]["edges"][0]
        self.assertEqual(edge["id"], entity_id("interaction", 1))
        self.assertEqual(edge["strongest_evidence_class"], "experimental")
        self.assertEqual(edge["evidence_records"][0]["doi"], "10.1000/example")

        unresolved = result["unresolved_targets"]
        self.assertEqual(unresolved["target_count"], 2)
        self.assertEqual(unresolved["effector_count"], 2)
        self.assertEqual(unresolved["by_resolution_status"]["ambiguous"]["effector_count"], 1)
        self.assertEqual(unresolved["by_resolution_status"]["non_protein"]["effector_count"], 1)

    def test_invalid_and_duplicate_interactions(self):
        dataset = base_dataset()
        dataset["interactions"].extend([
            {
                "interaction_id": "INT-1",
                "effector_id": entity_id("effector", 1),
                "host_protein_id": entity_id("host_protein", 1),
            },
            {
                "interaction_id": entity_id("interaction", 1),
                "effector_id": entity_id("effector", 1),
                "host_protein_id": entity_id("host_protein", 1),
            },
            {
                "interaction_id": entity_id("interaction", 3),
                "effector_id": entity_id("effector", 2),
                "host_protein_id": entity_id("host_protein", 1),
                "mechanism": "Conflicting mechanism",
                "interaction_type": "effector_targets_host_protein",
                "provenance": "fixture",
            },
            {
                "interaction_id": entity_id("interaction", 4),
                "effector_id": entity_id("effector", 99),
                "host_protein_id": entity_id("host_protein", 1),
                "interaction_type": "effector_targets_host_protein",
                "provenance": "fixture",
            },
            {
                "interaction_id": entity_id("interaction", 5),
                "effector_id": "EFF-1",
                "host_protein_id": entity_id("host_protein", 1),
            },
        ])

        result = analyze_dataset(dataset)
        found = codes(result["validation"]["interaction_issues"])

        self.assertIn("invalid_interaction_id", found)
        self.assertIn("duplicate_interaction_id", found)
        self.assertIn("duplicate_relationship", found)
        self.assertIn("conflicting_relationship", found)
        self.assertIn("broken_relationship", found)
        self.assertIn("invalid_effector_id", found)
        self.assertEqual(result["statistics"]["interaction_count"], 2)

    def test_evidence_validation_and_deduplication(self):
        dataset = base_dataset()
        dataset["interaction_evidence"].extend([
            {
                "evidence_id": entity_id("interaction_evidence", 1),
                "interaction_id": entity_id("interaction", 1),
                "evidence_class": "experimental",
                "provenance": "fixture",
            },
            {
                "evidence_id": entity_id("interaction_evidence", 3),
                "interaction_id": entity_id("interaction", 99),
                "evidence_class": "predicted",
                "provenance": "fixture",
            },
            {
                "evidence_id": entity_id("interaction_evidence", 4),
                "interaction_id": entity_id("interaction", 1),
                "evidence_class": "unknown",
                "provenance": "fixture",
            },
            {
                "evidence_id": entity_id("interaction_evidence", 5),
                "interaction_id": entity_id("interaction", 1),
                "evidence_class": "predicted",
                "provenance": "",
            },
            {
                "evidence_id": entity_id("interaction_evidence", 6),
                "interaction_id": entity_id("interaction", 1),
                "evidence_class": "experimental",
                "doi": "10.1000/example",
                "pmid": None,
                "database_accession": None,
                "provenance": "fixture",
            },
        ])

        result = analyze_dataset(dataset)
        found = codes(result["validation"]["evidence_issues"])

        self.assertIn("duplicate_evidence_id", found)
        self.assertIn("orphan_evidence", found)
        self.assertIn("invalid_evidence_class", found)
        self.assertIn("missing_evidence_provenance", found)
        self.assertIn("duplicate_evidence", found)
        self.assertEqual(result["statistics"]["evidence_count"], 2)

    def test_interaction_without_evidence_warns_but_is_retained(self):
        dataset = base_dataset()
        dataset["interaction_evidence"] = [dataset["interaction_evidence"][0]]

        result = analyze_dataset(dataset)
        found = codes(result["validation"]["evidence_issues"])

        self.assertIn("interaction_without_evidence", found)
        self.assertEqual(result["statistics"]["interaction_count"], 2)
        self.assertEqual(result["statistics"]["interactions_without_evidence_count"], 1)

    def test_missing_required_table_is_reported(self):
        dataset = base_dataset()
        dataset.pop("host_targets")

        result = analyze_dataset(dataset)
        found = codes(result["validation"]["interaction_issues"])

        self.assertIn("missing_table", found)
        self.assertEqual(result["validation"]["interaction_issues"][0]["detail"], "Required table 'host_targets' is missing.")

    def test_cli_check_strict_and_output(self):
        dataset = base_dataset()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "dataset.json"
            output = Path(directory) / "analysis.json"
            source.write_text(json.dumps(dataset), encoding="utf-8")

            self.assertEqual(run_cli(["--dataset", str(source), "--output", str(output), "--check"]), 0)
            self.assertFalse(output.exists())

            self.assertEqual(run_cli(["--dataset", str(source), "--output", str(output)]), 0)
            self.assertTrue(output.exists())
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["schema_version"], "1.1")

            invalid = copy.deepcopy(dataset)
            invalid["interactions"].append({
                "interaction_id": "BAD",
                "effector_id": entity_id("effector", 1),
                "host_protein_id": entity_id("host_protein", 1),
            })
            source.write_text(json.dumps(invalid), encoding="utf-8")
            output.unlink()

            self.assertEqual(run_cli(["--dataset", str(source), "--output", str(output), "--check"]), 0)
            self.assertEqual(run_cli(["--dataset", str(source), "--output", str(output), "--check", "--strict"]), 1)
            self.assertFalse(output.exists())

    def test_known_answer_sample_dataset(self):
        sample = ROOT / "data" / "sample-dataset.json"
        if not sample.exists():
            self.skipTest("sample dataset is not available")
        source_bytes = sample.read_bytes()
        result = analyze(json.loads(source_bytes), source_bytes, dataset_path=sample)
        stats = result["statistics"]

        self.assertEqual(stats["interaction_count"], 5)
        self.assertEqual(stats["unique_effector_count"], 5)
        self.assertEqual(stats["unique_host_protein_count"], 5)
        self.assertEqual(stats["unique_host_target_count"], 5)
        self.assertEqual(stats["evidence_count"], 5)
        self.assertEqual(stats["host_proteins_targeted_by_multiple_pathogens_count"], 0)
        self.assertEqual(result["validation"]["interaction_issues"], [])
        self.assertEqual(result["validation"]["evidence_issues"], [])
        self.assertEqual(result["validation"]["result_issues"], [])


if __name__ == "__main__":
    unittest.main()
