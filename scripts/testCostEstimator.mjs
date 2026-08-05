/**
 * Verification for the system cost estimator.
 *
 *   node scripts/testCostEstimator.mjs
 *
 * The spec asks for these to be checked against real quote data. None is
 * committed to the repo, so the strongest available cross-check is used
 * instead: QUOTE_PRICING_2026 is an independently-sourced *post-rebate* table
 * already used by the quote checker, and SYSTEM_COSTS_2026 is pre-rebate. Take
 * the STCs off the latter and the two must land in the same place. If they
 * ever drift apart, one of the tables is stale — and the app would be telling
 * a customer one thing on the quote checker and another on the report.
 */
import {
  EQUIPMENT_TIERS,
  QUOTE_PRICING_2026,
  SYSTEM_COSTS_2026,
  getStateFromPostcode,
} from '../src/config/defaults.js';
import {
  calculateBatteryRebate,
  calculateCosts,
  calculateStc,
  costRows,
  getCommercialBatteryRate,
  getCommercialSolarRate,
  projectLifetime,
  withPayback,
} from '../src/services/costEstimator.js';

let failures = 0;

const pass = (label, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label.padEnd(54)}${detail}`);
};

const money = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-AU')}`);
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

/* ------------------------------------------------------------------ *
 * 1. State resolution
 * ------------------------------------------------------------------ */

console.log('\n1. Postcode to state');

const postcodeCases = [
  ['5000', 'SA'], ['5290', 'SA'],
  ['2000', 'NSW'], ['2480', 'NSW'],
  ['2600', 'ACT'], ['2905', 'ACT'],
  ['3000', 'VIC'], ['8001', 'VIC'],
  ['4000', 'QLD'], ['9000', 'QLD'],
  ['6000', 'WA'], ['7000', 'TAS'], ['0800', 'NT'],
];
for (const [postcode, expected] of postcodeCases) {
  pass(`${postcode} → ${expected}`, getStateFromPostcode(postcode) === expected, getStateFromPostcode(postcode));
}
pass('an unparseable postcode falls back rather than throwing', getStateFromPostcode('abc') === 'SA');
pass('Canberra is not misread as NSW', getStateFromPostcode('2601') === 'ACT');

/* ------------------------------------------------------------------ *
 * 2. STCs
 * ------------------------------------------------------------------ */

console.log('\n2. STC calculation');

const stc66 = calculateStc(6.6, 'SA');
console.log(
  `   6.6 kW in SA: ${stc66.count} STCs × $${stc66.pricePerStc} = ${money(stc66.rebate)} ` +
    `(zone ${stc66.zoneRating}, ${stc66.deemingYears} years deemed)`
);

pass(
  'STC count is capacity × zone × years, truncated',
  stc66.count === Math.floor(6.6 * 1.382 * 4),
  `${stc66.count} = floor(${(6.6 * 1.382 * 4).toFixed(2)})`
);
pass('certificates are whole units', Number.isInteger(stc66.count));
pass('the rebate is count × price', stc66.rebate === stc66.count * 35);
pass(
  'Queensland earns more than Victoria for the same system',
  calculateStc(6.6, 'QLD').count > calculateStc(6.6, 'VIC').count,
  `${calculateStc(6.6, 'QLD').count} vs ${calculateStc(6.6, 'VIC').count}`
);
pass(
  'the NT has the highest zone rating',
  Object.entries(SYSTEM_COSTS_2026.stc.zones).every(([s, v]) => s === 'NT' || v <= 1.622)
);
pass('STCs scale linearly with size', near(calculateStc(20, 'SA').count / calculateStc(10, 'SA').count, 2, 0.02));
pass('systems are capped at 100 kW for STC purposes', calculateStc(500, 'SA').count === calculateStc(100, 'SA').count);
pass('the cap is flagged so the UI can explain it', calculateStc(500, 'SA').cappedBySchemeLimit === true);
pass('a system under the cap is not flagged', calculateStc(50, 'SA').cappedBySchemeLimit === false);
pass('an unknown state falls back rather than producing NaN', Number.isFinite(calculateStc(6.6, 'XX').rebate));

/* ------------------------------------------------------------------ *
 * 3. Battery rebate
 * ------------------------------------------------------------------ */

console.log('\n3. Federal battery rebate');

const rebate10 = calculateBatteryRebate(10, false);
const rebate50 = calculateBatteryRebate(50, false);

console.log(`   10 kWh → ${money(rebate10.amount)}   50 kWh → ${money(rebate50.amount)} (capped at 30 kWh)`);

