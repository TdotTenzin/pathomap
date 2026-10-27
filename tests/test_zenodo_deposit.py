"""
Tests for the Zenodo deposit package (metadata files + build script).
"""

import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from prepare_zenodo_deposit import build_deposit, project_version  # noqa: E402


def test_zenodo_json_is_valid_and_has_required_fields():
    data = json.loads((ROOT / ".zenodo.json").read_text(encoding="utf-8"))
    for key in ("title", "description", "creators", "license", "upload_type"):
        assert key in data, key
    assert data["upload_type"] == "dataset"
    assert data["creators"] and data["creators"][0]["name"]


def test_citation_cff_has_required_keys():
    text = (ROOT / "CITATION.cff").read_text(encoding="utf-8")
    assert "cff-version:" in text
    assert "title:" in text
    assert "authors:" in text
    assert "license:" in text


def test_build_deposit_creates_zip_and_checksum(tmp_path):
    manifest = build_deposit(tmp_path)
    zip_path = Path(manifest["zip"])
    assert zip_path.exists()
    assert manifest["sha256"] and len(manifest["sha256"]) == 64
    assert (tmp_path / "SHA256SUMS").exists()

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    assert any(n.endswith("pathomap.db") for n in names)
    assert any(n.endswith("literature.csv") for n in names)
    assert any(n.endswith(".zenodo.json") for n in names)
    assert any(n.endswith("CITATION.cff") for n in names)
    # archive is rooted at a versioned folder
    assert all(n.startswith(f"pathomap-v{project_version()}/") for n in names)
