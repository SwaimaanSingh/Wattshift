/**
 * Amber Electric.
 *
 * NOT VERIFIED against a real bill — no Amber sample was supplied.
 *
 * Amber resells at the wholesale spot price for a fixed membership fee, which
 * makes its statements shaped differently from every other retailer here:
 *
 * - A monthly subscription/membership fee sits alongside the network charges.
 *   It is a fee for access to Amber's pricing, not a charge for supplying the
 *   premises, so it must not land in the daily supply charge — that figure
 *   feeds the savings model, and inflating it overstates the fixed cost solar
 *   cannot avoid. Supply is therefore re-read with those lines removed.
 * - Usage is billed at a varying wholesale rate, so the "rate" on the bill is
 *   an average over the period rather than a plan rate. The consumption
 *   weighting in generic.js already produces that figure from the charge rows.
 * - The feed-in is wholesale-linked and can legitimately be large, or negative
 *   during price spikes; `isPlausibleFiT` allows both.
 */
import { parse as parseGeneric } from './generic.js';
import {
  isPlausibleSupplyCharge,
  lines,
  mergeDefined,
  scanSupplyRows,
  weightedSupplyCharge,
} from './_shared.js';

export const id = 'amberElectric';
export const displayName = 'Amber Electric';
export const verified = false;

export function detect(text) {
  if (/amber\.com\.au|amberelectric\.com\.au/i.test(text)) return 3;
  if (/\bAmber\s+Electric\b/i.test(text)) return 3;
  if (/\bAmber\s+Energy\b/i.test(text)) return 2;
  return 0;
}

/** Membership pricing, not a charge for supplying the premises. */
const SUBSCRIPTION_LINE =
  /\b(subscription|membership|monthly\s+fee|amber\s+fee|plan\s+fee|service\s+fee)\b/i;

export function parse(text) {
  const base = parseGeneric(text);

  const supply = weightedSupplyCharge(
    scanSupplyRows(lines(text).filter((l) => !SUBSCRIPTION_LINE.test(l)).join('\n'))
  );

  const merged = mergeDefined(base, { retailer: displayName });

  // Assigned rather than merged: this scan *restricts* the generic reading, so
  // a null must clear it. mergeDefined skips null overrides and would leave the
  // subscription-derived figure in place.
  merged.dailySupplyChargeCents = isPlausibleSupplyCharge(supply) ? supply : null;

  return merged;
}
