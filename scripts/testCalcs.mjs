/**
 * Smoke-test the calculation engine end to end, using a bill parsed from a
 * real sample rather than made-up numbers.
 *
 *   node scripts/testCalcs.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWithPatterns } from '../src/services/retailerPatterns/index.js';
import { applyConfidence } from '../src/services/confidence.js';
import {
  calculateSelfConsumption,
  buildConsumptionProfile,
  calculateScenario,
  calculateSystemSize,
  estimateExistingSolarSize,
  sizeForNearZeroBill,
} from '../src/services/calculationEngine.js';
import { DEFAULTS, detectMode, getMode } from '../src/config/defaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const irradiance = JSON.parse(
  await fs.readFile(path.join(__dirname, '..', 'public', 'data', 'solarIrradiance.json'), 'utf8')
);

const text = await fs.readFile(
  path.join(__dirname, 'sample-text', 'abe-chandra-sept25.txt'),
  'utf8'
);

const bill = applyConfidence(parseWithPatterns(text).data, 'pdf-text');
const solar = { postcode: bill.postcode, ...irradiance.postcodes[bill.postcode] };

console.log(`Bill: ${bill.retailer}, ${bill.postcode} ${solar.name}`);
console.log(`  ${bill.totalKwh} kWh over ${bill.billingDays} days @ ${bill.tariffRateCentsPerKwh.toFixed(2)}c/kWh`);
console.log(`  PSH ${solar.annual} | export ${bill.solarExportKwh} kWh @ ${bill.feedInTariffCents.toFixed(2)}c\n`);

const roof = { orientation: 'N', pitchDegrees: 22.5, shading: 'none' };

let failures = 0;
const assert = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!condition) failures++;
};

for (const battery of [0, 10, 13.5]) {
  const scenario = calculateScenario(bill, solar, roof, battery);
  const { sizing, production, savings } = scenario;

  console.log(
    `${battery} kWh battery: ${scenario.systemKw} kW, ${production.annual} kWh/yr, ` +
      `self-consumption ${savings.selfConsumptionPercent}%, ` +
      `saves $${savings.annualSavingsLow}-${savings.annualSavingsHigh}/yr ` +
      `(bill $${savings.currentAnnualBill} -> $${savings.newAnnualBillLow}-${savings.newAnnualBillHigh})`
  );

  assert('production covers consumption within 5%',
    Math.abs(production.annual - sizing.annualConsumption) / sizing.annualConsumption < 0.05,
    `${production.annual} vs ${sizing.annualConsumption}`);

  assert('savings are positive and below the current bill',
    savings.annualSavingsMid > 0 && savings.annualSavingsMid < savings.currentAnnualBill);

  assert('new bill = current bill - savings',
    Math.abs((savings.currentAnnualBill - savings.annualSavingsMid) - savings.newAnnualBillMid) <= 2,
    `${savings.currentAnnualBill} - ${savings.annualSavingsMid} vs ${savings.newAnnualBillMid}`);

  assert('self-consumed + exported = production',
    Math.abs(savings.selfConsumedKwh + savings.exportedKwh - production.annual) <= 2);

  assert('monthly production sums to annual',
    Math.abs(Object.values(production.monthly).reduce((a, b) => a + b, 0) - production.annual) <= 12);
}

// A battery must increase self-consumption and therefore savings.
const none = calculateScenario(bill, solar, roof, 0);
const big = calculateScenario(bill, solar, roof, 13.5);
console.log('\nbattery effect');
assert('battery raises self-consumption',
  big.savings.selfConsumptionPercent > none.savings.selfConsumptionPercent,
  `${none.savings.selfConsumptionPercent}% -> ${big.savings.selfConsumptionPercent}%`);
assert('battery raises savings',
  big.savings.annualSavingsMid > none.savings.annualSavingsMid,
  `$${none.savings.annualSavingsMid} -> $${big.savings.annualSavingsMid}`);

// Existing solar inference from export volume.
console.log('\nexisting solar');
const existing = estimateExistingSolarSize(bill, solar);
console.log(`  estimated existing system: ${existing} kW (from ${bill.solarExportKwh} kWh export)`);
assert('tiny export implies a small or unknown system', existing == null || existing < 1);

// Multi-bill profile, using both Origin farm statements.
console.log('\nmulti-bill profile');
const farmBills = [];
for (const f of ['origin-farm-2024-11.txt', 'origin-farm-2025-10.txt']) {
  const t = await fs.readFile(path.join(__dirname, 'sample-text', f), 'utf8');
  farmBills.push(applyConfidence(parseWithPatterns(t).data, 'pdf-text'));
}
const profile = buildConsumptionProfile(farmBills);
console.log(`  ${profile.monthsCovered} months covered, accuracy "${profile.accuracy}", ~${profile.annualEstimate} kWh/yr`);
assert('November and October are marked as covered',
  profile.coverage.nov && profile.coverage.oct);
assert('uncovered months fall back to the overall average', profile.monthly.mar != null);
assert('accuracy reflects partial coverage', profile.accuracy === 'fair');

/* ---------------- battery interpolation curve ---------------- */

