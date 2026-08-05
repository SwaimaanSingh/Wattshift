/**
 * Simply Energy.
 *
 * NOT VERIFIED against a real bill — no Simply Energy sample was supplied.
 * Detection is reliable; extraction falls through to the generic patterns.
 */
import { parse as parseGeneric } from './generic.js';
import { mergeDefined } from './_shared.js';

export const id = 'simplyEnergy';
export const displayName = 'Simply Energy';
export const verified = false;

export function detect(text) {
  if (/simplyenergy\.com\.au/i.test(text)) return 3;
  // ENGIE owns Simply Energy and its name appears in the footer. engie.js
  // scores a bare "ENGIE" at 2, so a Simply-branded bill still wins its own
  // module here on 3 — the margin is deliberate, not incidental.
  if (/\bSimply\s+Energy\b/i.test(text)) return 3;
  return 0;
}

export function parse(text) {
  return mergeDefined(parseGeneric(text), { retailer: displayName });
}
