"""
api/index.py — Single Vercel serverless function for all API endpoints.
"""

import sys
from pathlib import Path
from urllib.parse import quote as _urlquote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))


from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

from pathomap.data.loader import query
from pathomap.enrichment import overrepresentation_analysis, targeted_pathways_by_pathogen
from pathomap.interactome import (
    advanced_network_metrics,
    build_network,
    compare_networks,
    hub_targets,
    network_stats,
    pathogen_subgraph,
)
from pathomap.literature import (
    get_pathogen_literature,
    literature_coverage,
    load_literature,
)
from pathomap.ml import advanced_classifier
from pathomap.ml.classifier import (
    bootstrap_confidence_interval,
    compare_classifiers,
    cross_validate_rf,
    extract_features,
    grid_search_rf,
    permutation_test,
    train_classifier,
)
from pathomap.ml.dimred import (
    pathogen_feature_pca,
    pca_analysis,
    umap_analysis,
)
from pathomap.ml.phylogenetics import build_phylogenetic_tree
from pathomap.notebooks import get_notebook, list_notebooks
from pathomap.novel_findings import feature_strategy_association, novel_findings_report
from pathomap.sequence_analysis import (
    clean_sequence,
    get_effector_sequence,
    sequence_coverage,
    sequence_features,
)
from pathomap.trafficking import PhagosomeMaturation