console.log('\nself-consumption model');
// Detailed verification lives in testSelfConsumption.mjs; these guard the
// properties the rest of the engine depends on.
assert('no battery returns the base ratio',
  calculateSelfConsumption(0, 6.6, 4.5, 0.78, false) === 0.3 &&
  calculateSelfConsumption(0, 500, 4.8, 0.78, true) === 0.55);

assert('rises monotonically with battery size', (() => {
  let previous = -1;
  for (let k = 0; k <= 60; k += 0.5) {
    const value = calculateSelfConsumption(k, 6.6, 4.5, 0.78, false);
    if (value < previous - 1e-9) return false;
    previous = value;
  }
  return true;
})());

// The bug this model replaced: identical ratios for different battery sizes
// on a large system.
const bigSystem = [30, 50, 100].map((k) => calculateSelfConsumption(k, 500, 4.8, 0.78, true));
assert('distinct ratios for 30/50/100 kWh on a 500 kW system',
  new Set(bigSystem.map((v) => v.toFixed(5))).size === 3,
  bigSystem.map((v) => `${(v * 100).toFixed(1)}%`).join(' / '));

assert('the same battery is worth less on a bigger system',
  calculateSelfConsumption(30, 6.6, 4.8, 0.78, false) >
    calculateSelfConsumption(30, 500, 4.8, 0.78, false));

assert('never exceeds the 98% ceiling',
  calculateSelfConsumption(100000, 6.6, 4.5, 0.78, false) <= 0.98 + 1e-9);

/* ---------------- practical minimum system size ---------------- */

console.log('\npractical minimum size');
const smallBill = { dailyAverageKwh: 6, billingDays: 90, totalKwh: 540,
  tariffRateCentsPerKwh: 40, dailySupplyChargeCents: 100 };
const smallSizing = calculateSystemSize(smallBill, solar, roof);
console.log(`  6 kWh/day home: coverage ${smallSizing.coverageKw} kW -> recommended ${smallSizing.recommendedKw} kW`);
assert('floor lifts a tiny system to the practical minimum',
  smallSizing.recommendedKw === DEFAULTS.sizing.practicalMinimumKw);
assert('floor is flagged so the UI can explain it', smallSizing.practicalFloorApplied === true);
assert('coverage size is still reported', smallSizing.coverageKw < smallSizing.recommendedKw);

const bigSizing = calculateSystemSize(bill, solar, roof);
assert('high-usage home is unaffected by the floor',
  bigSizing.practicalFloorApplied === false &&
  bigSizing.recommendedKw === bigSizing.coverageKw);

/* ---------------- near-zero bill sizing ---------------- */

console.log('\nnear-zero bill');
for (const batt of [0, 13.5]) {
  const nz = sizeForNearZeroBill(bill, solar, roof, batt);
  const at = calculateScenario(bill, solar, roof, batt, nz.kw);
  const supplyOnly = Math.round(nz.supplyChargeAnnual);
  console.log(
    `  ${batt} kWh battery -> ${nz.kw} kW (reachable: ${nz.reachable}), ` +
      `bill $${at.savings.newAnnualBillMid}/yr vs supply-only $${supplyOnly}`
  );
  assert(`near-zero size is within the slider range (${batt} kWh)`,
    nz.kw >= getMode('home').slider.minKw && nz.kw <= getMode('home').slider.maxKw);
  if (nz.reachable) {
    assert(`near-zero bill lands at or under the target (${batt} kWh)`,
      at.savings.newAnnualBillMid <= supplyOnly + Math.round(
        bigSizing.annualConsumption * (bill.tariffRateCentsPerKwh / 100) * 0.05) + 2);
  }
}

