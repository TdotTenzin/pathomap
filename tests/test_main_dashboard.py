"""
Tests that the local-dev /dashboard reflects the live API surface.

The dashboard is generated from app.routes, so this guards against the endpoint
listing silently going stale (which it had done before).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

from api.index import app  # noqa: E402
from fastapi.routing import APIRoute  # noqa: E402
from main import _dashboard_html, _dashboard_sections  # noqa: E402


def _api_paths() -> set[str]:
    return {
        r.path
        for r in app.routes
        if isinstance(r, APIRoute) and r.path.startswith("/api")
    }


def test_sections_cover_every_api_route():
    listed = {path for rows in _dashboard_sections().values() for _, path, _ in rows}
    assert listed == _api_paths()


def test_dashboard_html_mentions_newer_endpoints():
    page = _dashboard_html()
    for path in (
        "/api/ml/advanced/pipeline",
        "/api/novel-findings",
        "/api/pathogens/{name}/literature",
        "/api/notebooks/{slug}",
        "/api/interactome/metrics",
    ):
        assert path in page, path