pass('10 kWh claims the full amount', rebate10.amount === 10 * 340);
pass('50 kWh is capped at 30 kWh', rebate50.amount === 30 * 340);
pass('the cap is flagged', rebate50.cappedByLimit === true);
pass('commercial sites are not eligible', calculateBatteryRebate(10, true).eligible === false);
pass('commercial sites get nothing', calculateBatteryRebate(10, true).amount === 0);
pass('no battery means no rebate', calculateBatteryRebate(0, false).amount === 0);
pass('the expiry date is carried through for the UI', rebate10.validUntil === '2026-12-31');

/* ------------------------------------------------------------------ *
 * 4. Residential costs
 * ------------------------------------------------------------------ */

console.log('\n4. Residential cost breakdown');

const home = calculateCosts({ systemKw: 6.6, batteryKwh: 0, state: 'SA', tier: 'standard' });

console.log(
  `   6.6 kW standard tier, SA` +
    `\n     solar        ${money(home.solar.low)} – ${money(home.solar.high)}` +
    `\n     STC rebate  -${money(home.stcRebate)}` +
    `\n     net          ${money(home.netTotal.low)} – ${money(home.netTotal.high)}`
);

pass('solar cost is size × rate', home.solar.mid === Math.round(6.6 * 1200));
pass('net is gross less rebates', home.netTotal.mid === home.grossTotal.mid - home.totalRebates);
pass('the range is ordered', home.netTotal.low < home.netTotal.mid && home.netTotal.mid < home.netTotal.high);
pass('no battery means no battery cost', home.battery.mid === 0);
pass('no battery means no battery rebate', home.batteryRebate.amount === 0);
pass('a home has no network extras', home.extras.length === 0);

console.log('\n   equipment tiers, 6.6 kW + 10 kWh battery in SA');
let previousTier = null;
for (const tier of EQUIPMENT_TIERS) {
  const c = calculateCosts({ systemKw: 6.6, batteryKwh: 10, state: 'SA', tier: tier.key });
  console.log(
    `     ${tier.label.padEnd(9)} net ${money(c.netTotal.low).padStart(8)} – ${money(c.netTotal.high).padStart(8)}` +
      `   (mid ${money(c.netTotal.mid)})`
  );
  if (previousTier) {
    if (!(c.netTotal.mid > previousTier)) {
      failures++;
      console.log(`     FAIL: ${tier.label} is not dearer than the tier below`);
    }
  }
  previousTier = c.netTotal.mid;
}
pass('tiers are ordered budget < standard < premium', true);
pass(
  'the rebate is identical across tiers',
  new Set(EQUIPMENT_TIERS.map((t) => calculateCosts({ systemKw: 6.6, batteryKwh: 10, state: 'SA', tier: t.key }).totalRebates)).size === 1
);
pass(
  'an unknown tier falls back to standard rather than producing NaN',
  calculateCosts({ systemKw: 6.6, state: 'SA', tier: 'gold' }).solar.mid ===
    calculateCosts({ systemKw: 6.6, state: 'SA', tier: 'standard' }).solar.mid
);

const withBattery = calculateCosts({ systemKw: 6.6, batteryKwh: 13.5, state: 'SA', tier: 'standard' });
console.log(
  `\n   6.6 kW + 13.5 kWh battery: gross ${money(withBattery.grossTotal.mid)}, ` +
    `rebates ${money(withBattery.totalRebates)}, net ${money(withBattery.netTotal.mid)}`
);
pass('battery cost is capacity × rate', withBattery.battery.mid === Math.round(13.5 * 1000));
pass('the battery rebate applies', withBattery.batteryRebate.amount === Math.round(13.5 * 340));
pass('a battery raises the net cost', withBattery.netTotal.mid > home.netTotal.mid);
pass(
  'the battery rebate never exceeds the battery cost',
  withBattery.batteryRebate.amount < withBattery.battery.low
);

pass(
  'the net cost floors at zero rather than going negative',
  calculateCosts({ systemKw: 100, state: 'NT', tier: 'budget' }).netTotal.low >= 0
);

/* ------------------------------------------------------------------ *
 * 5. Cross-check against the quote checker's table
 * ------------------------------------------------------------------ */

console.log('\n5. Cross-check: pre-rebate table less STCs vs the post-rebate table');

for (const systemKw of [6.6, 10, 13.2]) {
  const costs = calculateCosts({ systemKw, state: 'SA', tier: 'standard' });
  const quoteMid = systemKw * QUOTE_PRICING_2026.solar.standard.mid;
  const drift = (costs.netTotal.mid / quoteMid - 1) * 100;

  console.log(
    `   ${String(systemKw).padStart(4)} kW  this model ${money(costs.netTotal.mid).padStart(8)}   ` +
      `quote checker ${money(quoteMid).padStart(8)}   drift ${drift >= 0 ? '+' : ''}${drift.toFixed(1)}%`
  );
  pass(
    `${systemKw} kW: the two tables agree within 20%`,
    Math.abs(drift) < 20,
    `${drift.toFixed(1)}%`
  );
}

