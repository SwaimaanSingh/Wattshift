/**
 * Tango Energy.
 *
 * NOT VERIFIED against a real bill — no Tango sample was supplied.
 * Detection is grounded in the brand, domain and legal entity. Field
 * extraction runs on the shared patterns in generic.js.
 */
import { parse as parseGeneric } from './generic.js';
import { mergeDefined } from './_shared.js';

export const id = 'tangoEnergy';
export const displayName = 'Tango Energy';
export const verified = false;

export function detect(text) {
  if (/tangoenergy\.com(\.au)?/i.test(text)) return 3;
  if (/\bTango\s+Energy\b/i.test(text)) return 3;
  // Pacific Hydro owns Tango; on its own the parent name proves nothing.
  if (/\bPacific\s+Hydro\b/i.test(text) && /\bTango\b/i.test(text)) return 2;
  return 0;
}

export function parse(text) {
  return mergeDefined(parseGeneric(text), { retailer: displayName });
}
