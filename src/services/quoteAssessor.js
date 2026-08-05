/**
 * Assess an installer's quote against 2026 Australian market rates.
 *
 * The output is deliberately a band with a verdict attached, not a
 * pass/fail. A price above the range can be entirely justified by premium
 * equipment or a difficult roof, and a price below it is a warning rather
 * than a bargain — so every verdict carries the reasoning.
 */
import { QUOTE_PRICING_2026 } from '../config/defaults.js';

/**
 * @typedef {Object} QuoteAssessment
 * @property {'suspiciously_low'|'good_deal'|'fair'|'above_average'|'overpriced'} verdict
 * @property {string} headline
 * @property {string} message
 * @property {{low: number, mid: number, high: number}} range
 * @property {number} perKwQuoted
 * @property {number} batteryRebate
 * @property {number} quotedPrice
 */

/**
 * @param {Object} input
 * @param {number} input.systemKw
 * @param {number} input.quotedPrice - total quoted, after rebates
 * @param {number} [input.batteryKwh]
 * @param {boolean} [input.batteryIncluded] - is the battery inside that total
 * @param {string} [input.state]
 * @returns {QuoteAssessment|null}
 */
export function assessQuote({
  systemKw,
  quotedPrice,
  batteryKwh = 0,
  batteryIncluded = false,
  state = 'SA',
}) {
  if (!(systemKw > 0) || !(quotedPrice > 0)) return null;

  const { solar, battery } = QUOTE_PRICING_2026;

  let totalLow = systemKw * solar.budget.min;
  let totalMid = systemKw * solar.standard.mid;
  let totalHigh = systemKw * solar.premium.max;

  let batteryRebate = 0;

  // Only fold battery cost in when the quoted total actually covers it.
  if (batteryKwh > 0 && batteryIncluded) {
    batteryRebate = batteryKwh * battery.federalRebatePerKwh;

    totalLow += Math.max(batteryKwh * battery.perKwh.min - batteryRebate, 0);
    totalMid += Math.max(batteryKwh * battery.perKwh.mid - batteryRebate, 0);
    totalHigh += Math.max(batteryKwh * battery.perKwh.max - batteryRebate, 0);
  }

  const range = {
    low: Math.round(totalLow),
    mid: Math.round(totalMid),
    high: Math.round(totalHigh),
  };
  const perKwQuoted = quotedPrice / systemKw;

  const base = { range, perKwQuoted, batteryRebate: Math.round(batteryRebate), quotedPrice, state };

  if (quotedPrice < totalLow * 0.8) {
    return {
      ...base,
      verdict: 'suspiciously_low',
      headline: 'Unusually low — check what you\'re getting',
      message:
        'This price seems unusually low. Very cheap systems often use lower-quality panels or inverters, skip proper installation steps, or leave costs out of the headline figure. Ask the installer which panels and inverter are included, and check both are CEC-approved.',
    };
  }

  if (quotedPrice <= totalMid) {
    return {
      ...base,
      verdict: 'good_deal',
      headline: 'This looks like a competitive price',
      message:
        'Make sure the quote includes Tier 1 panels, a reputable inverter brand, and a workmanship warranty of at least 5 years.',
    };
  }

  if (quotedPrice <= totalHigh) {
    return {
      ...base,
      verdict: 'fair',
      headline: 'Within the normal range',
      message:
        'This is a normal price for a quality installation. If it includes premium panels (REC, SunPower, Q Cells) and a premium inverter (Fronius, Enphase), the price is justified.',
    };
  }

  if (quotedPrice <= totalHigh * 1.3) {
    return {
      ...base,
      verdict: 'above_average',
      headline: 'Above the typical range',
      message:
        'This sits above what most people pay. It can be justified by premium equipment, a complex roof layout, or specialist installation needs — but it is worth getting a second quote to compare.',
    };
  }

  return {
    ...base,
    verdict: 'overpriced',
    headline: 'Significantly above market rates',
    message:
      "This appears well above what this system should cost. We'd strongly recommend getting two or three more quotes before committing.",
  };
}

/** Where the quote sits on the range, 0–1, for the marker position. */
export function quotePosition(assessment) {
  if (!assessment) return 0;
  const { range, quotedPrice } = assessment;
  // Plot across a span a little wider than low..high so extremes stay visible.
  const spanLow = range.low * 0.7;
  const spanHigh = range.high * 1.35;
  const t = (quotedPrice - spanLow) / (spanHigh - spanLow);
  return Math.min(1, Math.max(0, t));
}

export const VERDICT_TONE = {
  suspiciously_low: 'amber',
  good_deal: 'green',
  fair: 'green',
  above_average: 'amber',
  overpriced: 'red',
};