pass(
  'a 6.6 kW net cost is in the range Australians actually pay',
  (() => {
    const net = calculateCosts({ systemKw: 6.6, state: 'SA', tier: 'standard' }).netTotal;
    return net.low > 3000 && net.high < 10000;
  })(),
  (() => {
    const n = calculateCosts({ systemKw: 6.6, state: 'SA', tier: 'standard' }).netTotal;
    return `${money(n.low)} – ${money(n.high)}`;
  })()
);
pass(
  'a 13.5 kWh battery nets out near the $8–12k people are quoted',
  (() => {
    const solarOnly = calculateCosts({ systemKw: 6.6, state: 'SA' }).netTotal.mid;
    const both = calculateCosts({ systemKw: 6.6, batteryKwh: 13.5, state: 'SA' }).netTotal.mid;
    return both - solarOnly > 7000 && both - solarOnly < 13000;
  })(),
  money(
    calculateCosts({ systemKw: 6.6, batteryKwh: 13.5, state: 'SA' }).netTotal.mid -
      calculateCosts({ systemKw: 6.6, state: 'SA' }).netTotal.mid
  )
);

/* ------------------------------------------------------------------ *
 * 6. Commercial
 * ------------------------------------------------------------------ */

console.log('\n6. Commercial pricing and network extras');

pass('under 30 kW uses the small commercial band', getCommercialSolarRate(20).mid === 1100);
pass('30–100 kW uses the mid band', getCommercialSolarRate(50).mid === 950);
pass('over 100 kW uses the large band', getCommercialSolarRate(150).mid === 850);
pass('battery bands follow the same shape', getCommercialBatteryRate(20).mid === 900 && getCommercialBatteryRate(150).mid === 650);

console.log('\n   commercial systems in SA');
for (const kw of [20, 50, 150]) {
  const c = calculateCosts({ systemKw: kw, batteryKwh: 0, state: 'SA', isCommercial: true });
  console.log(
    `     ${String(kw).padStart(3)} kW   net ${money(c.netTotal.mid).padStart(9)}   ` +
      `$/kW ${money(c.netTotal.mid / kw).padStart(7)}   extras ${c.extras.length ? c.extras.map((e) => e.label).join(', ') : 'none'}`
  );
}

const small = calculateCosts({ systemKw: 20, state: 'SA', isCommercial: true });
const medium = calculateCosts({ systemKw: 50, state: 'SA', isCommercial: true });
const large = calculateCosts({ systemKw: 150, state: 'SA', isCommercial: true });

pass('under 30 kW attracts no network fees', small.extras.length === 0);
pass('over 30 kW attracts the connection application', medium.extras.some((e) => /connection/i.test(e.label)));
pass('over 100 kW attracts both fees', large.extras.length === 2);
pass('extras are added to the total', medium.grossTotal.mid === medium.solar.mid + 4500);
pass(
  'commercial is cheaper per kW than residential',
  small.solar.mid / 20 < calculateCosts({ systemKw: 20, state: 'SA' }).solar.mid / 20
);
pass('cost per kW falls as commercial systems grow', large.solar.mid / 150 < small.solar.mid / 20);
pass('commercial gets no battery rebate', calculateCosts({ systemKw: 50, batteryKwh: 50, state: 'SA', isCommercial: true }).batteryRebate.amount === 0);
pass(
  'a 150 kW system still only earns STCs on 100 kW',
  large.stcCount === calculateStc(100, 'SA').count
);

/* ------------------------------------------------------------------ *
 * 7. Payback and the 25-year projection
 * ------------------------------------------------------------------ */

console.log('\n7. Payback and lifetime value');

const priced = withPayback(
  calculateCosts({ systemKw: 6.6, batteryKwh: 0, state: 'SA', tier: 'standard' }),
  { low: 1200, mid: 1450, high: 1700 }
);

console.log(
  `   6.6 kW, saving $1,200–$1,700/yr` +
    `\n     simple payback      ${priced.paybackYears.low} – ${priced.paybackYears.high} years` +
    `\n     with degradation    ${priced.discountedPayback.low} – ${priced.discountedPayback.high} years` +
    `\n     25-year net benefit ${money(priced.netBenefit25Year.low)} – ${money(priced.netBenefit25Year.high)}`
);

