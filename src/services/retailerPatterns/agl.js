/**
 * AGL.
 *
 * Verified against: mcsherry-march2026 (residential TOU + two-tier feed-in).
 *
 * Layout notes:
 * - "Bill period: 6 Mar 2026 to 5 Apr 2026 (31 days)"
 * - No total-usage line; Peak/Off peak/Shoulder rows must be summed.
 * - Exports sit under a "Solar export" heading and the second row is labelled
 *   "Next" with no solar wording, so heading tracking does the work.
 * - The bill is *posted* to a different address than it supplies.
 */
import { parse as parseGeneric } from './generic.js';
import { firstMatch, mergeDefined, toNumber, rateToCents, isPlausibleSupplyCharge } from './_shared.js';

export const id = 'agl';
export const displayName = 'AGL';

export function detect(text) {
  if (/\bagl\.com\.au\b/i.test(text)) return 3;
  if (/\bAGL\s+(South Australia|Sales|Energy)\b/i.test(text)) return 3;
  if (/\bAGL\b/.test(text)) return 1;
  return 0;
}

export function parse(text) {
  const base = parseGeneric(text);

  const supply = rateToCents(
    toNumber(firstMatch(text, [/supply\s+charge\s+daily\s+\d+\s*days?\s+\$\s?([\d.]+)/i])),
    '$'
  );

  return mergeDefined(base, {
    retailer: displayName,
    dailySupplyChargeCents: isPlausibleSupplyCharge(supply) ? supply : null,
  });
}
