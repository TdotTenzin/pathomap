import json

with open(r'C:\Users\tenzi\OneDrive\Documents\host-pathogen-tracker\data\pathomap-dataset.json', encoding='utf-8') as f:
    full = json.load(f)

sample = {
    'pathogens': full['pathogens'][:5],
    'effectors': [e for e in full['effectors'] if e.get('pathogen') in [p['name'] for p in full['pathogens'][:5]]][:20],
    'host_proteins': full['host_proteins'][:10],
    'interactions': full['interactions'][:15],
    'maturation_stages': full['maturation_stages'],
    'stage_markers': full['stage_markers'][:30],
    'stage_marker_names': full['stage_marker_names'][:30],
    'hubs': full['hubs'][:5],
    'pathogen_actions': [pa for pa in full['pathogen_actions'] if pa.get('pathogen') in [p['name'] for p in full['pathogens'][:5]]],
    'ml_predictions': full.get('ml_predictions', []),
    'ml_pca': full.get('ml_pca', {}),
    'classifier_comparison': full.get('classifier_comparison', []),
    'phylogeny': full.get('phylogeny', {}),
    'literature': full.get('literature', [])[:10]
}

with open(r'C:\Users\tenzi\OneDrive\Documents\host-pathogen-tracker\data\sample-dataset.json', 'w', encoding='utf-8') as f:
    json.dump(sample, f, ensure_ascii=False)
