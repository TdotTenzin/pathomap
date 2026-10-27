"""
prepare_zenodo_deposit.py — Assemble the Zenodo deposit archive.

Bundles the curated dataset, the code needed to reproduce it, and the citation
metadata into a single versioned zip with a SHA-256 checksum, ready to upload to
Zenodo. No network access and no Zenodo account are required to build it.

Output:
    dist/pathomap-v<version>.zip
    dist/SHA256SUMS

Usage:
    python scripts/prepare_zenodo_deposit.py
    python scripts/prepare_zenodo_deposit.py --out-dir some/other/dir
"""

from __future__ import annotations

import argparse
import hashlib
import tomllib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Files/dirs included in the archive, relative to the repo root. Missing paths
# (e.g. an optional LICENSE) are skipped rather than failing the build.
INCLUDE = [
    "src/pathomap/data/pathomap.db",
    "src/pathomap/data/seed",
    "README.md",
    "CHANGELOG.md",
    "RESEARCH_PLAN.md",
    "ONBOARDING.md",
    "glossary.md",
    "CITATION.cff",
    ".zenodo.json",
    "pyproject.toml",
    "LICENSE",
]


def project_version() -> str:
    with (ROOT / "pyproject.toml").open("rb") as f:
        return tomllib.load(f)["project"]["version"]


def _iter_files() -> list[Path]:
    files: list[Path] = []
    for rel in INCLUDE:
        path = ROOT / rel
        if not path.exists():
            continue
        if path.is_dir():
            files.extend(sorted(p for p in path.rglob("*") if p.is_file()))
        else:
            files.append(path)
    return files


def build_deposit(out_dir: Path) -> dict:
    """Create the zip + checksum; return a manifest describing what was built."""
    version = project_version()
    stem = f"pathomap-v{version}"
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / f"{stem}.zip"

    files = _iter_files()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            arcname = f"{stem}/{path.relative_to(ROOT).as_posix()}"
            zf.write(path, arcname)

    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = out_dir / "SHA256SUMS"
    checksum_path.write_text(f"{digest}  {zip_path.name}\n", encoding="utf-8")

    return {
        "version": version,
        "zip": str(zip_path),
        "sha256": digest,
        "n_files": len(files),
        "files": [p.relative_to(ROOT).as_posix() for p in files],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-dir", type=Path, default=ROOT / "dist")
    args = ap.parse_args()

    manifest = build_deposit(args.out_dir)
    print(f"Built {manifest['zip']}")
    print(f"  version : {manifest['version']}")
    print(f"  files   : {manifest['n_files']}")
    print(f"  sha256  : {manifest['sha256']}")
    print("\nBefore publishing, replace the PLACEHOLDER creator/DOI in")
    print(".zenodo.json and CITATION.cff. See docs/zenodo-deposit.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
