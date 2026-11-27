import interaction from './interaction.js';
import sequence from './sequence.js';
import pathway from './pathway.js';
import enrichment from './enrichment.js';
import proteinNetwork from './protein-network.js';
import comparative from './comparative.js';
import hostResponse from './host-response.js';
import predictive from './predictive.js';

/* Ordered to match section numbers in docs/ANALYSES.md. */
export const DISCOVERY_MODULES = [
  interaction,
  sequence,
  pathway,
  enrichment,
  proteinNetwork,
  comparative,
  hostResponse,
  predictive,
];
