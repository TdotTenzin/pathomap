#!/usr/bin/env python3
"""Run the PathoMap build stages in dependency order.

Stages are called in-process so a failure stops the pipeline immediately and
so every stage exposes the same ``build(**opts)`` interface. A manifest of
output hashes is written after a successful build; ``--check`` uses it to
report artifacts that are missing or out of date without writing anything.

Usage:
    python scripts/build_all.py
    python scripts/build_all.py --check
    python scripts/build_all.py --only interactions
    python scripts/build_all.py --no-network --strict
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

sys.path.insert(0, str(Path(__file__).parent))

import analyze_interactions
import build_effectors_host_proteins
import build_interactions
import build_pathogens
from build_common import utc_now
from io_utils import no_writes, read_json, write_bytes, write_json_atomic, writes_enabled

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MANIFEST_PATH = DATA_DIR / "build-manifest.json"
MANIFEST_VERSION = "1.0"


@dataclass(frozen=True)
class Stage:
    """One pipeline stage and the artifacts it owns."""

    name: str
    outputs: tuple[Path, ...]
    run: Callable[..., int]


STAGES: tuple[Stage, ...] = (
    Stage(
        "pathogens",
        (
            DATA_DIR / "pathomap-dataset.json",
            DATA_DIR / "sample-dataset.json",
            DATA_DIR / "pathomap.db",
            DATA_DIR / "schema.sql",
            DATA_DIR / "schema" / "pathogens.schema.json",
            DATA_DIR / "sources" / "reference_ids.json",
        ),
        build_pathogens.build,
    ),
    Stage(
        "effectors",
        (
            DATA_DIR / "pathomap-dataset.json",
            DATA_DIR / "sample-dataset.json",
            DATA_DIR / "derived" / "effector_features.json",
            DATA_DIR / "pathomap.db",
            DATA_DIR / "schema.sql",
            DATA_DIR / "sources" / "effector_ids.json",
            DATA_DIR / "sources" / "host_target_ids.json",
            DATA_DIR / "sources" / "reference_ids.json",
        ),
        build_effectors_host_proteins.build,
    ),
    Stage(
        "interactions",
        (
            DATA_DIR / "pathomap-dataset.json",
            DATA_DIR / "sample-dataset.json",
            DATA_DIR / "pathomap.db",
            DATA_DIR / "schema.sql",
            DATA_DIR / "sources" / "interaction_ids.json",
            DATA_DIR / "sources" / "interaction_evidence_ids.json",
        ),
        build_interactions.build,
    ),
    Stage(
        "analysis",
        (DATA_DIR / "derived" / "interaction_analysis.json",),
        analyze_interactions.build,
    ),
)


def file_state(path: Path) -> dict[str, object] | None:
    """Return the size and hash of a file, or None when it is absent."""
    if not path.is_file():
        return None
    payload = path.read_bytes()
    return {"size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}


def stage_state(stage: Stage) -> dict[str, object]:
    state: dict[str, object] = {}
    for path in stage.outputs:
        label = str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)
        state[label] = file_state(path)
    return state


def backup_outputs(stages: Iterable[Stage]) -> dict[Path, bytes | None]:
    """Snapshot every artifact before a build so failures can be rolled back."""
    backup: dict[Path, bytes | None] = {}
    for stage in stages:
        for path in stage.outputs:
            backup.setdefault(path, path.read_bytes() if path.is_file() else None)
    return backup


def restore_outputs(backup: dict[Path, bytes | None]) -> None:
    """Restore a pre-build snapshot, removing artifacts that did not exist."""
    if not writes_enabled():
        return
    for path, payload in backup.items():
        if payload is None:
            if path.exists():
                path.unlink()
        else:
            write_bytes(path, payload)


def read_manifest(path: Path) -> dict:
    if not path.exists():
        return {}
    payload = read_json(path)
    return payload if isinstance(payload, dict) else {}


def stage_kwargs(
    stage_name: str,
    *,
    check: bool,
    refresh: bool,
    no_network: bool,
    enrich_effectors: bool,
    strict: bool,
) -> dict:
    """Translate shared CLI options into a stage's build() keyword arguments."""
    if stage_name == "analysis":
        return {"check": check, "strict": strict}
    if stage_name == "pathogens":
        return {"check": check, "refresh": refresh, "no_network": no_network}
    if stage_name == "effectors":
        return {
            "check": check,
            "refresh": refresh,
            "no_network": no_network,
            "enrich_effectors": enrich_effectors,
        }
    return {"check": check}


