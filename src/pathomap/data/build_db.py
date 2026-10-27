import csv
import pathlib
import sqlite3

SEED_DIR = pathlib.Path(__file__).parent / "seed"
DB_PATH = pathlib.Path(__file__).parent / "pathomap.db"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS pathogens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    species TEXT,
    gram_stain TEXT,
    strategy TEXT,
    description TEXT,
    reference TEXT
);

CREATE TABLE IF NOT EXISTS host_proteins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    full_name TEXT,
    function TEXT,
    localization TEXT,
    pathway TEXT,
    uniprot_id TEXT
);

CREATE TABLE IF NOT EXISTS maturation_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    stage_order INTEGER NOT NULL,
    time_range TEXT,
    ph_min REAL,
    ph_max REAL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS effectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pathogen_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    host_target TEXT,
    mechanism TEXT,
    notes TEXT,
    FOREIGN KEY (pathogen_id) REFERENCES pathogens(id)
);
CREATE INDEX IF NOT EXISTS idx_effectors_pathogen ON effectors(pathogen_id);

CREATE TABLE IF NOT EXISTS effector_targets (
    effector_id INTEGER NOT NULL,
    host_protein_id INTEGER NOT NULL,
    interaction_type TEXT,
    PRIMARY KEY (effector_id, host_protein_id),
    FOREIGN KEY (effector_id) REFERENCES effectors(id),
    FOREIGN KEY (host_protein_id) REFERENCES host_proteins(id)
);
CREATE INDEX IF NOT EXISTS idx_et_host_protein ON effector_targets(host_protein_id);

CREATE TABLE IF NOT EXISTS stage_markers (
    stage_id INTEGER NOT NULL,
    host_protein_id INTEGER NOT NULL,
    presence INTEGER NOT NULL,
    PRIMARY KEY (stage_id, host_protein_id),
    FOREIGN KEY (stage_id) REFERENCES maturation_stages(id),
    FOREIGN KEY (host_protein_id) REFERENCES host_proteins(id)
);
"""


def drop_tables(con):
    tables = [
        "stage_markers",
        "effector_targets",
        "effectors",
        "maturation_stages",
        "host_proteins",
        "pathogens",
    ]
    for t in tables:
        con.execute(f"DROP TABLE IF EXISTS {t}")


def load_csv(filename):
    path = SEED_DIR / filename
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def build():
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")

    drop_tables(con)
    con.executescript(SCHEMA_SQL)

    pathogens = load_csv("pathogens.csv")
    con.executemany(
        "INSERT INTO pathogens (name, species, gram_stain, strategy, description, reference) "
        "VALUES (:name, :species, :gram_stain, :strategy, :description, :reference)",
        pathogens,
    )

    host_proteins = load_csv("host_proteins.csv")
    con.executemany(
        "INSERT INTO host_proteins (name, full_name, function, localization, pathway, uniprot_id) "
        "VALUES (:name, :full_name, :function, :localization, :pathway, :uniprot_id)",
        host_proteins,
    )

    stages = load_csv("maturation_stages.csv")
    con.executemany(
        "INSERT INTO maturation_stages (name, stage_order, time_range, ph_min, ph_max, description) "
        "VALUES (:name, :stage_order, :time_range, :ph_min, :ph_max, :description)",
        stages,
    )

    pathogen_map = {r["name"]: r["id"] for r in con.execute("SELECT id, name FROM pathogens").fetchall()}
    protein_map = {r["name"]: r["id"] for r in con.execute("SELECT id, name FROM host_proteins").fetchall()}
    stage_map = {r["name"]: r["id"] for r in con.execute("SELECT id, name FROM maturation_stages").fetchall()}

    effectors = load_csv("effectors.csv")
    effector_rows = [
        {
            "pathogen_id": pathogen_map[r["pathogen_name"]],
            "name": r["effector_name"],
            "type": r["type"],
            "host_target": r["host_target"],
            "mechanism": r["mechanism"],
            "notes": "",
        }
        for r in effectors
    ]
    con.executemany(
        "INSERT INTO effectors (pathogen_id, name, type, host_target, mechanism, notes) "
        "VALUES (:pathogen_id, :name, :type, :host_target, :mechanism, :notes)",
        effector_rows,
    )

    effector_map = {}
    for r in con.execute("SELECT id, name, pathogen_id FROM effectors").fetchall():
        key = (r["pathogen_id"], r["name"])
        effector_map[key] = r["id"]

    effector_targets = load_csv("effector_targets.csv")
    et_rows = []
    for r in effector_targets:
        eid = effector_map.get(
            (pathogen_map.get(r.get("pathogen_name", "")), r["effector_name"])
        )
        if eid is None:
            for k, v in effector_map.items():
                if k[1] == r["effector_name"]:
                    eid = v
                    break
        if eid is None:
            continue
        hpid = protein_map.get(r["host_protein_name"])
        if hpid is None:
            continue
        et_rows.append({
            "effector_id": eid,
            "host_protein_id": hpid,
            "interaction_type": r["interaction_type"],
        })
    con.executemany(
        "INSERT OR IGNORE INTO effector_targets (effector_id, host_protein_id, interaction_type) "
        "VALUES (:effector_id, :host_protein_id, :interaction_type)",
        et_rows,
    )

    stage_markers = load_csv("stage_markers.csv")
    sm_rows = []
    for r in stage_markers:
        sid = stage_map.get(r["stage_name"])
        hpid = protein_map.get(r["host_protein_name"])
        if sid is None or hpid is None:
            continue
        sm_rows.append({
            "stage_id": sid,
            "host_protein_id": hpid,
            "presence": int(r["presence"]),
        })
    con.executemany(
        "INSERT OR IGNORE INTO stage_markers (stage_id, host_protein_id, presence) "
        "VALUES (:stage_id, :host_protein_id, :presence)",
        sm_rows,
    )

    con.commit()
    con.close()

    print(f"Built database: {DB_PATH}")
    print(f"  Pathogens: {len(pathogens)}")
    print(f"  Host proteins: {len(host_proteins)}")
    print(f"  Maturation stages: {len(stages)}")
    print(f"  Effectors: {len(effectors)}")
    print(f"  Effector-target links: {len(et_rows)}")
    print(f"  Stage-marker links: {len(sm_rows)}")


if __name__ == "__main__":
    build()
