"""
advanced_classifier.py — Enhanced ML pipeline with model interpretation.

Builds on `classifier.py` (same 11-feature, 54-pathogen matrix) and adds:

  - a wider model zoo (Random Forest, SVM-RBF, Gradient Boosting, k-NN, MLP)
  - repeated stratified cross-validation with bootstrap confidence intervals
  - feature selection (mutual information, L1 regularisation, recursive
    feature elimination)
  - model interpretation via SHAP when the optional dependency is installed,
    falling back to permutation importance otherwise
  - partial-dependence data for the most influential features

With only 54 pathogens and several small strategy classes, these results are
**exploratory**: they describe this curated dataset, not a validated predictor.
Every summary carries that caveat explicitly.
"""

from __future__ import annotations

import numpy as np

from pathomap.ml.classifier import (
    FEATURE_NAMES,
    bootstrap_confidence_interval,
    extract_features,
)

EXPLORATORY_NOTE = (
    "Exploratory analysis of the curated 54-pathogen dataset; "
    "not a validated predictor. Small classes make estimates unstable."
)

_STRATIFIED_KWARGS = {"n_splits": 5, "shuffle": True, "random_state": 42}


def _model_zoo(random_state: int = 42) -> dict:
    """Instantiate the model zoo fresh (estimators are stateful after fit)."""
    from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.neural_network import MLPClassifier
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.svm import SVC

    return {
        "Random Forest": RandomForestClassifier(
            n_estimators=100, random_state=random_state, class_weight="balanced"
        ),
        "Gradient Boosting": GradientBoostingClassifier(random_state=random_state),
        "SVM (RBF)": make_pipeline(
            StandardScaler(),
            SVC(kernel="rbf", gamma="scale", class_weight="balanced", random_state=random_state),
        ),
        "Logistic Regression": make_pipeline(
            StandardScaler(),
            LogisticRegression(max_iter=2000, random_state=random_state),
        ),
        "k-NN (k=5)": make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=5)),
        "Neural Net (MLP)": make_pipeline(
            StandardScaler(),
            MLPClassifier(
                hidden_layer_sizes=(32,),
                max_iter=2000,
                random_state=random_state,
                early_stopping=False,
            ),
        ),
    }


def shap_available() -> bool:
    """Whether the optional SHAP library can be imported."""
    try:
        import shap  # noqa: F401
    except Exception:
        return False
    return True


def compare_models(n_repeats: int = 5, random_state: int = 42) -> dict:
    """
    Repeated stratified k-fold comparison of the model zoo.

    Returns per-model mean/std accuracy plus a bootstrap 95% CI over the pooled
    fold scores, sorted by mean accuracy.
    """
    from sklearn.model_selection import RepeatedStratifiedKFold, cross_val_score

    X, y = extract_features()
    cv = RepeatedStratifiedKFold(
        n_splits=5, n_repeats=n_repeats, random_state=random_state
    )

    results = []
    for name, model in _model_zoo(random_state).items():
        scores = cross_val_score(model, X, y, cv=cv)
        ci = bootstrap_confidence_interval(list(scores), n_bootstrap=2000, random_state=random_state)
        results.append({
            "model": name,
            "mean_accuracy": round(float(scores.mean()), 4),
            "std_accuracy": round(float(scores.std()), 4),
            "ci_lower": ci["lower"],
            "ci_upper": ci["upper"],
            "n_scores": int(len(scores)),
        })
    results.sort(key=lambda r: r["mean_accuracy"], reverse=True)
    return {
        "models": results,
        "n_repeats": n_repeats,
        "n_features": len(FEATURE_NAMES),
        "n_samples": int(len(y)),
        "note": EXPLORATORY_NOTE,
    }


