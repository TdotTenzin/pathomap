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

export const STANDARD_AMINO_ACIDS = Object.keys(AA_MW).join('');

const POSITIVE_RESIDUES = ['K', 'R', 'H'];
const NEGATIVE_RESIDUES = ['D', 'E', 'C', 'Y'];
const EMPTY_FEATURES = {
  sequence_length: null,
  molecular_weight_da: null,
  isoelectric_point: null,
  gravy_score: null,
};

const roundTo = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

function residueCounts(seq) {
  const counts = {};
  for (const aa of seq) {
    if (aa in AA_MW) counts[aa] = (counts[aa] || 0) + 1;
  }
  return counts;
}

function hasStandardResidues(counts) {
  return STANDARD_AMINO_ACIDS.split('').some((aa) => counts[aa] > 0);
}

function chargeCounts(seq) {
  const positive = {};
  const negative = {};
  for (const aa of seq) {
    if (POSITIVE_RESIDUES.includes(aa)) positive[aa] = (positive[aa] || 0) + 1;
    else if (NEGATIVE_RESIDUES.includes(aa)) negative[aa] = (negative[aa] || 0) + 1;
  }
  return { positive, negative };
}

function netChargeFromCounts({ positive, negative }, ph) {
  let totalPositive = 1 / (1 + 10 ** (ph - PKA_NTERM));
  let totalNegative = 1 / (1 + 10 ** (PKA_CTERM - ph));

  for (const aa of POSITIVE_RESIDUES) {
    totalPositive += (positive[aa] || 0) / (1 + 10 ** (ph - PKA_SIDE_CHAINS[aa]));
  }
  for (const aa of NEGATIVE_RESIDUES) {
    totalNegative += (negative[aa] || 0) / (1 + 10 ** (PKA_SIDE_CHAINS[aa] - ph));
  }

  return totalPositive - totalNegative;
}

function isoelectricPointFromCounts(charges) {
  let low = 0;
  let high = 14;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    if (netChargeFromCounts(charges, mid) > 0) low = mid;
    else high = mid;
  }
  return roundTo((low + high) / 2, 2);
}

function molecularWeightFromCounts(counts) {
  let total = 0;
  let residues = 0;
  for (const aa of STANDARD_AMINO_ACIDS) {
    const count = counts[aa] || 0;
    total += AA_MW[aa] * count;
    residues += count;
  }
  if (residues === 0) return null;
  return roundTo(total - (residues - 1) * 18.015, 2);
}

function gravyFromCounts(counts) {
  let total = 0;
  let residues = 0;
  for (const aa of STANDARD_AMINO_ACIDS) {
    const count = counts[aa] || 0;
    total += AA_GRAVY[aa] * count;
    residues += count;
  }
  if (residues === 0) return null;
  return roundTo(total / residues, 3);
}

function featuresFromClean(seq) {
  const counts = residueCounts(seq);
  if (!hasStandardResidues(counts)) return { ...EMPTY_FEATURES };

  return {
    sequence_length: seq.length,
    molecular_weight_da: molecularWeightFromCounts(counts),
    isoelectric_point: isoelectricPointFromCounts(chargeCounts(seq)),
    gravy_score: gravyFromCounts(counts),
  };
}

export function calculateMolecularWeight(sequence) {
  return molecularWeightFromCounts(residueCounts(cleanSequence(sequence)));
}

export function netCharge(sequence, ph) {
  return netChargeFromCounts(chargeCounts(cleanSequence(sequence)), ph);
}

export function calculateIsoelectricPoint(sequence) {
  const seq = cleanSequence(sequence);
  const counts = residueCounts(seq);
  if (!hasStandardResidues(counts)) return null;
  return isoelectricPointFromCounts(chargeCounts(seq));
}

export function calculateGravy(sequence) {
  return gravyFromCounts(residueCounts(cleanSequence(sequence)));
}

export function calculateFeatures(sequence) {
  return featuresFromClean(cleanSequence(sequence));
}