def stale_outputs(stage: Stage, manifest: dict) -> list[str]:
    """List outputs missing or different from the recorded manifest state."""
    recorded = manifest.get("stages", {}).get(stage.name, {})
    current = stage_state(stage)
    stale: list[str] = []
    for label, state in current.items():
        if label not in recorded:
            stale.append(f"{label}: not recorded")
        elif recorded[label] != state:
            stale.append(f"{label}: changed or missing on disk")
    return stale


def run_pipeline(
    *,
    check: bool = False,
    refresh: bool = False,
    no_network: bool = False,
    enrich_effectors: bool = False,
    strict: bool = False,
    only: str | None = None,
    manifest_path: Path = MANIFEST_PATH,
    stages: Iterable[Stage] = STAGES,
) -> int:
    """Run (or validate) the selected stages. Returns a process exit code."""
    selected = list(stages)
    if only:
        selected = [stage for stage in selected if stage.name == only]
        if not selected:
            print(f"error: unknown stage {only!r}", file=sys.stderr)
            return 2

    backup = backup_outputs(selected) if not check else {}
    manifest = read_manifest(manifest_path)
    recorded_stages = manifest.get("stages", {}) if manifest else {}
    stale: list[str] = []
    warned_missing_manifest = False

    for stage in selected:
        kwargs = stage_kwargs(
            stage.name,
            check=check,
            refresh=refresh,
            no_network=no_network,
            enrich_effectors=enrich_effectors,
            strict=strict,
        )
        print(f"==> {stage.name}")
        try:
            if check:
                with no_writes():
                    code = stage.run(**kwargs)
            else:
                code = stage.run(**kwargs)
        except Exception as exc:
            restore_outputs(backup)
            print(f"error: stage {stage.name} raised {exc}; artifacts restored", file=sys.stderr)
            return 1
        if code:
            restore_outputs(backup)
            print(f"error: stage {stage.name} failed with exit code {code}; artifacts restored", file=sys.stderr)
            return code
        if check:
            if not recorded_stages:
                if not warned_missing_manifest:
                    print(f"warning: no manifest at {manifest_path}; cannot verify freshness", file=sys.stderr)
                    warned_missing_manifest = True
            else:
                stale.extend(f"{stage.name}: {item}" for item in stale_outputs(stage, manifest))

    if check:
        if stale:
            print(f"error: {len(stale)} stale artifact(s):", file=sys.stderr)
            for item in stale:
                print(f"  - {item}", file=sys.stderr)
            return 1
        if recorded_stages:
            print("artifacts: up to date")
        return 0

    updated = read_manifest(manifest_path)
    updated.setdefault("schema_version", MANIFEST_VERSION)
    updated["stages"] = dict(updated.get("stages", {}))
    for stage in selected:
        updated["stages"][stage.name] = stage_state(stage)
    updated["built_at"] = utc_now()
    write_json_atomic(manifest_path, updated)
    print(f"wrote {manifest_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without writing; report stale artifacts")
    parser.add_argument("--refresh", action="store_true", help="ignore cached API responses")
    parser.add_argument("--no-network", action="store_true", help="use only cached API responses")
    parser.add_argument("--enrich-effectors", action="store_true", help="enrich effectors as well as host proteins")
    parser.add_argument("--strict", action="store_true", help="fail when analysis reports issues")
    parser.add_argument("--only", choices=[stage.name for stage in STAGES], help="run a single stage")
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH, help="build manifest path")
    args = parser.parse_args(argv)
    return run_pipeline(
        check=args.check,
        refresh=args.refresh,
        no_network=args.no_network,
        enrich_effectors=args.enrich_effectors,
        strict=args.strict,
        only=args.only,
        manifest_path=args.manifest,
    )


if __name__ == "__main__":
    raise SystemExit(main())
