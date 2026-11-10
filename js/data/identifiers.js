/*
  identifiers.js - Canonical PathoMap entity identifiers.

  Purpose: One stable, unique string ID per biological entity, shared by the
  curated dataset, uploaded datasets, and future analysis/interaction modules.
  Format: PM-<TYPE>-<NNNN>, where TYPE is PAT (pathogen), EFF (effector
  protein), HST (human host protein), REF (reference), TGT (host target),
  INT (interaction) or EVD (interaction evidence).

  Exports:
    ENTITY_TYPES            Map of entity type -> ID prefix.
    ENTITY_ID_PATTERN       Regex matching any canonical entity ID.
    makeEntityId(type, n)   Build an ID from a positive sequence number.
    isEntityId(value, type) Validate an ID, optionally for one entity type.
    parseEntityId(value)    Return { id, type, prefix, number } or null.
    entityTypeFromId(value) Return 'pathogen' | 'effector' | 'host_protein'.

  Stability: IDs are derived from curated numeric IDs (pathogens, host
  proteins) or a persisted registry (effectors). The ID itself never encodes a
  display name; the build resolves effector assignments through the registry.
*/

export const ENTITY_TYPES = Object.freeze({
  pathogen: 'PAT',
  effector: 'EFF',
  host_protein: 'HST',
  reference: 'REF',
  host_target: 'TGT',
  interaction: 'INT',
  interaction_evidence: 'EVD',
});

export const ENTITY_ID_PATTERN = /^PM-(PAT|EFF|HST|REF|TGT|INT|EVD)-(\d{4,})$/;

const TYPE_BY_PREFIX = Object.freeze(
  Object.fromEntries(Object.entries(ENTITY_TYPES).map(([type, prefix]) => [prefix, type]))
);

// Build an entity ID; returns null for an unknown type or invalid number.
export function makeEntityId(entityType, number) {
  const prefix = ENTITY_TYPES[entityType];
  const numeric = Number(number);
  if (!prefix || !Number.isInteger(numeric) || numeric <= 0) return null;
  return `PM-${prefix}-${String(numeric).padStart(4, '0')}`;
}

// Validate an entity ID, optionally requiring a specific entity type.
export function isEntityId(value, entityType = null) {
  if (typeof value !== 'string') return false;
  const match = ENTITY_ID_PATTERN.exec(value);
  if (!match) return false;
  return !entityType || match[1] === ENTITY_TYPES[entityType];
}

// Split an entity ID into its parts; null when malformed.
export function parseEntityId(value) {
  if (typeof value !== 'string') return null;
  const match = ENTITY_ID_PATTERN.exec(value);
  if (!match) return null;
  return {
    id: value,
    type: TYPE_BY_PREFIX[match[1]] || null,
    prefix: match[1],
    number: Number(match[2]),
  };
}

// Entity type encoded by an ID, or null when malformed.
export function entityTypeFromId(value) {
  return parseEntityId(value)?.type ?? null;
}
