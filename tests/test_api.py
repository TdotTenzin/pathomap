"""
Tests for the FastAPI HTTP endpoints.
"""

import sys
from pathlib import Path

from fastapi.testclient import TestClient

# Ensure the repo root and src are importable in this test.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

from api.index import app  # noqa: E402

client = TestClient(app)


def test_health_endpoint():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_list_pathogens():
    resp = client.get("/api/pathogens")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_get_pathogen_known():
    resp = client.get("/api/pathogens/Salmonella enterica")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Salmonella enterica"


def test_get_pathogen_unknown_404():
    resp = client.get("/api/pathogens/Nonexistent")
    assert resp.status_code == 404


def test_list_effectors():
    resp = client.get("/api/effectors?limit=10")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) <= 10


def test_pathogen_effectors():
    resp = client.get("/api/pathogens/Salmonella enterica/effectors")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) > 0
    assert "effector" in rows[0]


def test_host_protein_external_link():
    resp = client.get("/api/host-proteins/Rab5")
    assert resp.status_code == 200
    body = resp.json()
    assert body["uniprot_id"] == "P20338"
    assert body["uniprot_url"] == "https://www.uniprot.org/uniprotkb/P20338/entry"


def test_host_protein_without_accession_has_null_link():
    resp = client.get("/api/host-proteins/Cholesterol")
    assert resp.status_code == 200
    assert resp.json()["uniprot_url"] is None


def test_host_proteins_list_includes_links():
    resp = client.get("/api/host-proteins?limit=100")
    assert resp.status_code == 200
    rows = {r["name"]: r for r in resp.json()}
    assert rows["Cdc42"]["uniprot_url"] == "https://www.uniprot.org/uniprotkb/P60953/entry"
    # records without an accession still carry the key (as None) for a stable shape
    assert "uniprot_url" in rows.get("Cholesterol", {})


def test_effectors_carry_phi_base_search_links():
    resp = client.get("/api/pathogens/Salmonella enterica/effectors")
    assert resp.status_code == 200
    rows = resp.json()
    assert rows
    assert all("phi_base_url" in r for r in rows)
    sop_e = next(r for r in rows if r["effector"] == "SopE")
    assert sop_e["phi_base_url"] == "http://www.phi-base.org/searchFacet.htm?queryTerm=SopE"


def test_trafficking_stages():
    resp = client.get("/api/trafficking/stages")
    assert resp.status_code == 200
    stages = resp.json()
    assert len(stages) == 5


def test_predict_stage():
    resp = client.post(
        "/api/trafficking/predict-stage",
        json={"markers": ["Rab5", "EEA1", "PI3P"]},
    )
    assert resp.status_code == 200
    assert "name" in resp.json()


def test_interactome_hubs():
    resp = client.get("/api/interactome/hubs?top_n=5")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) <= 5
    assert len(data) > 0


def test_interactome_pathogen_subgraph():
    resp = client.get("/api/interactome/pathogen/Salmonella enterica")
    assert resp.status_code == 200
    body = resp.json()
    assert "nodes" in body
    assert "edges" in body
    assert len(body["nodes"]) > 0


def test_interactome_stats():
    resp = client.get("/api/interactome/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert "total_nodes" in body
    assert "host_proteins" in body


def test_enrichment_pathogen():
    resp = client.get("/api/enrichment/pathogen/Salmonella enterica")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_ml_predict():
    resp = client.get("/api/ml/predict/Salmonella enterica")
    assert resp.status_code == 200
    body = resp.json()
    assert "predicted_strategy" in body
    assert "actual_strategy" in body


def test_ml_pathogen_pca():
    resp = client.get("/api/ml/pathogen-pca")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["samples"]) == 54


def test_pathogen_phylogeny():
    resp = client.get("/api/ml/phylogeny")
    assert resp.status_code == 200
    body = resp.json()
    assert "newick" in body
    assert "colour_map" in body


def test_bootstrap():
    resp = client.get("/api/bootstrap")
    assert resp.status_code == 200
    body = resp.json()
    for key in ["pathogens", "effectors", "stages", "hubs", "host_proteins"]:
        assert key in body


def test_bootstrap_includes_external_links():
    resp = client.get("/api/bootstrap")
    assert resp.status_code == 200
    body = resp.json()
    hosts = {r["name"]: r for r in body["host_proteins"]}
    assert hosts["Cdc42"]["uniprot_url"] == "https://www.uniprot.org/uniprotkb/P60953/entry"
    assert all("phi_base_url" in e for e in body["effectors"])
    assert all("intact_url" in i for i in body["interactions"])


