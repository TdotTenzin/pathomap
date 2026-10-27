"""
Tests for the sequence-based feature module (real UniProt effector sequences).
"""

import pytest

from pathomap.sequence_analysis import (
    STANDARD_AA,
    amino_acid_composition,
    clean_sequence,
    dipeptide_composition,
    disorder_features,
    get_effector_sequence,
    load_effector_sequences,
    sequence_coverage,
    sequence_feature_names,
    sequence_features,
)

SOP_E = "MTKITLSLQNFRIQKQETTPLKEKSTEKTSLAKAILAVKN"


def test_clean_sequence_normalises_input():
    assert clean_sequence("  acdef\n ghik  ") == "ACDEFGHIK"


def test_clean_sequence_rejects_empty_and_nonstandard():
    with pytest.raises(ValueError):
        clean_sequence("   ")
    with pytest.raises(ValueError):
        clean_sequence("ACDExZ*")
    with pytest.raises(ValueError):
        clean_sequence(123)


def test_amino_acid_composition_sums_to_one():
    comp = amino_acid_composition(SOP_E)
    assert set(comp) == {f"aa_{aa}" for aa in STANDARD_AA}
    assert sum(comp.values()) == pytest.approx(1.0)


def test_dipeptide_composition_sums_to_one_and_has_400_features():
    comp = dipeptide_composition(SOP_E)
    assert len(comp) == 400
    assert sum(comp.values()) == pytest.approx(1.0)


def test_physicochemical_reference_values():
    # Kyte-Doolittle GRAVY of poly-alanine is exactly 1.8.
    assert sequence_features("A" * 20)["gravy"] == pytest.approx(1.8, abs=1e-6)


def test_charge_sign_matches_residue_class():
    pos = sequence_features("K" * 12)["net_charge_per_residue"]
    neg = sequence_features("D" * 12)["net_charge_per_residue"]
    assert pos == pytest.approx(1.0)
    assert neg == pytest.approx(-1.0)
    assert sequence_features("K" * 12)["charge_ph7"] > 0


def test_disorder_scale_ranks_promoters_above_order_promoters():
    poly_pro = disorder_features("P" * 40)["top_idp_mean"]
    poly_leu = disorder_features("L" * 40)["top_idp_mean"]
    assert poly_pro > poly_leu
    # TOP-IDP poly-proline propensity is near the top of the scale.
    assert disorder_features("P" * 40)["fold_index"] < 0


def test_feature_vector_satisfies_144_feature_goal():
    feats = sequence_features(SOP_E)
    assert len(feats) >= 144
    assert set(feats) == set(sequence_feature_names())
    # every value is a finite float
    for v in feats.values():
        assert isinstance(v, float)


def test_feature_vector_without_dipeptides_still_complete():
    feats = sequence_features(SOP_E, include_dipeptide=False)
    names = sequence_feature_names(include_dipeptide=False)
    assert set(feats) == set(names)
    assert not any(n.startswith("dp_") for n in feats)


def test_coverage_reflects_real_provenance():
    cov = sequence_coverage()
    assert cov["total"] == 250
    assert cov["resolved"] >= 190
    assert 0.0 < cov["fraction"] <= 1.0
    assert cov["reviewed"] > 0


def test_non_protein_effectors_are_never_mapped():
    # Glycolipids/polysaccharides have no UniProt sequence; inventing one would
    # be fabrication, so they must stay unmapped.
    for name in ["LAM", "LPS", "CPS", "Alginate", "K1 capsule"]:
        assert get_effector_sequence(name) == [], name


def test_every_resolved_mapping_is_a_gene_query():
    records = load_effector_sequences()
    assert records
    # Gene-only matching is what keeps precision high; free-text matching once
    # produced confidently wrong hits (e.g. LAM -> a sigma factor).
    assert all(r["matched_query"].startswith("gene:") for r in records)
    assert all(r["uniprot_accession"] for r in records)
    assert all(r["sequence"] for r in records)


def test_resolved_sequences_carry_accession_and_sequence():
    records = get_effector_sequence("SopE", "Salmonella enterica")
    assert len(records) == 1
    rec = records[0]
    assert rec["uniprot_accession"] == "Q8VSR1"
    assert rec["sequence"].startswith("M")
    assert set(rec["sequence"]) <= set(STANDARD_AA)


def test_missing_effector_returns_empty_list():
    # LAM is a Mycobacterium glycolipid, not a protein — it must not be invented.
    assert get_effector_sequence("LAM") == []


def test_pathogen_filter_narrows_results():
    any_match = get_effector_sequence("OmpA")
    one = get_effector_sequence("OmpA", "Acinetobacter baumannii")
    assert one
    assert len(one) <= len(any_match)
    assert all(r["pathogen_name"] == "Acinetobacter baumannii" for r in one)
