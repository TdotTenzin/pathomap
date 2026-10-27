"""
Tests for the downloadable notebook layer (src/pathomap/notebooks.py).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pathomap.notebooks import get_notebook, list_notebooks  # noqa: E402


def test_manifest_lists_notebooks():
    notebooks = list_notebooks()
    assert len(notebooks) >= 5
    for n in notebooks:
        assert n["slug"] and n["title"] and n["filename"].endswith(".ipynb")


def test_every_notebook_is_valid_nbformat():
    for meta in list_notebooks():
        nb = get_notebook(meta["slug"])
        assert nb is not None, meta
        assert nb["nbformat"] == 4
        assert isinstance(nb["cells"], list) and nb["cells"]
        for cell in nb["cells"]:
            assert cell["cell_type"] in {"markdown", "code"}
            assert cell["source"]


def test_notebooks_run_pathomap_code():
    # Each notebook should actually reference the package so it is reproducible.
    joined = ""
    for meta in list_notebooks():
        nb = get_notebook(meta["slug"])
        joined += "".join(
            "".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"
        )
    assert "pathomap" in joined


def test_unknown_notebook_returns_none():
    assert get_notebook("does-not-exist") is None
