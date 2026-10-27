"""
Tests for the ML classifier module (evasion strategy prediction).
"""

import numpy as np
import pandas as pd

from pathomap.data.loader import to_df
from pathomap.ml.classifier import (
    FEATURE_NAMES,
    bootstrap_confidence_interval,
    compare_classifiers,
    cross_validate_rf,
    extract_features,
    features_from_effectors,
    grid_search_rf,
    out_of_fold_predictions,
    permutation_test,
    train_classifier,
)


def test_extract_features_shape():
    """Feature matrix should have 54 rows (one per pathogen) and 11 columns."""
    X, y = extract_features()
    assert X.shape[0] == 54
    assert X.shape[1] == len(FEATURE_NAMES)
    assert len(y) == 54


def test_extract_features_indexed_by_pathogen():
    """X rows must be labelled with the real pathogen names.

    Per-pathogen reporting (cross_validate_rf, out_of_fold_predictions) maps a
    positional row back to a name. That is only safe if X carries the name, so
    this guards against a silent mislabelling regression.
    """
    X, _ = extract_features()
    assert X.index.name == "pathogen"
    assert len(set(X.index)) == 54
    assert set(X.index) == set(to_df("SELECT name FROM pathogens")["name"])
    # names, not integer row numbers
    assert not any(str(name).isdigit() for name in X.index)


def test_out_of_fold_predictions_are_genuine():
    """Predictions must be out-of-fold, so they cannot be 100% correct.

    The previous offline payload copied the curated label into 'predicted' and
    derived 'confidence' from a hash, which made accuracy trivially 100%. Real
    cross-validated predictions should show genuine errors.
    """
    preds = out_of_fold_predictions()
    assert len(preds) == 54
    assert {p["pathogen"] for p in preds} == set(extract_features()[0].index)

    for p in preds:
        assert 0.0 <= p["confidence"] <= 1.0
        assert p["correct"] == (p["predicted"] == p["actual"])

    accuracy = sum(p["correct"] for p in preds) / len(preds)
    assert accuracy < 1.0, "out-of-fold accuracy of 100% implies label leakage"
    # More than a couple of distinct confidences means it is not a constant.
    assert len({p["confidence"] for p in preds}) > 2


def test_out_of_fold_agrees_with_cross_validate_rf():
    """Both CV helpers should score identically on the same folds."""
    from_folds = {
        r["pathogen"]: (r["predicted_strategy"], r["correct"])
        for r in cross_validate_rf()["folds"]
    }
    from_oof = {r["pathogen"]: (r["predicted"], r["correct"]) for r in out_of_fold_predictions()}
    assert from_folds == from_oof


def test_extract_features_no_nans():
    """Feature matrix should contain no missing values."""
    X, _ = extract_features()
    assert X.isna().sum().sum() == 0


def test_extract_feature_names_present():
    """X columns should match the declared FEATURE_NAMES."""
    X, _ = extract_features()
    assert list(X.columns) == FEATURE_NAMES


def test_features_from_effectors_shape_and_columns():
    """features_from_effectors mirrors FEATURE_NAMES and counts correctly."""
    df = pd.DataFrame(
        [
            {"pathogen": "Test Pathogen A", "type": "T3SS effector", "host_target": "Rab5 / EEA1"},
            {"pathogen": "Test Pathogen A", "type": "Toxin", "host_target": "Rab5"},
            {"pathogen": "Test Pathogen B", "type": "Porin", "host_target": "LAMP1"},
        ]
    )
    host_map = {
        "Rab5": ("phagosome_maturation", "vacuolar"),
        "EEA1": ("phagosome_maturation", "vacuolar"),
        "LAMP1": (None, "vacuolar"),
    }
    features = features_from_effectors(df, host_map=host_map)
    assert list(features.columns) == FEATURE_NAMES
    assert features.shape[0] == 2
    assert features.loc["Test Pathogen A", "n_effectors"] == 2
    assert features.loc["Test Pathogen A", "n_targets"] == 2
    assert features.loc["Test Pathogen A", "n_t3ss"] == 1
    assert features.loc["Test Pathogen A", "n_toxins"] == 1
    assert features.loc["Test Pathogen A", "n_interaction_types"] == 0
    assert features.loc["Test Pathogen B", "n_pathways"] == 0
    assert features.loc["Test Pathogen B", "n_surface_proteins"] == 1
    assert features.isna().sum().sum() == 0