pass('payback is calculated', priced.paybackYears.mid > 0);
pass('the payback range is ordered', priced.paybackYears.low < priced.paybackYears.high);
pass(
  'the best case pairs the cheapest install with the biggest saving',
  near(priced.paybackYears.low, priced.netTotal.low / 1700, 0.05)
);
pass(
  'the worst case pairs the dearest install with the smallest saving',
  near(priced.paybackYears.high, priced.netTotal.high / 1200, 0.05)
);
pass(
  'accounting for rising prices shortens payback',
  priced.discountedPayback.mid < priced.paybackYears.mid,
  `${priced.discountedPayback.mid} vs ${priced.paybackYears.mid} years`
);
pass('a 6.6 kW payback lands in the 3–8 year range Australians see', priced.paybackYears.mid > 3 && priced.paybackYears.mid < 8, `${priced.paybackYears.mid} years`);
pass('the 25-year benefit is positive and large', priced.netBenefit25Year.mid > 20000, money(priced.netBenefit25Year.mid));
pass('the projection runs 25 rows', priced.lifetime.mid.rows.length === 25);
pass('zero savings produce no payback rather than infinity', withPayback(priced, { low: 0, mid: 0, high: 0 }).paybackYears.mid === null);
pass(
  'a payback beyond 40 years is reported as none rather than a silly number',
  withPayback(calculateCosts({ systemKw: 6.6, state: 'SA' }), { low: 20, mid: 20, high: 20 }).paybackYears.mid === null
);

const projection = priced.lifetime.mid;
pass('year 1 output is 100%', projection.rows[0].outputFactor === 1);
pass(
  'year 25 output is about 88% after 0.5%/yr degradation',
  near(projection.rows[24].outputFactor, 0.885, 0.01),
  `${(projection.rows[24].outputFactor * 100).toFixed(1)}%`
);
pass(
  'savings still rise over time despite degradation',
  projection.rows[24].saving > projection.rows[0].saving,
  `${money(projection.rows[0].saving)} → ${money(projection.rows[24].saving)}`
);
pass('cumulative cash starts negative', projection.rows[0].cumulative < 0 || projection.rows[0].saving > projection.netCost);
pass('cumulative cash ends positive', projection.rows[24].cumulative > 0);
pass('the break-even year is inside the horizon', projection.breakEvenYear > 0 && projection.breakEvenYear < 25);
pass(
  'cumulative is the running sum of savings less replacements',
  near(
    projection.rows[24].cumulative,
    projection.rows.reduce((s, r) => s + r.saving - r.replacement, 0) - projection.netCost,
    2
  )
);

const batteryProjection = withPayback(
  calculateCosts({ systemKw: 6.6, batteryKwh: 13.5, state: 'SA' }),
  { low: 1800, mid: 2100, high: 2400 }
).lifetime.mid;

console.log(
  `\n   with a 13.5 kWh battery: replacement of ${money(batteryProjection.totalReplacements)} in year ` +
    `${batteryProjection.rows.find((r) => r.replacement > 0)?.year}`
);

pass('a battery replacement is deducted once', batteryProjection.rows.filter((r) => r.replacement > 0).length === 1);
pass(
  'the replacement lands after the warranted life',
  batteryProjection.rows.find((r) => r.replacement > 0).year === SYSTEM_COSTS_2026.projection.batteryLifeYears + 1
);
pass('a solar-only system has no replacement cost', projection.totalReplacements === 0);
pass(
  'the replacement dents the cumulative line',
  (() => {
    const i = batteryProjection.rows.findIndex((r) => r.replacement > 0);
    const before = batteryProjection.rows[i - 1];
    const after = batteryProjection.rows[i];
    return after.cumulative - before.cumulative < before.cumulative - batteryProjection.rows[i - 2].cumulative;
  })()
);

/* ------------------------------------------------------------------ *
 * 8. Table rows
 * ------------------------------------------------------------------ */

console.log('\n8. Cost table rows');

const rows = costRows(calculateCosts({ systemKw: 6.6, batteryKwh: 13.5, state: 'SA' }));
for (const row of rows) {
  console.log(`   ${row.label.padEnd(48)} ${(row.low === row.high ? money(row.low) : `${money(row.low)} – ${money(row.high)}`).padStart(20)}`);
}

pass('every section is represented', rows.length === 4);
pass('rebates are negative and flagged as credits', rows.filter((r) => r.credit).every((r) => r.low < 0));
pass('the STC row names the certificate count', /\d+ certificates/.test(rows[0].label) || /\d+ certificates/.test(rows[1].label));
pass(
  'the rows reconcile to the net total',
  (() => {
    const costs = calculateCosts({ systemKw: 6.6, batteryKwh: 13.5, state: 'SA' });
    const summed = costRows(costs).reduce((s, r) => s + r.low, 0);
    return near(summed, costs.netTotal.low, 1);
  })()
);
pass('a solar-only system has no battery rows', costRows(calculateCosts({ systemKw: 6.6, state: 'SA' })).length === 2);
pass(
  'commercial extras appear as their own rows',
  costRows(calculateCosts({ systemKw: 150, state: 'SA', isCommercial: true })).some((r) => /study/i.test(r.label))
);

console.log(
  `\n${failures === 0 ? 'All cost estimator checks passed.' : `${failures} check(s) FAILED.`}`
);
process.exit(failures > 0 ? 1 : 0);
