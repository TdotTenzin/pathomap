"""Export the SQLite DB to a JSON file for frontend fallback."""
import json
import os
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pathomap.literature import load_literature  # noqa: E402
from pathomap.ml.classifier import compare_classifiers, out_of_fold_predictions  # noqa: E402
from pathomap.ml.dimred import pathogen_feature_pca  # noqa: E402
from pathomap.ml.phylogenetics import build_phylogenetic_tree  # noqa: E402

DB = os.path.join(os.path.dirname(__file__), '..', 'src', 'pathomap', 'data', 'pathomap.db')
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'fallback.json')

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
c = conn.cursor()

# Pathogens
c.execute('SELECT p.id, p.name, p.species, p.gram_stain, p.strategy, p.description, p.reference, COUNT(e.id) as n_effectors FROM pathogens p LEFT JOIN effectors e ON e.pathogen_id = p.id GROUP BY p.id ORDER BY p.name')
pathogens = [dict(r) for r in c.fetchall()]

# Effectors with pathogen_name
c.execute('SELECT p.name as pathogen_name, e.name as effector_name, e.type, e.host_target, e.mechanism FROM effectors e JOIN pathogens p ON e.pathogen_id = p.id ORDER BY p.name')
effectors = [dict(r) for r in c.fetchall()]

# Host proteins (uniprot_id drives the external UniProt link in the UI)
c.execute('SELECT hp.name, hp.full_name, hp.function, hp.localization, hp.pathway, hp.uniprot_id FROM host_proteins hp ORDER BY hp.name')
host_proteins = [dict(r) for r in c.fetchall()]

# Effector -> host protein interactions, with names resolved. The Database
# section renders these directly, so they must exist in the offline payload
# rather than only behind /api/interactome.
c.execute('''
    SELECT e.name as effector,
           p.name as pathogen,
           hp.name as host_protein,
           et.interaction_type
    FROM effector_targets et
    JOIN effectors e ON et.effector_id = e.id
    JOIN pathogens p ON e.pathogen_id = p.id
    JOIN host_proteins hp ON et.host_protein_id = hp.id
    ORDER BY p.name, e.name, hp.name
''')
interactions = [dict(r) for r in c.fetchall()]

# Maturation stages
c.execute('SELECT ms.stage_order, ms.name, ms.time_range, ms.ph_min, ms.ph_max, ms.description FROM maturation_stages ms ORDER BY ms.stage_order')
stages = [dict(r) for r in c.fetchall()]

# Stage markers (with names)
c.execute('''
    SELECT ms.name as stage_name, hp.name as host_protein_name, sm.presence
    FROM stage_markers sm
    JOIN maturation_stages ms ON sm.stage_id = ms.id
    JOIN host_proteins hp ON sm.host_protein_id = hp.id
    ORDER BY ms.stage_order, hp.name
''')
stage_markers = [dict(r) for r in c.fetchall() if r['host_protein_name']]

# Stage marker names (distinct, ordered)
c.execute('''
    SELECT DISTINCT hp.name
    FROM stage_markers sm
    JOIN host_proteins hp ON sm.host_protein_id = hp.id
    ORDER BY hp.name
''')
marker_names = [r[0] for r in c.fetchall()]

# Hubs
c.execute('''
    SELECT hp.name as host, COUNT(*) as degree, 0.0 as centrality
    FROM host_proteins hp
    JOIN effector_targets et ON et.host_protein_id = hp.id
    GROUP BY hp.id
    ORDER BY degree DESC
    LIMIT 15
''')
hubs = [dict(r) for r in c.fetchall()]

# For each hub, compute a simple centrality = degree / max_degree
if hubs:
    max_deg = hubs[0]['degree']
    for h in hubs:
        h['centrality'] = round(h['degree'] / max_deg, 4)

# Pathogen actions: each pathogen's action mapped to a stage
stage_map = {
    'extracellular': 0,   # Pre-phagocytosis
    'escape': 1,          # Phagosome formation
    'modified_compartment': 3,  # Late phagosome
    'arrest': 2,          # Early phagosome
    'reroute': 1          # Phagosome formation
}
c.execute('SELECT id, stage_order, name, ph_min, ph_max FROM maturation_stages')
stage_rows = {r[0]: dict(r) for r in c.fetchall()}
# Also index by stage_order
stage_by_order = {}
for sid, s in stage_rows.items():
    stage_by_order[s['stage_order']] = s

pathogen_actions = []
all_strategies = {'extracellular', 'escape', 'modified_compartment', 'arrest', 'reroute'}
for p in pathogens:
    strat = p['strategy']
    order = stage_map.get(strat, 0)
    s = stage_by_order.get(order)
    if s:
        pathogen_actions.append({
            'pathogen': p['name'],
            'stage': s['name'],
            'ph': (s['ph_min'] + s['ph_max']) / 2,
            'action': strat
        })

# ML predictions: real out-of-fold predictions from the trained Random Forest.
# Every row is predicted by a model that did not see that pathogen, so the
# offline confidence and accuracy are genuine measurements.
try:
    ml_preds = out_of_fold_predictions()
except Exception:
    ml_preds = []

# Optional: PCA projection, classifier comparison, and phylogenetic tree.
# These are computed from the live modules; if any fails, fall back to {} so
# the offline frontend can degrade gracefully.
try:
    pca_data = pathogen_feature_pca()
except Exception:
    pca_data = {}

try:
    classifier_comparison = compare_classifiers()
except Exception:
    classifier_comparison = {}

try:
    phylogeny = build_phylogenetic_tree()
except Exception:
    phylogeny = {}

# Real PubMed references fetched by scripts/fetch_literature.py (may be empty
# if the fetch has not been run; the UI then shows no references).
try:
    literature = list(load_literature())
except Exception:
    literature = []

data = {
    'pathogens': pathogens,
    'effectors': effectors,
    'host_proteins': host_proteins,
    'interactions': interactions,
    'maturation_stages': stages,
    'stage_markers': stage_markers,
    'stage_marker_names': marker_names,
    'hubs': hubs,
    'pathogen_actions': pathogen_actions,
    'ml_predictions': ml_preds,
    'ml_pca': pca_data,
    'classifier_comparison': classifier_comparison,
    'phylogeny': phylogeny,
    'literature': literature
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

# Also embed the same payload as a JS file so the site works when opened
# directly via file:// (no fetch possible on file scheme).
JS_OUT = os.path.join(os.path.dirname(__file__), '..', 'js', 'data.js')
with open(JS_OUT, 'w', encoding='utf-8') as f:
    f.write('var TOOLKIT_DATA = ')
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write(';\n')

print(f"Wrote {OUT}  ({len(pathogens)} pathogens, {len(effectors)} effectors, {len(host_proteins)} host proteins, {len(interactions)} interactions, {len(hubs)} hubs, {len(pathogen_actions)} actions, {len(ml_preds)} predictions, {len(literature)} references, pca={'yes' if pca_data else 'no'}, phylogeny={'yes' if phylogeny else 'no'})")
print(f"Wrote {JS_OUT} (embedded TOOLKIT_DATA for file:// support)")
conn.close()
