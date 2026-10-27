"""
Tests for the real-PubMed literature layer (src/pathomap/literature.py).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pathomap.literature import (  # noqa: E402
    get_pathogen_literature,
    literature_coverage,
    load_literature,
)


def test_literature_cache_is_populated():
    assert len(load_literature()) > 0


def test_every_record_has_a_numeric_pmid_and_url():
    for rec in load_literature():
        assert rec["pubmed_id"].isdigit(), rec
        assert rec["pubmed_url"] == f"https://pubmed.ncbi.nlm.nih.gov/{rec['pubmed_id']}/"


def test_every_record_records_its_provenance():
    for rec in load_literature():
        assert rec["query"], rec
        assert rec["fetched_utc"], rec


def test_records_have_bibliographic_fields():
    for rec in load_literature():
        assert rec["pathogen_name"]
        assert rec["title"]
        assert rec["year"].isdigit() and len(rec["year"]) == 4


def test_interpretive_fields_are_left_blank():
    # Machine-verifiable fields only; findings/gaps need human curation.
    assert all(not r["key_findings"] for r in load_literature())
    assert all(not r["knowledge_gap"] for r in load_literature())


def test_get_pathogen_literature_is_case_insensitive():
    lower = get_pathogen_literature("salmonella enterica")
    exact = get_pathogen_literature("Salmonella enterica")
    assert lower == exact
    assert len(exact) >= 1


def test_get_unknown_pathogen_returns_empty():
    assert get_pathogen_literature("Nonexistent organism") == []


def test_coverage_summary_shape():
    cov = literature_coverage()
    assert cov["records"] == len(load_literature())
    assert cov["pathogens_covered"] >= 1
    assert cov["curated"] == 0  # no human curation has been entered yet
