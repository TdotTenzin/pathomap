import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EFFECTOR_COLUMNS,
    HOST_PROTEIN_COLUMNS,
    HOST_TARGET_COLUMNS,
    PATHOGEN_COLUMNS,
    REFERENCE_COLUMNS,
    SCHEMA_VERSION,
} from '../js/data/schema.js';
import { normalizeDataset, validateDataset } from '../js/utils/dataset.js';

test('validateDataset reports advisory warnings without blocking the dataset', () => {
    const result = validateDataset({
        mystery: [1],
        pathogens: [
            { entity_id: 'bad', pathogen_id: 1, name: 'Alpha' },
            {
                entity_id: 'PM-PAT-0001',
                pathogen_id: 1,
                name: 'alpha',
                gram_stain: 'weird',
                reference_doi: 'oops',
                tax_id: 'nope',
            },
            { pathogen_id: 2, name: 'Gamma', strategy: 'cryptic' },
            { entity_id: 'PM-PAT-0001', pathogen_id: 3, name: 'Delta' },
        ],
        effectors: [{ entity_id: 'PM-EFF-0001', pathogen_id: 999 }],
        host_targets: [{ entity_id: 'PM-TGT-0001', host_protein_id: 999, audit_status: 'bogus' }],
        interactions: [{ interaction_id: 'bad' }],
        interaction_evidence: [{ evidence_id: 'bad', evidence_class: 'maybe' }],
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.ok(result.warnings.some((warning) => warning.includes('Ignored unrecognized tables: mystery')));
    assert.ok(result.warnings.some((warning) => warning.includes('duplicate pathogen name "alpha"')));
    assert.ok(result.warnings.some((warning) => warning.includes('duplicate pathogen_id 1')));
    assert.ok(result.warnings.some((warning) => warning.includes('unknown gram_stain "weird"')));
    assert.ok(result.warnings.some((warning) => warning.includes('tax_id is not numeric')));
    assert.ok(result.warnings.some((warning) => warning.includes('reference_doi does not look like a DOI')));
    assert.ok(result.warnings.some((warning) => warning.includes('invalid entity_id "bad"')));
    assert.ok(result.warnings.some((warning) => warning.includes('duplicate entity_id PM-PAT-0001')));
    assert.ok(result.warnings.some((warning) => warning.includes('IDs will be generated on load')));
    assert.ok(result.warnings.some((warning) => warning.includes('unknown pathogen_id 999')));
    assert.ok(result.warnings.some((warning) => warning.includes('unknown host_protein_id 999')));
    assert.ok(result.warnings.some((warning) => warning.includes('invalid interaction_id')));
    assert.ok(result.warnings.some((warning) => warning.includes('invalid evidence_id')));
    assert.ok(result.warnings.some((warning) => warning.includes('invalid evidence_class')));
});

test('validateDataset blocks structural errors', () => {
    assert.deepEqual(validateDataset(null), {
        valid: false,
        errors: ['Dataset must be a JSON object.'],
        warnings: [],
    });
    assert.deepEqual(validateDataset({}).errors, ['Missing required array: pathogens.']);
    assert.deepEqual(validateDataset({ pathogens: [null] }).errors, ['Row 1: expected an object.']);
    assert.deepEqual(validateDataset({ pathogens: [{}] }).errors, ['Row 1: name is required.']);
});

test('normalizeDataset generates unique canonical IDs and resolves links by name', () => {
    const normalized = normalizeDataset({
        meta: { built_at: '2026-01-01T00:00:00Z' },
        pathogens: [
            { pathogen_id: 1, name: 'Alpha one' },
            { entity_id: 'PM-PAT-0001', pathogen_id: 1, name: 'Beta two' },
            { entity_id: 'bad', pathogen_id: 0, name: 'Gamma three' },
        ],
        effectors: [
            { effector_name: 'Effector X', pathogen_name: 'Alpha one' },
            { entity_id: 'PM-EFF-0001', effector_name: 'Effector Y' },
        ],
        host_proteins: [{ host_protein_id: 4, protein_name: 'Protein P' }],
        host_targets: [{ host_target_id: 2, name: 'Target T' }],
        references: [
            { doi: '10.1000/a' },
            { entity_id: 'PM-REF-0001', doi: '10.1000/b' },
        ],
    });

    assert.deepEqual(normalized.pathogens.map((row) => row.entity_id), [
        'PM-PAT-0001',
        'PM-PAT-0002',
        'PM-PAT-0003',
    ]);
    assert.deepEqual(normalized.pathogens.map((row) => row.pathogen_id), [1, 2, 3]);
    assert.deepEqual(normalized.effectors.map((row) => row.entity_id), [
        'PM-EFF-0001',
        'PM-EFF-0002',
    ]);
    assert.equal(normalized.effectors[0].pathogen_id, 1);
    assert.equal(normalized.effectors[1].pathogen_id, null);
    assert.equal(normalized.host_proteins[0].entity_id, 'PM-HST-0004');
    assert.equal(normalized.host_targets[0].entity_id, 'PM-TGT-0002');
    assert.deepEqual(normalized.references.map((row) => row.entity_id), [
        'PM-REF-0001',
        'PM-REF-0002',
    ]);
});

test('normalizeDataset drops undeclared fields and reports final row counts', () => {
    const normalized = normalizeDataset({
        pathogens: [{ entity_id: 'PM-PAT-0001', pathogen_id: 1, name: 'Alpha', mystery: 'drop' }],
        effectors: [{ entity_id: 'PM-EFF-0001', effector_name: 'Effector', mystery: 'drop' }],
        host_proteins: [{ entity_id: 'PM-HST-0001', host_protein_id: 1, protein_name: 'P', mystery: 'drop' }],
        host_targets: [{ entity_id: 'PM-TGT-0001', host_target_id: 1, name: 'T', mystery: 'drop' }],
        references: [{ entity_id: 'PM-REF-0001', doi: '10.1000/a', mystery: 'drop' }],
        interactions: [{
            interaction_id: 'PM-INT-0001',
            effector_id: 'PM-EFF-0001',
            host_protein_id: 'PM-HST-0001',
            mystery: 'drop',
        }],
        interaction_evidence: [{
            evidence_id: 'PM-EVD-0001',
            interaction_id: 'PM-INT-0001',
            mystery: 'drop',
        }],
    });

    assert.deepEqual(Object.keys(normalized.pathogens[0]), PATHOGEN_COLUMNS);
    assert.deepEqual(Object.keys(normalized.effectors[0]), EFFECTOR_COLUMNS);
    assert.deepEqual(Object.keys(normalized.host_proteins[0]), HOST_PROTEIN_COLUMNS);
    assert.deepEqual(Object.keys(normalized.host_targets[0]), HOST_TARGET_COLUMNS);
    assert.deepEqual(Object.keys(normalized.references[0]), REFERENCE_COLUMNS);
    assert.equal('mystery' in normalized.interactions[0], false);
    assert.equal('mystery' in normalized.interaction_evidence[0], false);

    assert.equal(normalized.meta.dataset, 'pathomap');
    assert.equal(normalized.meta.schema_version, SCHEMA_VERSION);
    assert.deepEqual(normalized.meta.tables, {
        pathogens: 1,
        effectors: 1,
        host_proteins: 1,
        host_targets: 1,
        references: 1,
        interactions: 1,
        interaction_evidence: 1,
    });
});
