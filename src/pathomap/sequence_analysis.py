"""
sequence_analysis.py — Sequence-based features for pathogen effectors.

The effector sequences are real UniProtKB entries resolved by
`scripts/fetch_effector_sequences.py` and cached in
`data/seed/effector_sequences.csv` with full provenance (accession, reviewed
status, organism, and the exact query that matched). Nothing here is synthetic:
`get_effector_sequence` returns records that carry the accession they came from.

Feature groups (all computed from the primary amino-acid sequence):
  * amino-acid composition (20)
  * dipeptide composition (400, optional — this is what pushes the vector past
    144 features as the research plan requires)
  * physicochemical properties via Biopython's ProtParam (Kyte-Doolittle GRAVY,
    isoelectric point, aromaticity, instability index, flexibility, secondary
    structure fractions, molecular weight)
  * charge distribution (net charge at several pH values, basic/acidic/
    aromatic/polar/hydrophobic fractions)
  * disorder propensity (TOP-IDP mean, FoldIndex; both from the literature)

References:
  - Kyte & Doolittle (1982) J. Mol. Biol. 157:105 — hydropathy scale.
  - Campen et al. (2008) Protein Sci. 17:1035 — TOP-IDP disorder scale.
  - Prilusky et al. (2005) Bioinformatics 21:3435 — FoldIndex.
"""

from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

from Bio.SeqUtils.ProtParam import ProteinAnalysis

STANDARD_AA = "ACDEFGHIKLMNPQRSTVWY"

# Kyte & Doolittle (1982) hydropathy scale.
KYTE_DOOLITTLE = {
    "A": 1.8, "R": -4.5, "N": -3.5, "D": -3.5, "C": 2.5,
    "Q": -3.5, "E": -3.5, "G": -0.4, "H": -3.2, "I": 4.5,
    "L": 3.8, "K": -3.9, "M": 1.9, "F": 2.8, "P": -1.6,
    "S": -0.8, "T": -0.7, "W": -0.9, "Y": -1.3, "V": 4.2,
}

# TOP-IDP disorder propensity scale (Campen et al. 2008). Positive = disorder.
TOP_IDP = {
    "A": 0.060, "R": 0.180, "N": 0.007, "D": 0.192, "C": -0.800,
    "Q": 0.318, "E": 0.736, "G": 0.166, "H": -0.163, "I": -0.486,
    "L": -0.326, "K": 0.586, "M": -0.347, "F": -0.697, "P": 0.987,
    "S": 0.181, "T": -0.091, "W": -0.884, "Y": -0.510, "V": -0.284,
}

BASIC = set("KRH")
ACIDIC = set("DE")
AROMATIC = set("FWY")
POLAR_UNCHARGED = set("STNQCY")

DISORDER_WINDOW = 20

_SEQUENCE_CSV = Path(__file__).resolve().parent / "data" / "seed" / "effector_sequences.csv"


def clean_sequence(sequence: str) -> str:
    """Upper-case a sequence, strip whitespace/digits, and validate residues.

    Raises ValueError if any residue is not one of the 20 standard amino acids,
    so downstream tools (and callers) never silently process garbage.
    """
    if not isinstance(sequence, str):
        raise ValueError("sequence must be a string")
    cleaned = "".join(ch for ch in sequence.upper() if not ch.isspace())
    if not cleaned:
        raise ValueError("sequence is empty")
    bad = sorted({ch for ch in cleaned if ch not in STANDARD_AA})
    if bad:
        raise ValueError(
            f"sequence contains non-standard residues: {''.join(bad)} "
            f"(only {STANDARD_AA} are supported)"
        )
    return cleaned


def _mean(values):
    return sum(values) / len(values) if values else 0.0


# ---------------------------------------------------------------------------
# Feature groups
# ---------------------------------------------------------------------------


def amino_acid_composition(seq: str) -> dict[str, float]:
    """Fraction of each of the 20 standard residues (sums to 1)."""
    n = len(seq)
    return {f"aa_{aa}": seq.count(aa) / n for aa in STANDARD_AA}