def select_features(
    method: str = "mutual_info",
    k: int = 5,
    random_state: int = 42,
) -> dict:
    """
    Rank features by one of three selectors.

    method:
        "mutual_info" — mutual information with the strategy label
        "l1"          — sum of absolute L1 (one-vs-rest) logistic coefficients
        "rfe"         — recursive feature elimination with a Random Forest
    """
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.feature_selection import RFE, mutual_info_classif
    from sklearn.linear_model import LogisticRegression
    from sklearn.multiclass import OneVsRestClassifier
    from sklearn.preprocessing import StandardScaler

    X, y = extract_features()
    Xs = StandardScaler().fit_transform(X)

    if method == "mutual_info":
        scores = mutual_info_classif(Xs, y, random_state=random_state)
        ranking = scores
        rationale = "Mutual information between each feature and the strategy label."
    elif method == "l1":
        # One-vs-rest keeps the multiclass scheme explicit and avoids the
        # deprecated implicit liblinear multiclass path.
        clf = OneVsRestClassifier(
            LogisticRegression(penalty="l1", solver="liblinear", max_iter=5000, random_state=random_state)
        )
        clf.fit(Xs, y)
        scores = np.sum([np.abs(c.coef_).sum(axis=0) for c in clf.estimators_], axis=0)
        ranking = scores
        rationale = "Sum of absolute L1-penalised one-vs-rest logistic coefficients."
    elif method == "rfe":
        rf = RandomForestClassifier(
            n_estimators=100, random_state=random_state, class_weight="balanced"
        )
        rfe = RFE(estimator=rf, n_features_to_select=min(k, len(FEATURE_NAMES)))
        rfe.fit(Xs, y)
        # Lower rank (1 = kept last) means more important.
        order = np.argsort(rfe.ranking_)
        scores = np.empty(len(FEATURE_NAMES), dtype=float)
        for rank_position, idx in enumerate(order):
            scores[idx] = len(FEATURE_NAMES) - rank_position
        ranking = scores
        rationale = f"Recursive feature elimination keeping the top {min(k, len(FEATURE_NAMES))}."
    else:
        raise ValueError(f"unknown feature-selection method: {method!r}")

    order = np.argsort(ranking)[::-1]
    ranked = [
        {
            "feature": FEATURE_NAMES[i],
            "score": round(float(ranking[i]), 4),
            "selected": rank_position < k,
        }
        for rank_position, i in enumerate(order)
    ]
    return {
        "method": method,
        "k": k,
        "rationale": rationale,
        "features": ranked,
        "selected": [r["feature"] for r in ranked if r["selected"]],
        "note": EXPLORATORY_NOTE,
    }


def model_interpretation(model_name: str = "Random Forest", random_state: int = 42) -> dict:
    """
    Global feature importance for the chosen model.

    Uses SHAP (mean absolute value) when the optional library is installed and
    the model is tree-based; otherwise falls back to permutation importance on
    a held-out split. The `method` field reports which was used so the result is
    never misrepresented as SHAP when it is not.
    """
    from sklearn.inspection import permutation_importance
    from sklearn.model_selection import train_test_split

    X, y = extract_features()
    zoo = _model_zoo(random_state)
    if model_name not in zoo:
        raise ValueError(f"unknown model: {model_name!r}")
    model = zoo[model_name]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=random_state, stratify=y
    )
    model.fit(X_train, y_train)

    importances: list[float]
    method = "permutation"
    used_shap = False

    if shap_available():
        try:
            import shap

            explainer = shap.Explainer(model.predict_proba, X_train)
            shap_values = explainer(X_test)
            values = np.asarray(shap_values.values)
            # (n_samples, n_features, n_classes) -> mean |value| per feature
            if values.ndim == 3:
                importances = np.abs(values).mean(axis=(0, 2))
            else:
                importances = np.abs(values).mean(axis=0)
            method = "shap"
            used_shap = True
        except Exception:
            used_shap = False

    if not used_shap:
        r = permutation_importance(
            model, X_test, y_test, n_repeats=30, random_state=random_state, n_jobs=1
        )
        importances = r.importances_mean

    order = np.argsort(importances)[::-1]
    return {
        "model": model_name,
        "method": method,
        "shap_available": shap_available(),
        "features": [
            {"feature": FEATURE_NAMES[i], "importance": round(float(importances[i]), 4)}
            for i in order
        ],
        "note": EXPLORATORY_NOTE,
    }


