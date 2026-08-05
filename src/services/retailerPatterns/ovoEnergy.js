/**
 * OVO Energy.
 *
 * NOT VERIFIED against a real bill — no OVO sample was supplied.
 * Detection is grounded in the brand, domain and legal entity. Field
 * extraction runs on the shared patterns in generic.js.
 */
import { parse as parseGeneric } from './generic.js';
import { mergeDefined } from './_shared.js';

export const id = 'ovoEnergy';
export const displayName = 'OVO Energy';
export const verified = false;

export function detect(text) {
  if (/ovoenergy\.com(\.au)?/i.test(text)) return 3;
  if (/\bOVO\s+Energy\b/i.test(text)) return 3;
  // "OVO" is only three characters and turns up in OCR noise and reference
  // numbers, so it is never a match without the brand word beside it.
  return 0;
}

export function parse(text) {
  return mergeDefined(parseGeneric(text), { retailer: displayName });
}
