/*
  features.js - Browser-side sequence descriptors for experiment-first analysis.

  Constants and formulas mirror scripts/build_effectors_host_proteins.py so
  uploaded sequences produce the same metrics as the curated build pipeline.
*/

export const AA_MW = {
  A: 89.09, R: 174.20, N: 132.12, D: 133.10, C: 121.16,
  E: 147.13, Q: 146.15, G: 75.07, H: 155.16, I: 131.18,
  L: 131.18, K: 146.19, M: 149.21, F: 165.19, P: 115.13,
  S: 105.09, T: 119.12, W: 204.23, Y: 181.19, V: 117.15,
};

export const AA_GRAVY = {
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5,
  E: -3.5, Q: -3.5, G: -0.4, H: -3.2, I: 4.5,
  L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6,
  S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2,
};

export const PKA_NTERM = 8.6;
export const PKA_CTERM = 3.6;
export const PKA_SIDE_CHAINS = {
  D: 3.65, E: 4.25, C: 8.5, Y: 10.0,
  H: 6.5, K: 10.8, R: 12.4,
};

export const SEQUENCE_FEATURE_KEYS = [
  'sequence_length',
  'molecular_weight_da',
  'isoelectric_point',
  'gravy_score',
];

export const SEQUENCE_FEATURE_LABELS = {
  sequence_length: 'Length',
  molecular_weight_da: 'MW (Da)',
  isoelectric_point: 'pI',
  gravy_score: 'GRAVY',
};

export function cleanSequence(value) {
  const withoutHeaders = String(value ?? '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('>'))
    .join('');

  return withoutHeaders.toUpperCase().replace(/[^A-Z]/g, '');
}

export function unknownResidues(sequence) {
  const unknown = new Set();
  for (const residue of cleanSequence(sequence)) {
    if (!(residue in AA_MW)) unknown.add(residue);
  }
  return [...unknown].sort();
}

export function calculateMolecularWeight(sequence) {
  const residues = [...cleanSequence(sequence)].filter((aa) => aa in AA_MW);
  if (residues.length === 0) return null;
  const total = residues.reduce((sum, aa) => sum + AA_MW[aa], 0);
  return Math.round((total - (residues.length - 1) * 18.015) * 100) / 100;
}

export function netCharge(sequence, ph) {
  const seq = cleanSequence(sequence);
  let positive = 1 / (1 + 10 ** (ph - PKA_NTERM));
  let negative = 1 / (1 + 10 ** (PKA_CTERM - ph));

  for (const aa of seq) {
    if (aa in PKA_SIDE_CHAINS && ['K', 'R', 'H'].includes(aa)) {
      positive += 1 / (1 + 10 ** (ph - PKA_SIDE_CHAINS[aa]));
    }
    if (aa in PKA_SIDE_CHAINS && ['D', 'E', 'C', 'Y'].includes(aa)) {
      negative += 1 / (1 + 10 ** (PKA_SIDE_CHAINS[aa] - ph));
    }
  }

  return positive - negative;
}

export function calculateIsoelectricPoint(sequence) {
  const seq = cleanSequence(sequence);
  if (seq.length === 0) return null;

  let low = 0;
  let high = 14;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    if (netCharge(seq, mid) > 0) low = mid;
    else high = mid;
  }
  return Math.round(((low + high) / 2) * 100) / 100;
}

export function calculateGravy(sequence) {
  const values = [...cleanSequence(sequence)]
    .filter((aa) => aa in AA_GRAVY)
    .map((aa) => AA_GRAVY[aa]);

  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 1000) / 1000;
}

export function calculateFeatures(sequence) {
  const seq = cleanSequence(sequence);
  if (seq.length === 0) {
    return {
      sequence_length: null,
      molecular_weight_da: null,
      isoelectric_point: null,
      gravy_score: null,
    };
  }

  return {
    sequence_length: seq.length,
    molecular_weight_da: calculateMolecularWeight(seq),
    isoelectric_point: calculateIsoelectricPoint(seq),
    gravy_score: calculateGravy(seq),
  };
}
