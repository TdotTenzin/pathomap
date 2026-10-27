"""
Tests for the enhanced ML pipeline (src/pathomap/ml/advanced_classifier.py).
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pathomap.ml.advanced_classifier import (  # noqa: E402
    FEATURE_NAMES,
    advanced_pipeline,
    compare_models,
    model_interpretation,
    nested_cv,
    partial_dependence,
    select_features,
    shap_available,
)


def test_compare_models_ranks_and_bounds():
    report = compare_models(n_repeats=2)
    models = report["models"]
    assert len(models) == 6
    # sorted descending by mean accuracy
    accs = [m["mean_accuracy"] for m in models]
    assert accs == sorted(accs, reverse=True)
    for m in models:
        assert 0.0 <= m["mean_accuracy"] <= 1.0
        assert m["ci_lower"] <= m["mean_accuracy"] <= m["ci_upper"]
    assert report["n_samples"] == 54
    assert report["note"]


@pytest.mark.parametrize("method", ["mutual_info", "l1", "rfe"])
def test_select_features_returns_full_ranking(method):
    result = select_features(method=method, k=5)
    assert len(result["features"]) == len(FEATURE_NAMES)
    assert len(result["selected"]) == 5
    assert set(result["selected"]).issubset(set(FEATURE_NAMES))
    assert result["rationale"]


def test_select_features_rejects_unknown_method():
    with pytest.raises(ValueError):
        select_features(method="nope")


def test_model_interpretation_reports_method_honestly():
    result = model_interpretation("Random Forest")
    assert len(result["features"]) == len(FEATURE_NAMES)
    assert result["method"] in {"shap", "permutation"}
    assert result["shap_available"] == shap_available()
    if not shap_available():
        assert result["method"] == "permutation"


def test_model_interpretation_unknown_model():
    with pytest.raises(ValueError):
        model_interpretation("No Such Model")


def test_partial_dependence_grid_matches_curve():
    result = partial_dependence("n_effectors", grid_points=10)
    assert result["available"] is True
    assert len(result["grid"]) == len(result["average"])
    assert 0.0 <= min(result["average"]) and max(result["average"]) <= 1.0


def test_partial_dependence_unknown_feature():
    with pytest.raises(ValueError):
        partial_dependence("not_a_feature")


def test_nested_cv_returns_unbiased_estimate():
    result = nested_cv("Random Forest", outer_splits=5, inner_splits=3)
    assert result["outer_splits"] == 5
    assert len(result["per_fold"]) == 5
    assert 0.0 <= result["mean_accuracy"] <= 1.0
    assert "n_estimators" in result["refit_best_params"]


def test_nested_cv_unknown_model():
    with pytest.raises(ValueError):
        nested_cv("k-NN (k=5)")


def test_advanced_pipeline_shape():
    report = advanced_pipeline()
    assert "model_comparison" in report
    assert set(report["feature_selection"]) == {"mutual_info", "l1", "rfe"}
    assert "interpretation" in report
    assert isinstance(report["shap_available"], bool)
