/**
 * Quote checker verification.
 *   node scripts/testQuoteAssessor.mjs
 */
import { assessQuote, quotePosition } from '../src/services/quoteAssessor.js';
import { QUOTE_PRICING_2026 } from '../src/config/defaults.js';

let failures = 0;
const check = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

const money = (n) => `$${Math.round(n).toLocaleString('en-AU')}`;

console.log('\n6.6 kW solar only — expected range');
const r = assessQuote({ systemKw: 6.6, quotedPrice: 6600 });
console.log(`  range ${money(r.range.low)} – ${money(r.range.mid)} – ${money(r.range.high)}`);
check('low end is budget x kW', r.range.low === Math.round(6.6 * 650), money(r.range.low));
check('mid is standard x kW', r.range.mid === Math.round(6.6 * 1000), money(r.range.mid));
check('high is premium x kW', r.range.high === Math.round(6.6 * 1500), money(r.range.high));

console.log('\nVerdict boundaries for a 6.6 kW system');
const verdictAt = (price) => assessQuote({ systemKw: 6.6, quotedPrice: price }).verdict;
const cases = [
  [3000, 'suspiciously_low'],
  [5000, 'good_deal'],
  [6600, 'good_deal'],
  [8000, 'fair'],
  [9900, 'fair'],
  [11000, 'above_average'],
  [12870, 'above_average'],
  [20000, 'overpriced'],
];
for (const [price, expected] of cases) {
  const actual = verdictAt(price);
  check(`${money(price).padStart(8)} -> ${expected}`, actual === expected, actual !== expected ? `got ${actual}` : '');
}

console.log('\nBattery handling');
const withBattery = assessQuote({
  systemKw: 6.6, quotedPrice: 20000, batteryKwh: 10, batteryIncluded: true,
});
const withoutBattery = assessQuote({ systemKw: 6.6, quotedPrice: 20000 });
check('battery widens the expected range',
  withBattery.range.high > withoutBattery.range.high,
  `${money(withoutBattery.range.high)} -> ${money(withBattery.range.high)}`);

const rebate = 10 * QUOTE_PRICING_2026.battery.federalRebatePerKwh;
check('federal rebate is subtracted', withBattery.batteryRebate === rebate, money(rebate));
check('rebate lowers the low end vs no rebate',
  withBattery.range.low === Math.round(6.6 * 650 + Math.max(10 * 650 - rebate, 0)),
  money(withBattery.range.low));

const notIncluded = assessQuote({
  systemKw: 6.6, quotedPrice: 20000, batteryKwh: 10, batteryIncluded: false,
});
check('battery excluded from total is not priced in',
  notIncluded.range.high === withoutBattery.range.high);
check('excluding the battery makes the same price look worse',
  notIncluded.verdict === 'overpriced' && withBattery.verdict !== 'overpriced',
  `${notIncluded.verdict} vs ${withBattery.verdict}`);

console.log('\nRebate never pushes battery cost below zero');
const hugeRebate = assessQuote({
  systemKw: 5, quotedPrice: 5000, batteryKwh: 1, batteryIncluded: true,
});
check('battery contribution floored at zero',
  hugeRebate.range.low >= Math.round(5 * 650),
  money(hugeRebate.range.low));

console.log('\nMarker position');
check('cheap quote sits near the left', quotePosition(assessQuote({ systemKw: 6.6, quotedPrice: 3000 })) < 0.2);
check('expensive quote sits near the right', quotePosition(assessQuote({ systemKw: 6.6, quotedPrice: 25000 })) > 0.9);
check('position always within 0..1', [500, 5000, 50000, 500000].every((p) => {
  const v = quotePosition(assessQuote({ systemKw: 6.6, quotedPrice: p }));
  return v >= 0 && v <= 1;
}));

console.log('\nInvalid input');
check('zero system size returns null', assessQuote({ systemKw: 0, quotedPrice: 5000 }) === null);
check('zero price returns null', assessQuote({ systemKw: 6.6, quotedPrice: 0 }) === null);

console.log('\nLarge commercial quote');
const comm = assessQuote({ systemKw: 100, quotedPrice: 95000 });
console.log(`  100 kW at ${money(95000)} -> ${comm.verdict}, ${money(comm.perKwQuoted)}/kW`);
check('per-kW figure is reported', Math.abs(comm.perKwQuoted - 950) < 1);

console.log(`\n${failures === 0 ? 'All quote checker tests passed.' : `${failures} test(s) FAILED.`}`);
process.exit(failures > 0 ? 1 : 0);
