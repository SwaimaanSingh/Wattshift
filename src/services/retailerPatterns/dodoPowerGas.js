/**
 * Dodo Power & Gas.
 *
 * NOT VERIFIED against a real bill — no Dodo sample was supplied.
 * Detection is grounded in the brand, domain and legal entity. Field
 * extraction runs on the shared patterns in generic.js.
 *
 * Dodo retails electricity as a trading name of M2 Energy Pty Ltd, so the
 * footer names the entity rather than the brand. Dodo also sells internet and
 * mobile under the same masthead, which is why the electricity-side wording
 * ("Power & Gas", "M2 Energy") is what scores, not the bare brand.
 */
import { parse as parseGeneric } from './generic.js';
import { mergeDefined } from './_shared.js';

export const id = 'dodoPowerGas';
export const displayName = 'Dodo Power & Gas';
export const verified = false;

export function detect(text) {
  if (/\bDodo\s+Power\s*(?:&|and)\s*Gas\b/i.test(text)) return 3;
  if (/\bM2\s+Energy\b/i.test(text)) return 3;
  if (/\bDodo\b/i.test(text) && /dodo\.com(\.au)?/i.test(text)) return 2;
  // A bare "Dodo" could be the telco side of the business, so it is only a
  // match alongside energy wording.
  if (/\bDodo\b/i.test(text) && /\b(electricity|kwh|energy\s+charges)\b/i.test(text)) return 1;
  return 0;
}

export function parse(text) {
  return mergeDefined(parseGeneric(text), { retailer: displayName });
}
