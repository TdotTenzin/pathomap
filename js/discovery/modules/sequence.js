/* Module 02 - Effector Sequence Analysis (descriptive, no prediction). */

import { calculateFeatures, cleanSequence, STANDARD_AMINO_ACIDS, unknownResidues } from '../../experiment/features.js';
import { eligible, groupBy, mean, requireField, round } from '../utils.js';

const AMINO_ACIDS = STANDARD_AMINO_ACIDS;

function composition(sequence) {
  const seq = cleanSequence(sequence);
  const counts = {};
  for (const aa of AMINO_ACIDS) counts[aa] = 0;
  for (const aa of seq) {
    if (aa in counts) counts[aa] += 1;
  }
  return counts;
}

export default {
  id: 'sequence-analysis',
  number: '02',
  name: 'Effector Sequence Analysis',
  question: 'What molecular and sequence-derived properties characterize the effector set?',
  description: 'Computed descriptors, distributions by group, and a missing-sequence report.',

  canRun(dataset) {
    const reasons = requireField(dataset, 'effectors', 'sequence');
    return eligible((dataset?.effectors?.length || 0) > 0 && reasons.length === 0, reasons);
  },

  run(dataset) {
    const effectors = dataset.effectors || [];
    const withSequence = [];
    const missing = [];

    const warnings = [];

    effectors.forEach((effector) => {
      const name = effector.effector_name || effector.entity_id;
      const pathogen = effector.pathogen_name || '—';
      const seq = cleanSequence(effector.sequence);
      const features = calculateFeatures(seq);

      if (!seq || features.molecular_weight_da === null) {
        missing.push({
          effector: name,
          pathogen,
          reason: seq ? 'No standard amino-acid residues' : 'Missing sequence',
        });
        return;
      }

      const unknown = unknownResidues(seq);
      if (unknown.length > 0) {
        warnings.push(`${name}: non-standard residue(s) ${unknown.join(', ')} excluded from feature calculations.`);
      }

      withSequence.push({
        entity_id: effector.entity_id || name,
        effector: name,
        pathogen,
        phenotype: effector.phenotype || 'Unlabelled',
        sequence_length: features.sequence_length,
        molecular_weight_da: features.molecular_weight_da,
        isoelectric_point: features.isoelectric_point,
        gravy_score: features.gravy_score,
        unknown_residues: unknown.join(', ') || '—',
        composition: composition(seq),
      });
    });

    const groupKey = (row) => row.phenotype;
    const groups = groupBy(withSequence, groupKey);
    const distributionRows = [...groups.entries()].map(([phenotype, rows]) => ({
      phenotype,
      n: rows.length,
      mean_length: round(mean(rows.map((row) => row.sequence_length)), 1),
      mean_mw: round(mean(rows.map((row) => row.molecular_weight_da)), 1),
      mean_pi: round(mean(rows.map((row) => row.isoelectric_point)), 2),
      mean_gravy: round(mean(rows.map((row) => row.gravy_score)), 3),
    }));

    const compositionTotals = Object.fromEntries([...AMINO_ACIDS].map((aa) => [aa, 0]));
    for (const row of withSequence) {
      for (const aa of AMINO_ACIDS) compositionTotals[aa] += row.composition[aa];
    }
    const totalResidues = Object.values(compositionTotals).reduce((sum, count) => sum + count, 0);
    const compositionRows = [...AMINO_ACIDS].map((aa) => ({
      residue: aa,
      count: compositionTotals[aa],
      fraction: totalResidues ? round(compositionTotals[aa] / totalResidues, 4) : 0,
    }));

    const featureRows = withSequence.map((row) => ({
      entity_id: row.entity_id,
      effector: row.effector,
      pathogen: row.pathogen,
      phenotype: row.phenotype,
      sequence_length: row.sequence_length,
      molecular_weight_da: row.molecular_weight_da,
      isoelectric_point: row.isoelectric_point,
      gravy_score: row.gravy_score,
      unknown_residues: row.unknown_residues,
      ...Object.fromEntries([...AMINO_ACIDS].map((aa) => [`aa_${aa}`, row.composition[aa]])),
    }));

    const longest = [...withSequence].sort((a, b) => b.sequence_length - a.sequence_length)[0];
    const highestPi = [...withSequence].sort((a, b) => b.isoelectric_point - a.isoelectric_point)[0];
    const mostHydrophobic = [...withSequence].sort((a, b) => b.gravy_score - a.gravy_score)[0];

    return {
      metrics: [
        { label: 'Sequences analyzed', value: String(withSequence.length) },
        { label: 'Missing sequences', value: String(missing.length) },
        { label: 'Mean length', value: String(round(mean(withSequence.map((row) => row.sequence_length)), 1)) },
        { label: 'Mean pI', value: String(round(mean(withSequence.map((row) => row.isoelectric_point)), 2)) },
        { label: 'Mean GRAVY', value: String(round(mean(withSequence.map((row) => row.gravy_score)), 3)) },
      ],
      findings: [
        longest ? `Longest effector: ${longest.effector} (${longest.sequence_length} aa)` : null,
        highestPi ? `Highest theoretical pI: ${highestPi.effector} (${highestPi.isoelectric_point})` : null,
        mostHydrophobic ? `Most hydrophobic: ${mostHydrophobic.effector} (GRAVY ${mostHydrophobic.gravy_score})` : null,
      ].filter(Boolean),
      tables: [
        {
          title: 'Per-effector features',
          columns: [
            { key: 'effector', label: 'Effector' },
            { key: 'pathogen', label: 'Pathogen' },
            { key: 'phenotype', label: 'Phenotype' },
            { key: 'sequence_length', label: 'Length' },
            { key: 'molecular_weight_da', label: 'MW (Da)' },
            { key: 'isoelectric_point', label: 'pI' },
            { key: 'gravy_score', label: 'GRAVY' },
            { key: 'unknown_residues', label: 'Non-standard residues' },
          ],
          rows: featureRows,
        },
        {
          title: 'Distribution by phenotype',
          columns: [
            { key: 'phenotype', label: 'Phenotype' },
            { key: 'n', label: 'n' },
            { key: 'mean_length', label: 'Mean length' },
            { key: 'mean_mw', label: 'Mean MW' },
            { key: 'mean_pi', label: 'Mean pI' },
            { key: 'mean_gravy', label: 'Mean GRAVY' },
          ],
          rows: distributionRows,
        },
        {
          title: 'Amino acid composition',
          columns: [
            { key: 'residue', label: 'Residue' },
            { key: 'count', label: 'Count' },
            { key: 'fraction', label: 'Fraction' },
          ],
          rows: compositionRows,
        },
        {
          title: 'Missing sequences',
          columns: [
            { key: 'effector', label: 'Effector' },
            { key: 'pathogen', label: 'Pathogen' },
            { key: 'reason', label: 'Reason' },
          ],
          rows: missing,
        },
      ],
      notes: [
        'Sequence-derived properties are not direct evidence of localization, secretion, structure, or function.',
        'pI uses the EMBOSS pKa scale and GRAVY uses Kyte-Doolittle hydropathy values.',
      ],
      warnings,
    };
  },

  validate(result) {
    const issues = [];
    result.tables?.[0]?.rows?.forEach((row) => {
      if (row.sequence_length !== null && !Number.isFinite(row.sequence_length)) issues.push(`Invalid length for ${row.effector}.`);
    });
    return { valid: issues.length === 0, issues };
  },
};