const nzNone = sizeForNearZeroBill(bill, solar, roof, 0);
const nzBatt = sizeForNearZeroBill(bill, solar, roof, 13.5);
assert('a battery lowers the size needed for a near-zero bill',
  nzBatt.kw <= nzNone.kw, `${nzNone.kw} kW -> ${nzBatt.kw} kW`);

/* ---------------- slider behaviour ---------------- */

console.log('\nslider sizing');
const small = calculateScenario(bill, solar, roof, 0, 6.6);
const large = calculateScenario(bill, solar, roof, 0, 20);
assert('bigger system produces more', large.production.annual > small.production.annual);
assert('bigger system saves more', large.savings.annualSavingsMid > small.savings.annualSavingsMid);
assert('panel count tracks the selected size',
  small.panelCount === Math.ceil(6.6 / (DEFAULTS.sizing.wattsPerPanel / 1000)) &&
  large.panelCount > small.panelCount);
// The oversizing derate means a larger system on the same load self-consumes
// a smaller share — restored deliberately after the first Round 5 model made
// the base size-independent.
assert('self-consumption share falls as the system outgrows the load',
  large.savings.selfConsumptionPercent < small.savings.selfConsumptionPercent,
  `${small.savings.selfConsumptionPercent}% at 6.6 kW -> ${large.savings.selfConsumptionPercent}% at 20 kW`);
assert('self-consumed energy is still capped by actual consumption',
  large.savings.selfConsumedKwh <= large.savings.annualConsumption + 1);

/* ---------------- full-bill savings ceiling ---------------- */

console.log('\nfull-bill savings ceiling');
// A tiny load with a huge system: savings may offset the whole bill (energy +
// supply charge) via export credits, but must not go past a fully paid bill.
const tinyBill = { dailyAverageKwh: 3, billingDays: 90, totalKwh: 270,
  tariffRateCentsPerKwh: 40, dailySupplyChargeCents: 110, feedInTariffCents: 5 };
const huge = calculateScenario(tinyBill, solar, roof, 0, 30);
const supplyFloor = Math.round((110 / 100) * 365);
console.log(
  `  3 kWh/day + 30 kW: bill $${huge.savings.currentAnnualBill} -> ` +
    `$${huge.savings.newAnnualBillLow}-${huge.savings.newAnnualBillHigh}, ` +
    `saves $${huge.savings.annualSavingsLow}-${huge.savings.annualSavingsHigh} ` +
    `(connection fee $${supplyFloor})`
);
assert('bill never goes negative',
  huge.savings.newAnnualBillLow >= 0 && huge.savings.newAnnualBillMid >= 0);
assert('minAnnualBill is zero once export can offset the connection fee',
  huge.savings.minAnnualBill === 0);
assert('connection fee is still reported',
  huge.savings.supplyChargeAnnual === supplyFloor);
assert('savings never exceed the full current bill',
  huge.savings.annualSavingsHigh <= huge.savings.currentAnnualBill);
assert('the cap is flagged when export would overshoot',
  huge.savings.savingsCapped === true);
assert('bills and savings reconcile',
  huge.savings.newAnnualBillLow === Math.max(
    huge.savings.currentAnnualBill - huge.savings.annualSavingsHigh, 0));

// A normal case must be untouched by the ceiling.
const normal = calculateScenario(bill, solar, roof, 0, 10);
assert('a normal case is not capped', normal.savings.savingsCapped === false);
assert('normal bill = current - savings',
  normal.savings.newAnnualBillMid ===
    normal.savings.currentAnnualBill - normal.savings.annualSavingsMid);
assert('breakdown sums to the mid saving',
  Math.abs(normal.savings.breakdown.fromSelfConsumption +
    normal.savings.breakdown.fromExport - normal.savings.annualSavingsMid) <= 1,
  `${normal.savings.breakdown.fromSelfConsumption} + ${normal.savings.breakdown.fromExport} vs ${normal.savings.annualSavingsMid}`);

