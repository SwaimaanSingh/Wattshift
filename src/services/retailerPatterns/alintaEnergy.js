/**
 * Alinta Energy.
 *
 * Verified against: mclaren-vale-caravan (business flat rate, estimated read,
 * split by a 1 July price change).
 *
 * Layout notes:
 * - "Supply period: 03 Apr 2025 - 06 Jul 2025" (no day count on that line —
 *   the two sub-blocks state "(89 Days)" and "(6 Days)" which sum to 95).
 * - Rows read "Peak - Step 1  731.811 kWh  $0.48862  $357.58".
 * - "Total (Inc. $45.64 GST) $502.07" is the payable figure.
 * - A rate calendar at the foot repeats rates as "48.862 c/kWh" with no year
 *   on its date range, which is why findDateRanges requires parsable years.
 */
import { parse as parseGeneric } from './generic.js';
import { firstMatch, mergeDefined, toNumber } from './_shared.js';

export const id = 'alintaEnergy';
export const displayName = 'Alinta Energy';

export function detect(text) {
  if (/alintaenergy\.com\.au/i.test(text)) return 3;
  if (/\bAlinta\s+Energy\b/i.test(text)) return 3;
  if (/\bAlinta\b/i.test(text)) return 1;
  return 0;
}

export function parse(text) {
  const base = parseGeneric(text);

  const total =
    base.totalBillAmount ??
    toNumber(
      firstMatch(text, [
        /total\s*\(inc\.?[^)]*\)\s*\$\s?([\d,]+\.\d{2})/i,
        /direct\s+debit\s+amount\s*\$\s?([\d,]+\.\d{2})/i,
      ])
    );

  return mergeDefined(base, {
    retailer: displayName,
    totalBillAmount: total,
  });
}
