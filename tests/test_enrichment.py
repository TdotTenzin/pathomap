"""
Tests for the enrichment module (over-representation analysis).
"""

from math import comb

from pathomap.enrichment import (
    _build_pathway_db,
    _hypergeom_sf,
    overrepresentation_analysis,
    targeted_pathways_by_pathogen,
)


def test_hypergeom_sf_zero_k():
    """Survival function with k=0 should be 1.0."""
    assert _hypergeom_sf(0, 50, 10, 5) == 1.0


def test_hypergeom_sf_known_small():
    """A small hand-computable hypergeometric survival value."""
    # N=10, K=3, n=3, k=3 -> P(X>=3) = C(3,3)*C(7,0)/C(10,3) = 1/120
    expected = comb(3, 3) * comb(7, 0) / comb(10, 3)
    assert _hypergeom_sf(3, 10, 3, 3) == expected


def test_overrepresentation_empty_list():
    """Empty gene list should yield no enriched pathways."""
    assert overrepresentation_analysis([]) == []


def test_overrepresentation_known_pathway():
    """Proteins in a well-populated pathway should be detected as enriched."""
    db = _build_pathway_db()
    # Pick the largest pathway to guarantee a hit
    largest = max(db.items(), key=lambda kv: len(kv[1]))
    pathway, members = largest
    result = overrepresentation_analysis(members[:1], pathway_db=db)
    hits = [r for r in result if r["pathway"] == pathway]
    assert len(hits) == 1
    assert hits[0]["observed_in_list"] >= 1


def test_overrepresentation_returns_sorted():
    """Results should be sorted by raw p-value ascending."""
    db = _build_pathway_db()
    gene_list = [
        p for members in db.values()
        for p in members[:1]
    ]
    result = overrepresentation_analysis(gene_list, pathway_db=db)
    pvals = [r["p_value"] for r in result]
    assert pvals == sorted(pvals)


def test_targeted_pathways_returns_list():
    """targeted_pathways_by_pathogen should return a list of dicts."""
    result = targeted_pathways_by_pathogen("Salmonella enterica")
    assert isinstance(result, list)
    for r in result:
        assert "pathway" in r
        assert "p_value" in r
