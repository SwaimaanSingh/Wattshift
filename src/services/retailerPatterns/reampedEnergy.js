/**
 * ReAmped Energy.
 *
 * NOT VERIFIED against a real bill — no ReAmped sample was supplied.
 * Detection is grounded in the brand, domain and legal entity. Field
 * extraction runs on the shared patterns in generic.js.
 */
import { parse as parseGeneric } from './generic.js';
import { mergeDefined } from './_shared.js';

export const id = 'reampedEnergy';
export const displayName = 'ReAmped Energy';
export const verified = false;

export function detect(text) {
  if (/reamped(?:energy)?\.com\.au/i.test(text)) return 3;
  if (/\bReAmped\s+Energy\b/i.test(text)) return 3;
  // "ReAmped" is distinctive enough to stand alone, unlike a bare "Amped".
  if (/\bReAmped\b/i.test(text)) return 2;
  return 0;
}

export function parse(text) {
  return mergeDefined(parseGeneric(text), { retailer: displayName });
}