def partial_dependence(
    feature: str,
    model_name: str = "Random Forest",
    grid_points: int = 20,
    random_state: int = 42,
) -> dict:
    """
    One-way partial dependence of the positive-class probability on `feature`.

    Returns the grid of feature values and the averaged predicted probability,
    ready to plot. Uses sklearn's model-agnostic partial_dependence.
    """
    from sklearn.inspection import partial_dependence as sk_partial_dependence

    if feature not in FEATURE_NAMES:
        raise ValueError(f"unknown feature: {feature!r}")

    # Partial dependence requires floating-point features (integer columns warn
    # now and will raise in scikit-learn 1.9).
    X, y = extract_features()
    X = X.astype(float)
    zoo = _model_zoo(random_state)
    if model_name not in zoo:
        raise ValueError(f"unknown model: {model_name!r}")
    model = zoo[model_name]
    model.fit(X, y)

    classes = list(getattr(model, "classes_", np.unique(y)))
    target_class = classes[0]
    try:
        result = sk_partial_dependence(
            model, X, [FEATURE_NAMES.index(feature)], grid_resolution=grid_points
        )
        grid = np.asarray(result["grid_values"][0])
        avg = np.asarray(result["average"])
        curve = avg[0] if avg.ndim > 1 else avg
    except Exception as e:  # noqa: BLE001
        return {
            "feature": feature,
            "model": model_name,
            "available": False,
            "reason": f"partial dependence unavailable: {e}",
            "note": EXPLORATORY_NOTE,
        }

    return {
        "feature": feature,
        "model": model_name,
        "available": True,
        "target_class": str(target_class),
        "grid": [round(float(v), 4) for v in grid],
        "average": [round(float(v), 4) for v in curve],
        "note": EXPLORATORY_NOTE,
    }


def _nested_config(model_name: str, random_state: int):
    from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier

    if model_name == "Random Forest":
        base = RandomForestClassifier(random_state=random_state, class_weight="balanced")
        grid = {"n_estimators": [50, 100], "max_depth": [None, 5, 10]}
    elif model_name == "Gradient Boosting":
        base = GradientBoostingClassifier(random_state=random_state)
        grid = {"n_estimators": [50, 100], "max_depth": [2, 3], "learning_rate": [0.05, 0.1]}
    else:
        raise ValueError(f"nested CV not configured for model: {model_name!r}")
    return base, grid


def nested_cv(
    model_name: str = "Random Forest",
    outer_splits: int = 5,
    inner_splits: int = 3,
    random_state: int = 42,
) -> dict:
    """
    Nested cross-validation: hyperparameters are tuned on an inner CV of each
    outer training fold, so the reported score is an unbiased estimate of the
    tuning *procedure* (not of a single over-optimistic model).

    Returns the outer-fold scores, a bootstrap CI, and the hyperparameters
    chosen when the grid is refit on all data (reported separately, for
    transparency — those are not out-of-sample).
    """
    from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_val_score

    X, y = extract_features()
    base, grid = _nested_config(model_name, random_state)

    outer = StratifiedKFold(n_splits=outer_splits, shuffle=True, random_state=random_state)
    inner = StratifiedKFold(n_splits=inner_splits, shuffle=True, random_state=random_state)
    # n_jobs=1: with only 54x11 samples, parallel-worker startup dominates the
    # actual fit cost (especially on Windows), so serial is faster end to end.
    search = GridSearchCV(base, grid, cv=inner, scoring="accuracy", n_jobs=1)

    scores = cross_val_score(search, X, y, cv=outer, scoring="accuracy")
    ci = bootstrap_confidence_interval(list(scores), n_bootstrap=2000, random_state=random_state)

    refit = GridSearchCV(base, grid, cv=inner, scoring="accuracy", n_jobs=1)
    refit.fit(X, y)

    return {
        "model": model_name,
        "outer_splits": outer_splits,
        "inner_splits": inner_splits,
        "mean_accuracy": round(float(scores.mean()), 4),
        "std_accuracy": round(float(scores.std()), 4),
        "ci_lower": ci["lower"],
        "ci_upper": ci["upper"],
        "per_fold": [round(float(s), 4) for s in scores],
        "refit_best_params": refit.best_params_,
        "note": EXPLORATORY_NOTE,
    }


def advanced_pipeline(random_state: int = 42) -> dict:
    """Aggregate the enhanced pipeline into a single JSON-serialisable report."""
    comparison = compare_models(random_state=random_state)
    best = comparison["models"][0]["model"] if comparison["models"] else "Random Forest"
    return {
        "model_comparison": comparison,
        "feature_selection": {
            method: select_features(method=method, random_state=random_state)
            for method in ("mutual_info", "l1", "rfe")
        },
        "interpretation": model_interpretation(best, random_state=random_state),
        "shap_available": shap_available(),
        "note": EXPLORATORY_NOTE,
    }
