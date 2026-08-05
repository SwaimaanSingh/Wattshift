/**
 * Red Energy.
 *
 * NOT VERIFIED against a real bill — no Red Energy sample was supplied.
 * Red and Lumo are the same group and their statements share a layout
 * ("Total Anytime" rows, "Service to Property Charge"), so the Lumo-shaped
 * generic handling is the best starting point. Confirm with a real sample
 * before relying on it.
 */
import { parse as parseGeneric } from './generic.js';
import { mergeDefined } from './_shared.js';

export const id = 'redEnergy';
export const displayName = 'Red Energy';
export const verified = false;

export function detect(text) {
  if (/redenergy\.com\.au/i.test(text)) return 3;
  // "Red Energy Pty Ltd" also appears in Lumo's EvenPay® trademark footnote,
  // so a bare mention is weak evidence and must lose to a Lumo match.
  if (/\bRed\s+Energy\s+Pty\s+Ltd\b/i.test(text)) return 1;
  return 0;
}

export function parse(text) {
  return mergeDefined(parseGeneric(text), { retailer: displayName });
}
