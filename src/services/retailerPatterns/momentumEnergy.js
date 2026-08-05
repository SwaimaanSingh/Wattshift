/**
 * Momentum Energy.
 *
 * NOT VERIFIED against a real bill — no Momentum sample was supplied.
 * Detection is grounded in the brand, domain and legal entity, all of which
 * are stable. Field extraction runs on the shared patterns in generic.js;
 * treat the figures as unproven until a sample is added to
 * scripts/extractSampleBills.mjs and an entry to scripts/testParsers.mjs.
 */
import { parse as parseGeneric } from './generic.js';
import { mergeDefined } from './_shared.js';

export const id = 'momentumEnergy';
export const displayName = 'Momentum Energy';
export const verified = false;

export function detect(text) {
  if (/momentum(?:energy)?\.com\.au/i.test(text)) return 3;
  if (/\bMomentum\s+Energy\b/i.test(text)) return 3;
  // Hydro Tasmania owns Momentum and appears in the footer; on its own that is
  // only a hint, since Hydro Tasmania also trades under its own name.
  if (/\bHydro\s+Tasmania\b/i.test(text) && /\bMomentum\b/i.test(text)) return 2;
  // "Momentum" is an ordinary English word — never a match on its own.
  return 0;
}

export function parse(text) {
  return mergeDefined(parseGeneric(text), { retailer: displayName });
}