app = FastAPI(
    title="PathoMap API",
    version="0.4.0",
    description="REST API for the PathoMap curated host-pathogen dataset.",
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class MarkerInput(BaseModel):
    markers: List[str]


class MarkerSnapshot(BaseModel):
    snapshots: List[List[str]]


class SequenceRequest(BaseModel):
    sequence: str


# ---------------------------------------------------------------------------
# Shared caches
# ---------------------------------------------------------------------------

_cached_network = None
_cached_model = None
_cached_features = None
_cached_statistical_rigor = None


def _get_cached_network():
    global _cached_network
    if _cached_network is None:
        _cached_network = build_network()
    return _cached_network


def _get_cached_model_and_features():
    global _cached_model, _cached_features
    if _cached_features is None:
        _cached_features = extract_features()
        _cached_model, _ = train_classifier()
    return _cached_model, _cached_features


# ---------------------------------------------------------------------------
# External database links
#
# These are live search/entry URLs derived from a record's own name or
# accession — never stored identifiers — so the API points at UniProt,
# PHI-base and IntAct without asserting that a specific curated record exists.
# ---------------------------------------------------------------------------


def uniprot_url(accession: str | None) -> str | None:
    """UniProtKB entry URL for a protein accession, e.g. P60953."""
    if not accession:
        return None
    return f"https://www.uniprot.org/uniprotkb/{_urlquote(accession)}/entry"


def phi_base_url(gene: str | None) -> str | None:
    """PHI-base search URL for a pathogen gene/effector name."""
    if not gene:
        return None
    return f"http://www.phi-base.org/searchFacet.htm?queryTerm={_urlquote(gene)}"


def intact_url(term: str | None) -> str | None:
    """IntAct search URL for an interaction term (usually a host protein)."""
    if not term:
        return None
    return f"https://www.ebi.ac.uk/intact/search?query={_urlquote(term)}"


def _list_stages_internal() -> list[dict]:
    stages = query("SELECT * FROM maturation_stages ORDER BY stage_order")
    all_markers = query("""
        SELECT sm.stage_id, hp.name, hp.function
        FROM stage_markers sm
        JOIN host_proteins hp ON sm.host_protein_id = hp.id
        WHERE sm.presence = 1
        ORDER BY sm.stage_id, hp.name
    """)
    markers_by_stage = {}
    for r in all_markers:
        sid = r["stage_id"]
        if sid not in markers_by_stage:
            markers_by_stage[sid] = []
        markers_by_stage[sid].append({"name": r["name"], "function": r["function"]})
    all_active = query("""
        SELECT sm.stage_id, p.name AS pathogen, p.strategy
        FROM effectors e
        JOIN pathogens p ON e.pathogen_id = p.id
        JOIN effector_targets et ON e.id = et.effector_id
        JOIN host_proteins hp ON et.host_protein_id = hp.id
        JOIN stage_markers sm ON hp.id = sm.host_protein_id
        WHERE sm.presence = 1
        GROUP BY sm.stage_id, p.name
        ORDER BY sm.stage_id, p.name
    """)
    active_by_stage = {}
    for r in all_active:
        sid = r["stage_id"]
        if sid not in active_by_stage:
            active_by_stage[sid] = []
        active_by_stage[sid].append({"pathogen": r["pathogen"], "strategy": r["strategy"]})
    result = []
    for s in stages:
        stage_dict = dict(s)
        stage_dict["markers_present"] = markers_by_stage.get(s["id"], [])
        stage_dict["active_pathogens"] = active_by_stage.get(s["id"], [])
        result.append(stage_dict)
    return result


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    return {"status": "ok", "database": "pathomap.db"}


# ---------------------------------------------------------------------------
# Pathogens & Effectors
# ---------------------------------------------------------------------------


@app.get("/api/pathogens")
async def list_pathogens(
    strategy: Optional[str] = Query(None, description="Filter by evasion strategy"),
    gram_stain: Optional[str] = Query(None, description="Filter by Gram stain"),
    limit: int = Query(100, description="Max results"),
    offset: int = Query(0, description="Offset for pagination"),
):
    sql = "SELECT * FROM pathogens"
    conditions = []
    params = []
    if strategy:
        conditions.append("strategy = ?")
        params.append(strategy)
    if gram_stain:
        conditions.append("gram_stain = ?")
        params.append(gram_stain)
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY name LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    return [dict(r) for r in query(sql, tuple(params))]


@app.get("/api/pathogens/{name}")
async def get_pathogen(name: str):
    rows = query("SELECT * FROM pathogens WHERE name = ?", (name,))
    if not rows:
        raise HTTPException(status_code=404, detail="Pathogen not found")
    result = dict(rows[0])
    cnt = query("SELECT COUNT(*) AS n FROM effectors WHERE pathogen_id = ?", (result["id"],))[0]["n"]
    result["n_effectors"] = cnt
    return result


@app.get("/api/pathogens/{name}/effectors")
async def pathogen_effectors(name: str):
    rows = [
        dict(r)
        for r in query(
            """
            SELECT e.name AS effector, e.type, e.host_target, e.mechanism
            FROM effectors e
            JOIN pathogens p ON e.pathogen_id = p.id
            WHERE p.name = ?
            ORDER BY e.name
            """,
            (name,),
        )
    ]
    for row in rows:
        row["phi_base_url"] = phi_base_url(row.get("effector"))
    return rows


@app.get("/api/pathogens/{name}/literature")
async def pathogen_literature(name: str):
    """Real PubMed references for a pathogen (fetched from NCBI E-utilities)."""
    rows = query("SELECT name FROM pathogens WHERE name = ?", (name,))
    if not rows:
        raise HTTPException(status_code=404, detail="Pathogen not found")
    return get_pathogen_literature(name)


@app.get("/api/literature")
async def list_literature():
    """Every cached PubMed reference, for the offline/fallback data path."""
    return list(load_literature())


@app.get("/api/literature/coverage")
async def get_literature_coverage():
    """Coverage of the cached PubMed reference set."""
    return literature_coverage()


@app.get("/api/effectors")
async def list_effectors(
    pathogen: Optional[str] = Query(None, description="Filter by pathogen name"),
    effector_type: Optional[str] = Query(None, description="Filter by effector type"),
    host_target: Optional[str] = Query(None, description="Filter by host target protein"),
    search: Optional[str] = Query(None, description="Search effectors by name or mechanism"),
    limit: int = Query(500, description="Max results"),
    offset: int = Query(0, description="Offset for pagination"),
):
    conditions = []
    params = []
    if pathogen:
        conditions.append("p.name = ?")
        params.append(pathogen)
    if effector_type:
        conditions.append("e.type LIKE ?")
        params.append(f"%{effector_type}%")
    if host_target:
        conditions.append("e.host_target = ?")
        params.append(host_target)
    if search:
        conditions.append("(e.name LIKE ? OR e.mechanism LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    sql = """
        SELECT p.name AS pathogen, e.name AS effector, e.type, e.host_target, e.mechanism
        FROM effectors e
        JOIN pathogens p ON e.pathogen_id = p.id
    """
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY p.name, e.name LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = [dict(r) for r in query(sql, tuple(params))]
    for row in rows:
        row["phi_base_url"] = phi_base_url(row.get("effector"))
    return rows


# ---------------------------------------------------------------------------
# Host Proteins
# ---------------------------------------------------------------------------


@app.get("/api/host-proteins")
async def list_host_proteins(
    search: Optional[str] = Query(None, description="Search by name or full_name"),
    pathway: Optional[str] = Query(None, description="Filter by pathway"),
    limit: int = Query(100, description="Max results"),
    offset: int = Query(0, description="Offset for pagination"),
):
    sql = "SELECT * FROM host_proteins"
    conditions = []
    params = []
    if search:
        conditions.append("(name LIKE ? OR full_name LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    if pathway:
        conditions.append("pathway = ?")
        params.append(pathway)
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY name LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = [dict(r) for r in query(sql, tuple(params))]
    for row in rows:
        row["uniprot_url"] = uniprot_url(row.get("uniprot_id"))
    return rows


@app.get("/api/host-proteins/{name}")
async def get_host_protein(name: str):
    protein = query("SELECT * FROM host_proteins WHERE name = ?", (name,))
    if not protein:
        raise HTTPException(status_code=404, detail="Host protein not found")
    targeting = [
        dict(r)
        for r in query(
            """
            SELECT p.name AS pathogen, e.name AS effector, et.interaction_type
            FROM effector_targets et
            JOIN effectors e ON et.effector_id = e.id
            JOIN pathogens p ON e.pathogen_id = p.id
            JOIN host_proteins h ON et.host_protein_id = h.id
            WHERE h.name = ?
            """,
            (name,),
        )
    ]
    result = dict(protein[0])
    result["targeted_by"] = targeting
    result["uniprot_url"] = uniprot_url(result.get("uniprot_id"))
    return result


# ---------------------------------------------------------------------------
# Trafficking
# ---------------------------------------------------------------------------


@app.get("/api/trafficking/stages")
async def list_stages():
    return _list_stages_internal()


@app.post("/api/trafficking/predict-stage")
async def predict_stage(input: MarkerInput):
    pm = PhagosomeMaturation()
    stage = pm.get_stage(input.markers)
    if stage is None:
        raise HTTPException(
            status_code=400, detail="Could not match marker profile to any stage"
        )
    info = pm.stage_info(stage)
    return info


@app.post("/api/trafficking/trajectory")
async def predict_trajectory(input: MarkerSnapshot):
    pm = PhagosomeMaturation()
    stages = pm.plot_trajectory(input.snapshots)
    return {"trajectory": stages}


# ---------------------------------------------------------------------------
# Interactome
# ---------------------------------------------------------------------------


@app.get("/api/interactome/hubs")
async def get_hubs(top_n: int = Query(10, description="Number of top hubs to return")):
    G = _get_cached_network()
    return hub_targets(G, top_n=top_n)


@app.get("/api/interactome/stats")
async def get_network_stats():
    G = _get_cached_network()
    return network_stats(G)


@app.get("/api/interactome/pathogen/{name}")
async def get_pathogen_subgraph_endpoint(name: str):
    G = _get_cached_network()
    sub = pathogen_subgraph(G, name)
    nodes = [
        {"id": n, "type": attr.get("type"), "pathogen": attr.get("pathogen")}
        for n, attr in sub.nodes(data=True)
    ]
    edges = [
        {"source": u, "target": v, "interaction": attr.get("interaction")}
        for u, v, attr in sub.edges(data=True)
    ]
    return {"nodes": nodes, "edges": edges}


@app.get("/api/interactome/metrics")
async def get_network_metrics(top_n: int = Query(15, ge=1, le=100)):
    """Advanced topology metrics for the whole host-pathogen network."""
    return advanced_network_metrics(_get_cached_network(), top_n=top_n)


@app.get("/api/interactome/metrics/{name}")
async def get_pathogen_network_metrics(name: str, top_n: int = Query(15, ge=1, le=100)):
    """Advanced topology metrics for one pathogen's subnetwork."""
    G = _get_cached_network()
    return advanced_network_metrics(pathogen_subgraph(G, name), top_n=top_n)


@app.get("/api/interactome/compare")
async def compare_pathogen_networks(
    pathogen_a: str = Query(..., description="First pathogen name"),
    pathogen_b: str = Query(..., description="Second pathogen name"),
):
    """Compare two pathogens' interaction subnetworks on shared nodes/edges."""
    G = _get_cached_network()
    return {
        "pathogen_a": pathogen_a,
        "pathogen_b": pathogen_b,
        "comparison": compare_networks(
            pathogen_subgraph(G, pathogen_a),
            pathogen_subgraph(G, pathogen_b),
        ),
    }


# ---------------------------------------------------------------------------
# Enrichment
# ---------------------------------------------------------------------------


@app.get("/api/enrichment/pathogen/{name}")
async def pathogen_enrichment(name: str):
    return targeted_pathways_by_pathogen(name)


@app.post("/api/enrichment/overrepresentation")
async def custom_enrichment(genes: List[str]):
    return overrepresentation_analysis(genes)


# ---------------------------------------------------------------------------
# ML / Classifier
# ---------------------------------------------------------------------------


@app.get("/api/ml/predict/{pathogen_name}")
async def predict_strategy(pathogen_name: str):
    model, (X, y) = _get_cached_model_and_features()
    all_pathogens = query("SELECT name FROM pathogens ORDER BY name")
    names = [r["name"] for r in all_pathogens]
    if pathogen_name not in names:
        raise HTTPException(
            status_code=404, detail=f"Pathogen '{pathogen_name}' not found"
        )
    idx = names.index(pathogen_name)
    features = X.iloc[[idx]]
    pred = model.predict(features)[0]
    proba = model.predict_proba(features)[0]
    confidence = round(float(max(proba)), 4)
    importances = [
        {"feature": col, "importance": round(float(imp), 4)}
        for col, imp in zip(X.columns, model.feature_importances_)
    ]
    importances.sort(key=lambda x: x["importance"], reverse=True)
    return {
        "pathogen": pathogen_name,
        "predicted_strategy": str(pred),
        "actual_strategy": str(y.iloc[idx]),
        "confidence": confidence,
        "feature_importances": importances,
    }


@app.get("/api/ml/features")
async def get_feature_matrix():
    _, (X, y) = _get_cached_model_and_features()
    df = X.copy()
    df["strategy"] = y.values
    return df.to_dict(orient="records")


@app.get("/api/ml/compare-classifiers")
async def compare_models():
    return compare_classifiers()


@app.get("/api/ml/cross-validate")
async def cross_validate_rf_endpoint():
    return cross_validate_rf()


@app.get("/api/ml/grid-search")
async def grid_search():
    return grid_search_rf()


@app.get("/api/ml/statistical-rigor")
async def statistical_rigor_analysis():
    """
    Perform permutation testing and bootstrap confidence intervals.

    This endpoint assesses whether the Random Forest classifier performs
    significantly better than random chance, and provides confidence
    intervals for cross-validation scores.

    The dataset is static, so the result is computed once and cached for the
    lifetime of the process. 200 permutations (resolution 0.005) keeps the
    first call within a serverless request budget while still being able to
    reject the null at p < 0.05.
    """
    global _cached_statistical_rigor
    if _cached_statistical_rigor is not None:
        return _cached_statistical_rigor

    X, y = extract_features()

    # Permutation test: trains internally on a held-out split so the null
    # distribution is a genuine "no signal" baseline.
    perm_results = permutation_test(X, y, n_permutations=200)

    # Bootstrap CI over the genuine per-fold accuracies from 5-fold CV, so the
    # interval reflects real fold-to-fold variation rather than simulated noise.
    cv_results = cross_validate_rf()
    folds = cv_results.get("folds", [])
    fold_accuracies = []
    for fold in sorted({row["fold"] for row in folds}):
        fold_rows = [row for row in folds if row["fold"] == fold]
        if fold_rows:
            fold_accuracies.append(
                sum(1 for row in fold_rows if row["correct"]) / len(fold_rows)
            )
    bootstrap_results = bootstrap_confidence_interval(fold_accuracies)

    _cached_statistical_rigor = {
        "permutation_test": perm_results,
        "bootstrap_ci": bootstrap_results,
        "explanation": {
            "permutation_test": "Tests if model performs better than random by shuffling training labels and retraining, scoring on a fixed held-out set",
            "bootstrap_ci": "Estimates uncertainty in cross-validation scores by resampling with replacement",
        },
    }
    return _cached_statistical_rigor


# ---------------------------------------------------------------------------
# Enhanced ML pipeline (advanced_classifier)
# ---------------------------------------------------------------------------

_cached_advanced: dict = {}


@app.get("/api/ml/advanced/models")
async def advanced_models(n_repeats: int = Query(5, ge=1, le=10)):
    """Repeated-CV comparison of the wider model zoo (cached per n_repeats)."""
    key = ("models", n_repeats)
    if key not in _cached_advanced:
        _cached_advanced[key] = advanced_classifier.compare_models(n_repeats=n_repeats)
    return _cached_advanced[key]


@app.get("/api/ml/advanced/nested-cv")
async def advanced_nested_cv(model: str = Query("Random Forest")):
    """Nested cross-validation estimate for a tunable model (cached)."""
    key = ("nested", model)
    if key not in _cached_advanced:
        try:
            _cached_advanced[key] = advanced_classifier.nested_cv(model_name=model)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    return _cached_advanced[key]


@app.get("/api/ml/advanced/feature-selection")
async def advanced_feature_selection(
    method: str = Query("mutual_info", pattern="^(mutual_info|l1|rfe)$"),
    k: int = Query(5, ge=1, le=11),
):
    """Rank (and select) features by mutual information, L1, or RFE."""
    return advanced_classifier.select_features(method=method, k=k)


@app.get("/api/ml/advanced/interpretation")
async def advanced_interpretation(model: str = Query("Random Forest")):
    """Global feature importance via SHAP when available, else permutation."""
    try:
        return advanced_classifier.model_interpretation(model_name=model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/ml/advanced/partial-dependence")
async def advanced_partial_dependence(
    feature: str = Query(..., description="One of the 11 feature names"),
    model: str = Query("Random Forest"),
):
    """One-way partial dependence of a feature for the chosen model."""
    try:
        return advanced_classifier.partial_dependence(feature=feature, model_name=model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/ml/advanced/pipeline")
async def advanced_pipeline_endpoint():
    """Full enhanced-pipeline report (models, feature selection, interpretation)."""
    if "pipeline" not in _cached_advanced:
        _cached_advanced["pipeline"] = advanced_classifier.advanced_pipeline()
    return _cached_advanced["pipeline"]


# ---------------------------------------------------------------------------
# Novel findings (sequence features vs survival strategy)
# ---------------------------------------------------------------------------

_cached_findings: dict = {}


@app.get("/api/novel-findings")
async def novel_findings(
    min_group_size: int = Query(6, ge=2, le=50),
    fdr: float = Query(0.05, gt=0.0, lt=1.0),
):
    """
    FDR-controlled feature/strategy associations.

    These are hypothesis-generating; the payload says so explicitly. Cached
    because the underlying dataset is static.
    """
    key = (min_group_size, fdr)
    if key not in _cached_findings:
        _cached_findings[key] = feature_strategy_association(
            min_group_size=min_group_size, fdr=fdr
        )
    return _cached_findings[key]


@app.get("/api/novel-findings/report")
async def novel_findings_report_endpoint():
    """Full report: analysis plus method description and caveats (cached)."""
    if "report" not in _cached_findings:
        _cached_findings["report"] = novel_findings_report()
    return _cached_findings["report"]


# ---------------------------------------------------------------------------
# Downloadable reproducible notebooks
# ---------------------------------------------------------------------------


@app.get("/api/notebooks")
async def notebooks_index():
    """List the generated reproducible analysis notebooks."""
    return list(list_notebooks())


@app.get("/api/notebooks/{slug}")
async def notebook_content(slug: str):
    """Return a generated notebook (nbformat 4) for download."""
    nb = get_notebook(slug)
    if nb is None:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return nb


# ---------------------------------------------------------------------------
# Sequence analysis
#
# Features are computed from real UniProtKB sequences resolved by
# scripts/fetch_effector_sequences.py. Endpoints never invent a sequence for an
# effector that has no curated protein entry; they report the gap instead.
# ---------------------------------------------------------------------------


@app.post("/api/sequence/analyze")
async def analyze_sequence(req: SequenceRequest, include_dipeptide: bool = True):
    """Compute sequence features for an arbitrary amino-acid sequence."""
    try:
        seq = clean_sequence(req.sequence)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    features = sequence_features(seq, include_dipeptide=include_dipeptide)
    return {"length": len(seq), "n_features": len(features), "features": features}


@app.get("/api/sequence/coverage")
async def sequence_coverage_stats():
    """How many curated effectors have a real resolved UniProt sequence."""
    return sequence_coverage()


@app.get("/api/effectors/{name}/sequence-features")
async def effector_sequence_features(
    name: str,
    pathogen: Optional[str] = Query(None, description="restrict to one pathogen"),
    include_dipeptide: bool = True,
):
    """
    Sequence features for a curated effector, using its real UniProt sequence.

    Returns every matching entry (an effector name can occur in several
    pathogens); 404 when the effector has no resolved protein sequence, which is
    the honest answer for polysaccharide/serotype entries such as LAM or LPS.
    """
    records = get_effector_sequence(name, pathogen)
    if not records:
        raise HTTPException(
            status_code=404,
            detail=f"No resolved UniProt sequence for effector '{name}'"
            + (f" in {pathogen}" if pathogen else ""),
        )
    matches = []
    for rec in records:
        features = sequence_features(rec["sequence"], include_dipeptide=include_dipeptide)
        matches.append({
            "pathogen": rec["pathogen_name"],
            "effector": rec["effector_name"],
            "uniprot_accession": rec["uniprot_accession"],
            "uniprot_entry_name": rec["uniprot_entry_name"],
            "reviewed": rec["reviewed"],
            "protein_name": rec["protein_name"],
            "organism": rec["organism"],
            "sequence_length": rec["sequence_length"],
            "n_features": len(features),
            "features": features,
        })
    return {"effector": name, "n_matches": len(matches), "matches": matches}


# ---------------------------------------------------------------------------
# ML / Dimensionality Reduction
# ---------------------------------------------------------------------------


@app.get("/api/ml/pca")
async def run_pca():
    return pca_analysis()


@app.get("/api/ml/umap")
async def run_umap(
    n_neighbors: int = Query(5, description="UMAP n_neighbors"),
    min_dist: float = Query(0.3, description="UMAP min_dist"),
):
    return umap_analysis(n_neighbors=n_neighbors, min_dist=min_dist)


@app.get("/api/ml/pathogen-pca")
async def pathogen_pca():
    return pathogen_feature_pca()


# ---------------------------------------------------------------------------
# ML / Phylogenetics
# ---------------------------------------------------------------------------


@app.get("/api/ml/phylogeny")
async def effector_phylogeny():
    return build_phylogenetic_tree()



# ---------------------------------------------------------------------------
# Stats & Search
# ---------------------------------------------------------------------------


@app.get("/api/stats")
async def database_stats():
    return {
        "pathogens": query("SELECT COUNT(*) AS n FROM pathogens")[0]["n"],
        "effectors": query("SELECT COUNT(*) AS n FROM effectors")[0]["n"],
        "host_proteins": query("SELECT COUNT(*) AS n FROM host_proteins")[0]["n"],
        "effector_targets": query("SELECT COUNT(*) AS n FROM effector_targets")[0]["n"],
        "maturation_stages": query("SELECT COUNT(*) AS n FROM maturation_stages")[0]["n"],
        "strategies": [dict(r) for r in query("SELECT strategy, COUNT(*) AS n FROM pathogens GROUP BY strategy ORDER BY n DESC")],
        "gram_stains": [dict(r) for r in query("SELECT gram_stain, COUNT(*) AS n FROM pathogens GROUP BY gram_stain ORDER BY n DESC")],
    }


@app.get("/api/search")
async def search(
    q: str = Query("", description="Search term matching pathogen name, species, or description"),
    strategy: Optional[str] = Query(None, description="Filter by evasion strategy"),
    gram_stain: Optional[str] = Query(None, description="Filter by Gram stain result"),
    min_effectors: Optional[int] = Query(None, description="Minimum number of effectors"),
    max_effectors: Optional[int] = Query(None, description="Maximum number of effectors"),
    limit: int = Query(50, description="Max results"),
):
    sql = """
        SELECT p.*, COUNT(e.id) AS n_effectors
        FROM pathogens p
        LEFT JOIN effectors e ON e.pathogen_id = p.id
    """
    conditions = []
    params = []
    if q:
        conditions.append("(p.name LIKE ? OR p.species LIKE ? OR p.description LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    if strategy:
        conditions.append("p.strategy = ?")
        params.append(strategy)
    if gram_stain:
        conditions.append("p.gram_stain = ?")
        params.append(gram_stain)
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " GROUP BY p.id ORDER BY p.name"
    if min_effectors is not None or max_effectors is not None:
        having_clauses = []
        if min_effectors is not None:
            having_clauses.append("COUNT(e.id) >= ?")
            params.append(min_effectors)
        if max_effectors is not None:
            having_clauses.append("COUNT(e.id) <= ?")
            params.append(max_effectors)
        sql += " HAVING " + " AND ".join(having_clauses)
    sql += " LIMIT ?"
    params.append(limit)
    return [dict(r) for r in query(sql, tuple(params))]


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------


@app.get("/api/bootstrap")
async def bootstrap():
    pathogens = [dict(r) for r in query("SELECT * FROM pathogens ORDER BY name")]
    effectors = [
        dict(r)
        for r in query(
            """
            SELECT p.name AS pathogen, e.name AS effector, e.type, e.host_target, e.mechanism
            FROM effectors e JOIN pathogens p ON e.pathogen_id = p.id
            ORDER BY p.name, e.name
            """
        )
    ]
    stages = _list_stages_internal()
    hubs = hub_targets(_get_cached_network(), top_n=15)
    host_proteins = [
        dict(r) for r in query("SELECT * FROM host_proteins ORDER BY name LIMIT 100")
    ]
    interactions = [
        dict(r)
        for r in query(
            """
            SELECT e.name AS effector,
                   p.name AS pathogen,
                   hp.name AS host_protein,
                   et.interaction_type
            FROM effector_targets et
            JOIN effectors e ON et.effector_id = e.id
            JOIN pathogens p ON e.pathogen_id = p.id
            JOIN host_proteins hp ON et.host_protein_id = hp.id
            ORDER BY p.name, e.name, hp.name
            """
        )
    ]
    # External-database links, computed from the record's own name/accession.
    for row in host_proteins:
        row["uniprot_url"] = uniprot_url(row.get("uniprot_id"))
    for row in effectors:
        row["phi_base_url"] = phi_base_url(row.get("effector"))
    for row in interactions:
        row["intact_url"] = intact_url(row.get("host_protein"))
    # n_effectors is computed rather than stored, so attach it here to match
    # the shape the offline export produces and the Database table expects.
    counts: dict[str, int] = {}
    for e in effectors:
        counts[e["pathogen"]] = counts.get(e["pathogen"], 0) + 1
    for p in pathogens:
        p["n_effectors"] = counts.get(p["name"], 0)
    return {
        "pathogens": pathogens,
        "effectors": effectors,
        "stages": stages,
        "hubs": hubs,
        "host_proteins": host_proteins,
        "interactions": interactions,
        "literature": list(load_literature()),
    }
