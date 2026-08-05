/**
 * GloBird Energy.
 *
 * NOT VERIFIED against a real bill — no GloBird sample was supplied.
 * Detection is grounded in the brand, domain and legal entity. Field
 * extraction runs on the shared patterns in generic.js.
 */
import { parse as parseGeneric } from './generic.js';
import { mergeDefined } from './_shared.js';

export const id = 'globirdEnergy';
export const displayName = 'GloBird Energy';
export const verified = false;

export function detect(text) {
  if (/globird(?:energy)?\.com\.au/i.test(text)) return 3;
  if (/\bGloBird\b/i.test(text)) return 3;
  // Scanned bills reach the patterns through OCR, which routinely confuses the
  // lowercase L in "Glo" with a capital I or a one.
  if (/\bG[l1i]oBird\b/i.test(text)) return 2;
  return 0;
}

export function parse(text) {
  return mergeDefined(parseGeneric(text), { retailer: displayName });
}