def test_stats():
    resp = client.get("/api/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert body["pathogens"] == 54
    assert body["effectors"] > 0


def test_sequence_analyze_returns_features():
    resp = client.post("/api/sequence/analyze", json={"sequence": "MKTAYIAKQRQISFVKSHFS"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["length"] == 20
    assert body["n_features"] >= 144
    assert "gravy" in body["features"]


def test_sequence_analyze_rejects_nonstandard_residues():
    resp = client.post("/api/sequence/analyze", json={"sequence": "MKTAYI*"})
    assert resp.status_code == 400


def test_effector_sequence_features_uses_real_entry():
    resp = client.get("/api/effectors/SopE/sequence-features", params={"pathogen": "Salmonella enterica"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_matches"] == 1
    match = body["matches"][0]
    assert match["uniprot_accession"] == "Q8VSR1"
    assert match["n_features"] >= 144


def test_effector_sequence_features_missing_is_404():
    resp = client.get("/api/effectors/LAM/sequence-features")
    assert resp.status_code == 404


def test_sequence_coverage_endpoint():
    resp = client.get("/api/sequence/coverage")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 250
    assert body["resolved"] >= 190


def test_interactome_metrics_endpoint():
    resp = client.get("/api/interactome/metrics")
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_nodes"] > 0
    assert 0.0 <= body["density"] <= 1.0
    assert "centrality_summary" in body


def test_interactome_metrics_pathogen_endpoint():
    resp = client.get("/api/interactome/metrics/Salmonella enterica")
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_nodes"] > 0


def test_interactome_compare_endpoint():
    resp = client.get(
        "/api/interactome/compare",
        params={"pathogen_a": "Salmonella enterica", "pathogen_b": "Mycobacterium tuberculosis"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["pathogen_a"] == "Salmonella enterica"
    assert 0.0 <= body["comparison"]["node_jaccard"] <= 1.0


def test_pathogen_literature_endpoint():
    resp = client.get("/api/pathogens/Salmonella enterica/literature")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) >= 1
    first = rows[0]
    assert first["pubmed_id"].isdigit()
    assert first["pubmed_url"] == f"https://pubmed.ncbi.nlm.nih.gov/{first['pubmed_id']}/"
    assert first["title"]
    assert first["query"]


def test_pathogen_literature_unknown_404():
    resp = client.get("/api/pathogens/Nonexistent/literature")
    assert resp.status_code == 404


def test_literature_coverage_endpoint():
    resp = client.get("/api/literature/coverage")
    assert resp.status_code == 200
    body = resp.json()
    assert body["records"] > 0
    assert body["pathogens_covered"] >= 1


def test_advanced_models_endpoint():
    resp = client.get("/api/ml/advanced/models", params={"n_repeats": 1})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["models"]) == 6
    assert body["n_samples"] == 54


def test_advanced_feature_selection_endpoint():
    resp = client.get("/api/ml/advanced/feature-selection", params={"method": "mutual_info", "k": 4})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["selected"]) == 4


def test_advanced_interpretation_endpoint():
    resp = client.get("/api/ml/advanced/interpretation", params={"model": "Random Forest"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["method"] in {"shap", "permutation"}
    assert len(body["features"]) == 11


def test_advanced_partial_dependence_endpoint():
    resp = client.get(
        "/api/ml/advanced/partial-dependence", params={"feature": "n_effectors"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is True
    assert len(body["grid"]) == len(body["average"])


def test_advanced_partial_dependence_unknown_feature_400():
    resp = client.get(
        "/api/ml/advanced/partial-dependence", params={"feature": "nope"}
    )
    assert resp.status_code == 400


def test_novel_findings_endpoint():
    resp = client.get("/api/novel-findings")
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_sequences"] > 0
    assert body["min_group_size"] == 6
    assert all(f["q_value"] <= 0.05 for f in body["findings"])


def test_novel_findings_report_endpoint():
    resp = client.get("/api/novel-findings/report")
    assert resp.status_code == 200
    body = resp.json()
    assert "Welch" in body["method"]
    assert body["analysis"]["n_sequences"] > 0


def test_notebooks_index_endpoint():
    resp = client.get("/api/notebooks")
    assert resp.status_code == 200
    notebooks = resp.json()
    assert len(notebooks) >= 5
    assert all(n["slug"] for n in notebooks)


def test_notebook_content_endpoint():
    resp = client.get("/api/notebooks/dataset-overview")
    assert resp.status_code == 200
    body = resp.json()
    assert body["nbformat"] == 4
    assert body["cells"]


def test_notebook_unknown_404():
    resp = client.get("/api/notebooks/nope")
    assert resp.status_code == 404