def dipeptide_composition(seq: str) -> dict[str, float]:
    """Fraction of all adjacent residue pairs (20x20 = 400 features)."""
    if len(seq) < 2:
        return {f"dp_{a}{b}": 0.0 for a in STANDARD_AA for b in STANDARD_AA}
    counts: dict[str, int] = {}
    for i in range(len(seq) - 1):
        pair = seq[i : i + 2]
        counts[pair] = counts.get(pair, 0) + 1
    total = len(seq) - 1
    return {
        f"dp_{a}{b}": counts.get(a + b, 0) / total
        for a in STANDARD_AA
        for b in STANDARD_AA
    }


def physicochemical_features(seq: str) -> dict[str, float]:
    """Hydropathy and Biopython ProtParam descriptors."""
    analysis = ProteinAnalysis(seq)
    helix, turn, sheet = analysis.secondary_structure_fraction()
    kd = [KYTE_DOOLITTLE[aa] for aa in seq]
    flexibility = analysis.flexibility()
    return {
        "length": float(len(seq)),
        "molecular_weight": float(analysis.molecular_weight()),
        "isoelectric_point": float(analysis.isoelectric_point()),
        "gravy": float(analysis.gravy()),
        "aromaticity": float(analysis.aromaticity()),
        "instability_index": float(analysis.instability_index()),
        "mean_flexibility": float(_mean(flexibility)),
        "helix_fraction": float(helix),
        "turn_fraction": float(turn),
        "sheet_fraction": float(sheet),
        "kd_mean": float(_mean(kd)),
        "kd_std": float((sum((x - _mean(kd)) ** 2 for x in kd) / len(kd)) ** 0.5),
        "kd_min": float(min(kd)),
        "kd_max": float(max(kd)),
        "hydrophobic_fraction": sum(1 for x in kd if x > 0) / len(kd),
    }


def charge_features(seq: str) -> dict[str, float]:
    """Net charge at several pH values and residue-class fractions."""
    n = len(seq)
    analysis = ProteinAnalysis(seq)
    net = (sum(seq.count(a) for a in "KR") - sum(seq.count(a) for a in "DE")) / n
    return {
        "charge_ph7": float(analysis.charge_at_pH(7.0)),
        "charge_ph5": float(analysis.charge_at_pH(5.0)),
        "charge_ph8": float(analysis.charge_at_pH(8.0)),
        "net_charge_per_residue": float(net),
        "basic_fraction": sum(seq.count(a) for a in BASIC) / n,
        "acidic_fraction": sum(seq.count(a) for a in ACIDIC) / n,
        "aromatic_fraction": sum(seq.count(a) for a in AROMATIC) / n,
        "polar_uncharged_fraction": sum(seq.count(a) for a in POLAR_UNCHARGED) / n,
        "arginine_fraction": seq.count("R") / n,
        "lysine_fraction": seq.count("K") / n,
    }


def _window_means(values: list[float], window: int) -> list[float]:
    if len(values) <= window:
        return [_mean(values)] if values else []
    return [
        _mean(values[i : i + window])
        for i in range(0, len(values) - window + 1)
    ]


def disorder_features(seq: str) -> dict[str, float]:
    """Intrinsic disorder propensity (TOP-IDP) and FoldIndex (Prilusky 2005)."""
    n = len(seq)
    top = [TOP_IDP[aa] for aa in seq]
    top_mean = _mean(top)
    windows = _window_means(top, DISORDER_WINDOW)
    disorder_fraction = (
        sum(1 for w in windows if w > 0.0) / len(windows) if windows else 0.0
    )
    max_window = max(windows) if windows else 0.0
    argmax = windows.index(max_window) / max(1, len(windows) - 1) if windows else 0.0

    # FoldIndex = 2.785*H - |R| - 1.151, with H the normalised hydropathy and R
    # the mean net charge per residue. Values < 0 indicate a disordered region.
    kd_norm = [(KYTE_DOOLITTLE[aa] + 4.5) / 9.0 for aa in seq]
    mean_charge = (
        sum(seq.count(a) for a in "KR") - sum(seq.count(a) for a in "DE")
    ) / n
    fold_index = 2.785 * _mean(kd_norm) - abs(mean_charge) - 1.151

    return {
        "top_idp_mean": float(top_mean),
        "disorder_fraction": float(disorder_fraction),
        "max_disorder_window": float(max_window),
        "max_disorder_window_pos": float(argmax),
        "fold_index": float(fold_index),
    }


