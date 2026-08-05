/**
 * Powershop.
 *
 * NOT VERIFIED against a real bill — no Powershop sample was supplied.
 * Detection is grounded in the brand, domain and legal entity. Field
 * extraction runs on the shared patterns in generic.js.
 *
 * To check when a sample arrives: Powershop's differentiator is "Powerpacks",
 * prepaid usage bundles bought in the app. If a statement lists pack purchases
 * *and* the usage they cover, both carry kWh figures and summing charge rows
 * could double-count consumption. Confirm against a real bill before adding
 * any correction — inventing one now risks breaking the ordinary case.
 */
import { parse as parseGeneric } from './generic.js';
import { mergeDefined } from './_shared.js';

export const id = 'powershop';
export const displayName = 'Powershop';
export const verified = false;

export function detect(text) {
  if (/powershop\.com\.au/i.test(text)) return 3;
  if (/\bPowershop\b/i.test(text)) return 3;
  // Shell Energy owns Powershop and appears in the footer, but also retails
  // under its own name, so it only corroborates a Powershop mention.
  if (/\bShell\s+Energy\b/i.test(text) && /\bpowerpack/i.test(text)) return 2;
  return 0;
}

export function parse(text) {
  return mergeDefined(parseGeneric(text), { retailer: displayName });
}