def test_features_from_effectors_tolerates_missing_columns():
    """Effectors with no type/host_target columns still yield the 11 features."""
    df = pd.DataFrame({"pathogen": ["X", "X", "Y"]})
    features = features_from_effectors(df, host_map={})
    assert list(features.columns) == FEATURE_NAMES
    assert features.loc["X", "n_effectors"] == 2
    assert features.loc["X", "n_targets"] == 0
    assert features.loc["Y", "n_interaction_types"] == 0


def test_train_classifier_returns_fitted_model():
    """train_classifier should return a fitted model with predict + a report."""
    model, report = train_classifier()
    assert hasattr(model, "predict")
    assert hasattr(model, "predict_proba")
    assert "accuracy" in report


def test_compare_classifiers_returns_results():
    """compare_classifiers should return entries for all 4 models."""
    results = compare_classifiers()
    assert len(results) == 4
    names = {r["model"] for r in results}
    assert "Random Forest" in names
    for r in results:
        assert 0 <= r["mean_accuracy"] <= 1


def test_cross_validate_rf_structure():
    """cross_validate_rf should return per-pathogen fold results."""
    result = cross_validate_rf()
    assert result["n_folds"] == 5
    assert len(result["folds"]) == 54
    assert all("predicted_strategy" in f for f in result["folds"])


def test_grid_search_rf_structure():
    """grid_search_rf should return best params and score."""
    result = grid_search_rf()
    assert "best_params" in result
    assert "best_score" in result
    assert 0 <= result["best_score"] <= 1


def _signal_frame(seed: int = 0, n: int = 60) -> tuple[pd.DataFrame, pd.Series]:
    rng = np.random.default_rng(seed)
    X = pd.DataFrame(rng.normal(size=(n, 4)), columns=list("abcd"))
    y = pd.Series((X["a"] + X["b"] > 0).astype(int), name="y")
    return X, y


def test_permutation_test_finds_real_signal():
    """With a genuine feature/label relationship the p-value must be small.

    This is the regression guard for the previous implementation, which scored
    the null model against its own shuffled labels and so returned p ~ 1.0 even
    for perfectly learnable data.
    """
    X, y = _signal_frame()
    result = permutation_test(X, y, n_permutations=50, random_state=42)
    assert result["actual_score"] > 0.8
    assert result["p_value"] < 0.1
    assert result["is_significant"] is True
    assert 0.0 <= result["p_value"] <= 1.0
    assert result["n_train"] + result["n_test"] == len(y)
    for key in ("mean", "std", "min", "max"):
        assert 0.0 <= result["null_distribution"][key] <= 1.0


def test_permutation_test_does_not_invent_signal_in_noise():
    """On pure noise the observed score should not look significant."""
    rng = np.random.default_rng(1)
    X = pd.DataFrame(rng.normal(size=(60, 4)), columns=list("abcd"))
    y = pd.Series(rng.integers(0, 2, size=60), name="y")
    result = permutation_test(X, y, n_permutations=50, random_state=42)
    assert result["p_value"] > 0.05
    assert result["is_significant"] is False


def test_permutation_test_is_reproducible():
    X, y = _signal_frame()
    first = permutation_test(X, y, n_permutations=25, random_state=7)
    second = permutation_test(X, y, n_permutations=25, random_state=7)
    assert first == second


def test_bootstrap_confidence_interval_brackets_the_mean():
    scores = [0.35, 0.40, 0.38, 0.42, 0.37]
    result = bootstrap_confidence_interval(scores, n_bootstrap=500, random_state=42)
    assert result["mean"] == round(sum(scores) / len(scores), 4)
    assert result["lower"] <= result["mean"] <= result["upper"]
    assert result["confidence_level"] == 95
    assert result["standard_error"] >= 0


def test_bootstrap_confidence_interval_rejects_empty():
    import pytest

    with pytest.raises(ValueError):
        bootstrap_confidence_interval([], n_bootstrap=10)
