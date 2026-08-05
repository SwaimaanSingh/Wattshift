/**
 * EnergyAustralia.
 *
 * NOT VERIFIED against a real bill — no EnergyAustralia sample was supplied.
 * Detection is reliable; the field patterns below are the generic ones plus
 * label variants EnergyAustralia is known to use. Treat extraction from this
 * retailer as unproven until a sample is added to scripts/extractSampleBills.mjs.
 */
import { parse as parseGeneric } from './generic.js';
import {
  firstMatch,
  isPlausibleSupplyCharge,
  mergeDefined,
  rateToCents,
  toNumber,
} from './_shared.js';

export const id = 'energyAustralia';
export const displayName = 'EnergyAustralia';
export const verified = false;

export function detect(text) {
  if (/energyaustralia\.com\.au/i.test(text)) return 3;
  // The brand is one word; that form is unambiguous.
  if (/\bEnergyAustralia\b/.test(text)) return 3;
  // "Lumo Energy Australia Pty Limited" appears in Lumo's own footer, so the
  // spaced form must not match when it is preceded by another brand. The
  // trailing guard keeps prose like "clean energy Australia wide" from
  // outscoring the retailer whose bill this actually is.
  if (
    /(?<!lumo\s)(?<!red\s)\bEnergy\s?Australia\b(?!\s*(?:wide|only))/i.test(text)
  ) {
    return 3;
  }
  return 0;
}

export function parse(text) {
  const base = parseGeneric(text);

  const supply = rateToCents(
    toNumber(
      firstMatch(text, [
        /(?:daily\s+supply\s+charge|service\s+to\s+property|supply\s+charge|daily\s+charge)[^\n\d]{0,30}([\d.]+)\s*(?:[c¢]|cents)/i,
      ])
    ),
    'c/day'
  );

  return mergeDefined(base, {
    retailer: displayName,
    dailySupplyChargeCents: isPlausibleSupplyCharge(supply) ? supply : null,
  });
}
