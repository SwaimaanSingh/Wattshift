/**
 * iO Energy — a South Australian retailer not in the original target list,
 * added because one of the sample bills is theirs.
 *
 * Verified against: pte-hq-april (business TOU with solar).
 *
 * Layout notes:
 * - Every string is drawn twice to fake bold ("YOUR DETAILSYOUR DETAILS").
 *   Handled upstream in textLayout.js by dropping overdrawn fragments.
 * - "Billing Period: 01 Mar 2026 - 31 Mar 2026 (31 days)"
 * - Export is split three ways and daytime export is *charged*, not credited:
 *   "Off Peak - Export (Charge) Solar Daytime  383.37 kWh  $0.02  $7.68".
 *   The resulting feed-in figure is legitimately negative.
 * - Meter reads confirm the totals: E1 = import, B1 = export (NEM standard).
 */
import { parse as parseGeneric } from './generic.js';
import { firstMatch, mergeDefined, toNumber } from './_shared.js';

export const id = 'ioEnergy';
export const displayName = 'iO Energy';

export function detect(text) {
  if (/ioenergy\.com\.au/i.test(text)) return 3;
  if (/iO\s+Energy\s+Retail/i.test(text)) return 3;
  if (/\biO\s+Energy\b/i.test(text)) return 2;
  return 0;
}

export function parse(text) {
  const base = parseGeneric(text);

  // Cross-check consumption against the E1 register read.
  const importRead = toNumber(
    firstMatch(text, [/\/E1\s+[\d/]+\s+\w\s+[\d.,]+\s+[\d.,]+\s+([\d.,]+)/i])
  );

  const totalKwh =
    base.totalKwh ??
    (importRead != null && importRead > 0 ? importRead : null);

  return mergeDefined(base, {
    retailer: displayName,
    totalKwh,
  });
}