# ---------------------------------------------------------------------------
# Feature vector assembly
# ---------------------------------------------------------------------------


def sequence_features(sequence: str, include_dipeptide: bool = True) -> dict[str, float]:
    """Compute the full feature vector for one amino-acid sequence.

    With dipeptides (the default) the vector has 450+ features, satisfying the
    research plan's "144+ sequence features" objective.
    """
    seq = clean_sequence(sequence)
    features: dict[str, float] = {}
    features.update(amino_acid_composition(seq))
    if include_dipeptide:
        features.update(dipeptide_composition(seq))
    features.update(physicochemical_features(seq))
    features.update(charge_features(seq))
    features.update(disorder_features(seq))
    return {k: round(float(v), 6) for k, v in features.items()}


def sequence_feature_names(include_dipeptide: bool = True) -> list[str]:
    """Names of the features produced by `sequence_features`, in order."""
    names = [f"aa_{aa}" for aa in STANDARD_AA]
    if include_dipeptide:
        names += [f"dp_{a}{b}" for a in STANDARD_AA for b in STANDARD_AA]
    names += [
        "length", "molecular_weight", "isoelectric_point", "gravy",
        "aromaticity", "instability_index", "mean_flexibility",
        "helix_fraction", "turn_fraction", "sheet_fraction", "kd_mean",
        "kd_std", "kd_min", "kd_max", "hydrophobic_fraction",
    ]
    names += [
        "charge_ph7", "charge_ph5", "charge_ph8", "net_charge_per_residue",
        "basic_fraction", "acidic_fraction", "aromatic_fraction",
        "polar_uncharged_fraction", "arginine_fraction", "lysine_fraction",
    ]
    names += [
        "top_idp_mean", "disorder_fraction", "max_disorder_window",
        "max_disorder_window_pos", "fold_index",
    ]
    return names


# ---------------------------------------------------------------------------
# Resolved effector sequences (real UniProt entries)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def load_effector_sequences() -> tuple[dict, ...]:
    """Load the resolved effector sequences cache (mapped rows only)."""
    if not _SEQUENCE_CSV.exists():
        return ()
    with _SEQUENCE_CSV.open("r", newline="", encoding="utf-8") as f:
        records = []
        for row in csv.DictReader(f):
            if row.get("sequence"):
                row["reviewed"] = row.get("reviewed") == "True"
                row["sequence_length"] = int(row.get("sequence_length") or 0)
                records.append(row)
        return tuple(records)


def get_effector_sequence(
    effector_name: str, pathogen: str | None = None
) -> list[dict]:
    """Return resolved sequence records for an effector (name, optional pathogen).

    Matching is case-insensitive. Returns an empty list when the effector has no
    resolved UniProt sequence (e.g. polysaccharide/serotype entries), so callers
    can report the gap honestly instead of inventing a sequence.
    """
    name = effector_name.strip().lower()
    pathogen_l = pathogen.strip().lower() if pathogen else None
    out = []
    for rec in load_effector_sequences():
        if rec["effector_name"].strip().lower() != name:
            continue
        if pathogen_l and rec["pathogen_name"].strip().lower() != pathogen_l:
            continue
        out.append(rec)
    return out


def sequence_coverage() -> dict:
    """How many curated effectors have a real sequence, for honest reporting."""
    if not _SEQUENCE_CSV.exists():
        return {"resolved": 0, "total": 0, "fraction": 0.0}
    total = resolved = reviewed = 0
    with _SEQUENCE_CSV.open("r", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            total += 1
            if row.get("sequence"):
                resolved += 1
                if row.get("reviewed") == "True":
                    reviewed += 1
    return {
        "resolved": resolved,
        "unmapped": total - resolved,
        "reviewed": reviewed,
        "total": total,
        "fraction": round(resolved / total, 4) if total else 0.0,
    }
