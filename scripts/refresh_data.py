"""
refresh_data.py — Automated data refresh pipeline.

Pulls the latest curated host-pathogen interaction data from public
databases and rebuilds the local SQLite database.

Currently supported sources:
  - PHI-base (Pathogen-Host Interaction database) via EBI API
  - UniProt via REST API
  - IntAct molecular interaction database via EBI API

Usage:
    python scripts/refresh_data.py [--rebuild-only] [--fetch-all]

Examples:
    # Regenerate seed data and rebuild DB only (no external fetch)
    python scripts/refresh_data.py --rebuild-only

    # Fetch from all sources then rebuild
    python scripts/refresh_data.py --fetch-all
"""

import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

# Add src to path
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))

SEED_DIR = pathlib.Path(__file__).resolve().parent.parent / "src" / "pathomap" / "data" / "seed"
DB_DIR = pathlib.Path(__file__).resolve().parent.parent / "src" / "pathomap" / "data"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")


# ---------------------------------------------------------------------------
# PHI-base fetch (EBI API)
# ---------------------------------------------------------------------------

PHIBASE_URL = "https://www.ebi.ac.uk/QuickGO/services/annotation/search?includeFields=goName&limit=100&taxonId=2"


def fetch_phibase_annotations():
    """Fetch pathogen-host interaction annotations from EBI QuickGO."""
    log("Fetching PHI-base annotations from EBI QuickGO...")
    try:
        req = urllib.request.Request(PHIBASE_URL, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        log(f"  Retrieved {len(data.get('results', []))} annotations")
        return data.get("results", [])
    except Exception as e:
        log(f"  WARNING: Could not fetch PHI-base data: {e}")
        return []


# ---------------------------------------------------------------------------
# UniProt fetch
# ---------------------------------------------------------------------------

UNIPROT_URL = (
    "https://rest.uniprot.org/uniprotkb/search?"
    "query=(taxonomy_id:2)%20AND%20(reviewed:true)&"
    "fields=accession,id,protein_name,gene_names,organism_name,cc_function&"
    "format=json&size=100"
)


def fetch_uniprot_pathogens():
    """Fetch curated bacterial proteins from UniProt."""
    log("Fetching UniProt bacterial proteins...")
    try:
        req = urllib.request.Request(UNIPROT_URL, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        log(f"  Retrieved {len(data.get('results', []))} proteins")
        return data.get("results", [])
    except Exception as e:
        log(f"  WARNING: Could not fetch UniProt data: {e}")
        return []


# ---------------------------------------------------------------------------
# IntAct fetch
# ---------------------------------------------------------------------------

INTACT_URL = "https://www.ebi.ac.uk/intact/api/ws/interaction?speciesFilterA=9606&speciesFilterB=2&pageSize=50"


def fetch_intact_interactions():
    """Fetch human-pathogen molecular interactions from IntAct."""
    log("Fetching IntAct human-pathogen interactions...")
    try:
        req = urllib.request.Request(INTACT_URL, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        log(f"  Retrieved {len(data.get('payload', {}).get('interactions', []))} interactions")
        return data
    except Exception as e:
        log(f"  WARNING: Could not fetch IntAct data: {e}")
        return {}


# ---------------------------------------------------------------------------
# Rebuild from seed
# ---------------------------------------------------------------------------


def rebuild_database():
    """Regenerate seed data and rebuild the SQLite database."""
    log("Regenerating seed data...")
    gen_script = SEED_DIR / "generate_seed_data.py"
    if gen_script.exists():
        import subprocess
        result = subprocess.run(
            [sys.executable, str(gen_script)],
            capture_output=True, text=True,
        )
        print(result.stdout)
        if result.returncode != 0:
            log(f"ERROR: Seed generation failed: {result.stderr}")
            return False
    else:
        log(f"  No generator found at {gen_script}, using existing CSVs")

    log("Rebuilding database...")
    build_script = DB_DIR / "build_db.py"
    if build_script.exists():
        import subprocess
        result = subprocess.run(
            [sys.executable, str(build_script)],
            capture_output=True, text=True,
        )
        print(result.stdout)
        if result.returncode != 0:
            log(f"ERROR: DB build failed: {result.stderr}")
            return False
    else:
        log(f"  Build script not found at {build_script}")
        return False

    log("Database refresh complete!")
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Host-Pathogen data refresh pipeline")
    parser.add_argument("--rebuild-only", action="store_true", help="Regenerate seed and rebuild DB without fetching")
    parser.add_argument("--fetch-all", action="store_true", help="Fetch from public databases then rebuild")
    args = parser.parse_args()

    if not args.rebuild_only and not args.fetch_all:
        print("Usage: python scripts/refresh_data.py [--rebuild-only | --fetch-all]")
        sys.exit(1)

    if args.fetch_all:
        log("=== FETCHING FROM PUBLIC DATABASES ===")
        phibase = fetch_phibase_annotations()
        uniprot = fetch_uniprot_pathogens()
        intact = fetch_intact_interactions()
        # Save fetched data for review
        output_dir = pathlib.Path(__file__).resolve().parent / "fetched"
        output_dir.mkdir(exist_ok=True)
        with open(output_dir / "phibase.json", "w") as f:
            json.dump(phibase, f, indent=2)
        with open(output_dir / "uniprot.json", "w") as f:
            json.dump(uniprot, f, indent=2)
        with open(output_dir / "intact.json", "w") as f:
            json.dump(intact, f, indent=2)
        log(f"Saved raw data to {output_dir}/")
        log("\nNOTE: Review fetched data and update seed CSVs manually before rebuilding.")
        log("Use --rebuild-only to regenerate DB from current seed CSVs.")

    if args.rebuild_only:
        log("\n=== REBUILDING FROM SEED DATA ===")
        success = rebuild_database()
        if success:
            # Verify
            import sqlite3
            db_path = DB_DIR / "pathomap.db"
            con = sqlite3.connect(str(db_path))
            con.row_factory = sqlite3.Row
            n_pathogens = con.execute("SELECT COUNT(*) FROM pathogens").fetchone()[0]
            n_effectors = con.execute("SELECT COUNT(*) FROM effectors").fetchone()[0]
            n_proteins = con.execute("SELECT COUNT(*) FROM host_proteins").fetchone()[0]
            con.close()
            log(f"Verified: {n_pathogens} pathogens, {n_effectors} effectors, {n_proteins} host proteins")
        else:
            log("ERROR: Rebuild failed")
            sys.exit(1)


if __name__ == "__main__":
    main()
