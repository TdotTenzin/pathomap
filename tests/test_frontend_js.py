"""Frontend tests for the Database section.

The logic behind ``js/database.js`` — schema normalisation, filtering, sorting,
CSV export and cell rendering — is pure and runs without a browser, so it is
exercised here through a headless Node harness. This is the only JavaScript in
the project with test coverage; everything else is rendered at runtime and is
covered only by the API tests indirectly.

Skipped when Node is unavailable.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
HARNESS = REPO_ROOT / "tests" / "frontend" / "database_checks.js"
FIGURE_HARNESS = REPO_ROOT / "tests" / "frontend" / "figure_export_checks.js"

# The harness loads the real frontend sources, so a missing or renamed file is a
# hard failure rather than a skip.
REQUIRED_SOURCES = [
    REPO_ROOT / "js" / "data.js",
    REPO_ROOT / "js" / "script.js",
    REPO_ROOT / "js" / "database.js",
]


@pytest.fixture(scope="module")
def node() -> str:
    exe = shutil.which("node")
    if exe is None:
        pytest.skip("Node.js is not installed")
    return exe


def test_frontend_sources_exist() -> None:
    """The database harness depends on these three files being present."""
    missing = [str(p.relative_to(REPO_ROOT)) for p in REQUIRED_SOURCES if not p.exists()]
    assert not missing, f"frontend source(s) missing: {missing}"


def test_harness_exists() -> None:
    assert HARNESS.exists(), f"frontend test harness missing: {HARNESS}"


def test_database_frontend_checks(node: str) -> None:
    """Run the headless database harness and surface any failed assertion."""
    result = subprocess.run(
        [node, str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        pytest.fail(
            "frontend database checks failed:\n"
            f"{result.stdout}\n{result.stderr}".strip()
        )


def test_figure_export_checks(node: str) -> None:
    """Run the headless figure-export harness and surface any failed assertion."""
    result = subprocess.run(
        [node, str(FIGURE_HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        pytest.fail(
            "figure-export checks failed:\n"
            f"{result.stdout}\n{result.stderr}".strip()
        )


@pytest.mark.parametrize(
    "script",
    [
        "js/data.js",
        "js/script.js",
        "js/charts.js",
        "js/network.js",
        "js/database.js",
        "js/ml-plots.js",
        "js/phylogeny.js",
        "js/data-loader.js",
        "js/figure-export.js",
        "js/notebooks.js",
    ],
)
def test_script_parses(node: str, script: str) -> None:
    """Every shipped script must be syntactically valid JS."""
    path = REPO_ROOT / script
    assert path.exists(), f"{script} is missing"
    result = subprocess.run(
        [node, "--check", str(path)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, f"{script} failed to parse:\n{result.stderr}"


def test_index_references_no_deleted_scripts() -> None:
    """The removed import/help layer must stay out of the shipped page."""
    html = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
    for removed in (
        "my-data.js",
        "csv-utils.js",
        "stats.js",
        "glossary.js",
        'id="my-data"',
        'id="help"',
        'id="toolkit"',
    ):
        assert removed not in html, f"index.html still references removed {removed}"


def test_api_routes_survive_frontend_removal() -> None:
    """The frontend no longer calls /api/mydata/*, so the API must not serve it."""
    api = (REPO_ROOT / "api" / "index.py").read_text(encoding="utf-8")
    assert "/api/mydata" not in api
