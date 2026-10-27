"""
Tests for the dimensionality reduction module (PCA / UMAP).
"""

import pandas as pd

from pathomap.ml.dimred import (
    pathogen_feature_pca,
    pca_analysis,
    pca_from_matrix,
    umap_analysis,
    umap_from_matrix,
)


def _sample_matrix() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "g1": [1, 2, 3, 4, 10, 11, 12, 13],
            "g2": [2, 4, 6, 8, 20, 22, 24, 26],
            "g3": [1, 1, 1, 1, 2, 2, 2, 2],
        }
    )


def test_pca_analysis_keys():
    """pca_analysis should return expected summary fields."""
    result = pca_analysis()
    for key in [
        "explained_variance_ratio",
        "cumulative_variance",
        "n_components",
        "top_genes_pc1",
        "samples",
    ]:
        assert key in result
    assert len(result["samples"]) == 6


def test_pca_samples_have_condition():
    """Each PCA sample should carry a condition label."""
    result = pca_analysis()
    assert all("condition" in s for s in result["samples"])
    conditions = {s["condition"] for s in result["samples"]}
    assert "infected" in conditions
    assert "control" in conditions


def test_pathogen_feature_pca_shape():
    """pathogen_feature_pca should return 54 samples with PC1/PC2."""
    result = pathogen_feature_pca()
    assert len(result["samples"]) == 54
    for s in result["samples"]:
        assert "pathogen" in s
        assert "strategy" in s
        assert "PC1" in s
        assert "PC2" in s


def test_umap_handles_missing_library():
    """umap_analysis should degrade gracefully if umap-learn is unavailable."""
    result = umap_analysis()
    # Either it errored (with 'error' key) or returned samples; never crash.
    assert isinstance(result, dict)


def test_pca_from_matrix_keys_and_labels():
    """pca_from_matrix returns variance ratios, components, and labelled samples."""
    df = _sample_matrix()
    labels = ["control"] * 4 + ["infected"] * 4
    result = pca_from_matrix(df, labels=labels, n_components=2)
    assert "explained_variance_ratio" in result
    assert len(result["explained_variance_ratio"]) == 2
    assert result["n_components"] == 2
    assert list(result["feature_names"]) == ["g1", "g2", "g3"]
    assert len(result["samples"]) == 8
    assert result["samples"][0]["condition"] == "control"
    assert result["samples"][4]["condition"] == "infected"
    assert all(
        "PC1" in s and "PC2" in s for s in result["samples"]
    )


def test_pca_from_matrix_default_labels():
    """Without labels every sample is tagged 'sample'."""
    result = pca_from_matrix(_sample_matrix(), n_components=2)
    assert all(s["condition"] == "sample" for s in result["samples"])


def test_pca_from_matrix_singular_feature():
    """A constant column must not crash PCA (guarded standardization)."""
    df = pd.DataFrame({"a": [1, 1, 1, 1], "b": [2, 4, 6, 8]})
    result = pca_from_matrix(df, n_components=2)
    assert result["n_components"] >= 1
    assert len(result["samples"]) == 4


def test_umap_from_matrix_graceful():
    """umap_from_matrix returns samples, or an error dict when unavailable."""
    result = umap_from_matrix(_sample_matrix())
    assert isinstance(result, dict)
    assert "n_neighbors" in result
    assert "min_dist" in result
    assert "samples" in result