// Battery and larger solar must keep moving the dollars until the bill is gone.
console.log('\nbattery and solar differentiation');
const modest = { dailyAverageKwh: 12, billingDays: 90, totalKwh: 1080,
  tariffRateCentsPerKwh: 36, dailySupplyChargeCents: 110, feedInTariffCents: 5 };
const at66 = [0, 5, 10, 13.5].map((b) =>
  calculateScenario(modest, solar, roof, b, 6.6).savings.annualSavingsMid);
console.log(`  6.6 kW savings by battery: ${at66.join(' / ')}`);
assert('Solar + 5 kWh beats Solar only', at66[1] > at66[0],
  `$${at66[0]} -> $${at66[1]}`);
assert('Solar + 13.5 kWh is the highest of the presets',
  at66[3] >= at66[2] && at66[3] > at66[0],
  `$${at66.join(' / ')}`);

const solarOnlyBySize = [8, 10, 13].map((kw) =>
  calculateScenario(modest, solar, roof, 0, kw).savings.annualSavingsMid);
console.log(`  solar-only savings by size: 8/10/13 kW = ${solarOnlyBySize.join(' / ')}`);
assert('larger solar keeps raising savings before the bill is fully offset',
  solarOnlyBySize[0] < solarOnlyBySize[1] && solarOnlyBySize[1] < solarOnlyBySize[2],
  `$${solarOnlyBySize.join(' < ')}`);

/* ---------------- home vs business mode ---------------- */

console.log('\nsite type');
assert('a house is detected as home', detectMode(18) === 'home');
assert('a heavy site is suggested as business', detectMode(120) === 'business');
assert('the threshold is exclusive', detectMode(50) === 'home');

const homeMode = getMode('home');
const bizMode = getMode('business');
assert('unknown mode falls back to home', getMode('nonsense').key === 'home');
assert('business allows far larger systems',
  bizMode.slider.maxKw === 200 && homeMode.slider.maxKw === 30);
assert('business has a higher practical minimum',
  bizMode.practicalMinimumKw === 10 && homeMode.practicalMinimumKw === 6.6);

// The farm bill needs far more than a home slider allows.
const farm = { dailyAverageKwh: 1643, billingDays: 61, totalKwh: 100177,
  tariffRateCentsPerKwh: 13.8, dailySupplyChargeCents: 800 };
const asHome = calculateSystemSize(farm, solar, roof, 'home');
const asBiz = calculateSystemSize(farm, solar, roof, 'business');
console.log(`  farm sized as home ${asHome.recommendedKw} kW, as business ${asBiz.recommendedKw} kW`);
assert('home mode caps the farm at 30 kW', asHome.recommendedKw === 30);
assert('business mode allows a realistic size', asBiz.recommendedKw > 30);
assert('the home cap is flagged', asHome.cappedByLimit === true);

// Small business floor.
const smallBiz = calculateSystemSize(smallBill, solar, roof, 'business');
assert('business floor lifts a small site to 10 kW', smallBiz.recommendedKw === 10);

// Near-zero must respect each mode's ceiling.
const nzBiz = sizeForNearZeroBill(farm, solar, roof, 0, 'business');
assert('near-zero stays within the business range',
  nzBiz.kw >= bizMode.slider.minKw && nzBiz.kw <= bizMode.slider.maxKw);

/* ---------------- commercial battery curve ---------------- */

console.log('\ncommercial self-consumption');
assert('commercial base beats residential base',
  calculateSelfConsumption(0, 100, 4.8, 0.78, true) >
    calculateSelfConsumption(0, 100, 4.8, 0.78, false));
assert('monotonic across commercial battery sizes', (() => {
  let previous = -1;
  for (let k = 0; k <= 250; k += 2.5) {
    const value = calculateSelfConsumption(k, 500, 4.8, 0.78, true);
    if (value < previous - 1e-9) return false;
    previous = value;
  }
  return true;
})());

console.log(`\n${failures === 0 ? 'All calculation checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures > 0 ? 1 : 0);
