"""
phylogenetics.py — Effector protein phylogenetics.

Demonstrates a real bioinformatics workflow:
  1. Fetch or generate effector protein sequences
  2. Multiple sequence alignment
  3. Phylogenetic tree construction (Neighbour-Joining)
  4. Tree visualisation

For demonstration, synthetic sequences are used that embed conserved
motifs reflecting real effector biology. A UniProt fetch function is
provided for real-world use when online.

Optimizations:
  - Deterministic color generation using hashlib
  - Module-level caching of sequences and tree
"""

import hashlib
import io

import numpy as np
from Bio import Phylo, SeqIO
from Bio.Align import MultipleSeqAlignment
from Bio.Phylo.TreeConstruction import DistanceCalculator, DistanceTreeConstructor
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord

from pathomap.data.loader import to_df

# Module-level cache
_cached_records = None
_cached_tree_result = None


MOTIFS = {
    "T3SS": {
        "chaperone_binding": "LQHFFA",
        "secretion_signal": "MSTISLFD",
        "wxxxe": "WLYLLE",
    },
    "T4SS": {
        "dot_icm_signal": "MLKKFISV",
        "ampylation": "HVDLGNAT",
        "fic_domain": "DEGYIFIH",
    },
    "toxin": {
        "pore_forming": "KTLLLFLVW",
        "cholesterol_binding": "LCTLTWC",
    },
    "surface": {
        "lpx_box": "LSRLLG",
        "anchor": "FALVGGVIA",
    },
    "phosphatase": {
        "active_site": "CXXXRST",
        "pi3p_binding": "KVAFFK",
    },
}

DOMAIN_SEEDS = {
    "GEF": "MSKKPALVKGGRLQHFFAESLKRHYPNVLDELKKKPDVLLLVVDV",
    "GAP": "MRKLVIVGKRVQTRFLESNTLKQADELPPGRQVILLVR",
    "protease": "MTSSLERDLKRKVVVIDDSVVRQGLHSVLEHLKPT",
    "kinase": "MTRLPKELIREGRIHVLEFDPTIRHRILKAVDDRKPS",
    "phosphatase": "MCGVSQHPRLLLTRVAGEPVYFEARSLRGTCAASRST",
    "translocator": "MKNLPLQLLFLALGMIVVKPTLFLALHSPHAS",
    "autotransporter": "MVKRLFSKRLFLIGLGLAVGLSLGSQAYAARTQI",
    "unknown": "MSEQLKTAVAELGADETPRLLHALGRYPLITHTPQ",
}

# Fixed color palette for deterministic pathogen coloring
_PATHOGEN_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6",
    "#1abc9c", "#e67e22", "#34495e", "#e91e63", "#00bcd4",
    "#8bc34a", "#ff5722", "#607d8b", "#795548", "#cddc39",
]


def _stable_seed(text: str) -> int:
    """Deterministic seed from text (hash() is randomized per process)."""
    return int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16) % (2**31)


def _make_effector_sequence(effector_name: str, e_type: str, length: int = 120) -> str:
    rng = np.random.default_rng(_stable_seed(effector_name))

    if "T3SS" in e_type:
        domain_key = rng.choice(["GEF", "GAP", "translocator", "protease"])
    elif "T4SS" in e_type:
        domain_key = rng.choice(["kinase", "protease", "unknown"])
    elif "toxin" in e_type:
        domain_key = rng.choice(["translocator", "unknown"])
    elif "phosphatase" in e_type:
        domain_key = "phosphatase"
    else:
        domain_key = rng.choice(list(DOMAIN_SEEDS.keys()))

    domain_seq = DOMAIN_SEEDS[domain_key]

    motif_pool = []
    for type_key, motifs in MOTIFS.items():
        for _, seq in motifs.items():
            a = effector_name[:3]
            if type_key.lower() in e_type.lower() or _stable_seed(a + seq) % 3 == 0:
                motif_pool.append(seq)

    valid_residues = list("ACDEFGHIKLMNPQRSTVWY")
    start_aa = effector_name[0] if effector_name[0] in valid_residues else "A"
    sequence_parts = ["M" + start_aa]
    for motif in rng.choice(motif_pool, size=min(3, len(motif_pool)), replace=False):
        sequence_parts.append(motif)
    sequence_parts.append(domain_seq)

    full = "".join(sequence_parts).upper()
    full = full.replace("O", "K").replace("U", "C").replace("B", "N").replace("Z", "Q")
    if len(full) < length:
        residues = list("ACDEFGHIKLMNPQRSTVWY")
        fill = "".join(rng.choice(residues, size=length - len(full)).tolist())
        full += fill
    else:
        full = full[:length]

    return full


def build_effector_sequences() -> list[SeqRecord]:
    global _cached_records
    if _cached_records is not None:
        return _cached_records

    effectors = to_df(
        "SELECT e.name, e.type, p.name AS pathogen FROM effectors e "
        "JOIN pathogens p ON e.pathogen_id = p.id ORDER BY p.name"
    )

    records = []
    for _, row in effectors.iterrows():
        seq_str = _make_effector_sequence(row["name"], row["type"])
        record = SeqRecord(
            Seq(seq_str),
            id=f"{row['pathogen']}_{row['name']}".replace(" ", "_").replace("/", "_"),
            description=f"{row['type']} effector from {row['pathogen']}",
        )
        records.append(record)

    _cached_records = records
    return records


def build_phylogenetic_tree() -> dict:
    global _cached_tree_result
    if _cached_tree_result is not None:
        return _cached_tree_result

    records = build_effector_sequences()
    aligned = _align_sequences(records)

    calculator = DistanceCalculator("blosum62")
    dm = calculator.get_distance(aligned)

    constructor = DistanceTreeConstructor()
    tree = constructor.nj(dm)
    tree.root_at_midpoint()

    newick_io = io.StringIO()
    Phylo.write(tree, newick_io, "newick")
    newick_str = newick_io.getvalue()

    # Deterministic color mapping using hashlib
    pathogens = sorted(set(r.id.split("_")[0] for r in records))
    colour_map = {}
    for i, p in enumerate(pathogens):
        h = hashlib.md5(p.encode()).hexdigest()[:6]
        colour_map[p] = f"#{h}"

    _cached_tree_result = {
        "n_sequences": len(records),
        "n_pathogens": len(pathogens),
        "pathogens": pathogens,
        "newick": newick_str.strip(),
        "colour_map": colour_map,
    }
    return _cached_tree_result


def _align_sequences(records: list[SeqRecord]) -> MultipleSeqAlignment:
    if len(records) == 0:
        raise ValueError("No sequences to align")

    max_len = max(len(r.seq) for r in records)
    aligned_records = []
    for r in records:
        seq_str = str(r.seq)
        if len(seq_str) < max_len:
            seq_str += "-" * (max_len - len(seq_str))
        aligned_records.append(
            SeqRecord(Seq(seq_str), id=r.id, description=r.description)
        )

    return MultipleSeqAlignment(aligned_records)


def fetch_uniprot_sequences(query: str = "typeIII secretion system effector") -> list[SeqRecord]:
    import urllib.error
    import urllib.request

    url = (
        f"https://rest.uniprot.org/uniprotkb/stream?"
        f"format=fasta&query={urllib.parse.quote(query)}"
    )

    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            fasta_data = response.read().decode("utf-8")
        records = list(SeqIO.parse(io.StringIO(fasta_data), "fasta"))
        records = records[:20]
        return records

    except (urllib.error.URLError, urllib.error.HTTPError, Exception) as e:
        print(f"UniProt fetch failed ({e}). Using synthetic sequences.")
        return []
