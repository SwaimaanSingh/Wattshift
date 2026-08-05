/**
 * Verification for setup-change detection and existing-system sizing.
 *
 *   node scripts/testExistingSystemEstimate.mjs
 *
 * The fixture mirrors the real file this feature was built against: 494 days
 * spanning a solar-and-battery install partway through, a household with no
 * solar for the first seven and a half months, and a peak export reading
 * chosen so the raw-interval sizing method should land within 5% of the
 * installed 12.75 kWp array — see PEAK_SOLAR_KW below.
 */
import {
  BATTERY_EVENING_IMPORT_RATIO,
  detectLikelyBattery,
  detectSetupChange,
  estimateSolarFromPeakExport,
  monthYearLabel,
  monthlyExportTotals,
  splitAtChange,
} from '../src/services/existingSystemEstimate.js';
import { effectiveDerate } from '../src/services/calculationEngine.js';
import { analyseIntervals } from '../src/services/intervalAnalysis.js';
import { parseNem12Text, sliceMeterData } from '../src/services/nem12Parser.js';
import { buildTariffModel } from '../src/services/touTariffModel.js';

let failures = 0;
const pass = (label, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

/* ------------------------------------------------------------------ *
 * Fixture: a 5-minute SAPN-style file spanning a real install
 * ------------------------------------------------------------------ */

const NMI = '9998887771';
const START = '2025-03-20';
const TOTAL_DAYS = 494; // matches the real file this was built against
const CHANGE_DATE = '2025-11-01'; // first day of install month (monthly B1 detection)
const ACTUAL_INSTALL = '2025-11-10'; // day solar switched on in the fixture
const INTERVAL_MIN = 5;
const PER_DAY = 288;
// Chosen so surplus at solar noon (peak power minus the small midday load)
// lands close to the ~1.02 kWh/5min actually observed on the real file.
const PEAK_SOLAR_KW = 12.6;

function isoToNem12(iso) {
  return iso.replace(/-/g, '');
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function householdLoadKw(hour, dayIndex) {
  const base = 0.35;
  const morning = 0.6 * Math.exp(-((hour - 7.5) ** 2) / 2.2);
  const evening = 1.1 * Math.exp(-((hour - 19) ** 2) / 3.5);
  const wobble = 0.05 * Math.sin(dayIndex * 1.3 + hour * 0.7);
  return Math.max(0.05, base + morning + evening + wobble);
}

function solarPowerKw(hour) {
  if (hour < 6 || hour > 19) return 0;
  return Math.max(0, PEAK_SOLAR_KW * Math.exp(-((hour - 12.5) ** 2) / 6.5));
}

/** One day's raw 5-minute E1 and B1 readings. */
function buildDay(dayIndex, installed) {
  const e1 = new Array(PER_DAY);
  const b1 = new Array(PER_DAY);

  for (let i = 0; i < PER_DAY; i++) {
    const hour = (i * INTERVAL_MIN) / 60;
    const loadKwh = householdLoadKw(hour, dayIndex) * (INTERVAL_MIN / 60);

    if (!installed) {
      e1[i] = loadKwh.toFixed(6);
      b1[i] = '0.000000';
      continue;
    }

    const solarKwh = solarPowerKw(hour) * (INTERVAL_MIN / 60);
    const selfUsed = Math.min(solarKwh, loadKwh);
    const surplus = solarKwh - selfUsed;
    const remainingLoad = loadKwh - selfUsed;
    // The battery covers most of the load solar didn't reach directly; it
    // doesn't clip the exported surplus, matching a battery that fills well
    // before the midday peak on most days — the real-world behaviour that
    // makes peak-export sizing meaningful in the first place.
    const batteryCoverage = hour >= 16 || hour < 6 ? remainingLoad * 0.6 : 0;
    const gridImport = Math.max(0, remainingLoad - batteryCoverage);

    e1[i] = gridImport.toFixed(6);
    b1[i] = surplus.toFixed(6);
  }

  return { e1, b1 };
}

console.log(`Building a ${TOTAL_DAYS}-day, 5-minute fixture (this takes a moment)…`);

const days = [];
for (let i = 0; i < TOTAL_DAYS; i++) {
  const dateIso = addDays(START, i);
  days.push({ dateIso, installed: dateIso >= ACTUAL_INSTALL, dayIndex: i, ...buildDay(i, dateIso >= ACTUAL_INSTALL) });
}

const lines = ['100,NEM12,202607270000,SAPN,RETAILER'];
lines.push(`200,${NMI},E1B1,1,E1,N1,METER001,KWH,${INTERVAL_MIN},20260801`);
for (const d of days) {
  lines.push(`300,${isoToNem12(d.dateIso)},${d.e1.join(',')},A,,,20260727120000`);
}
lines.push(`200,${NMI},B1,1,B1,N1,METER001,KWH,${INTERVAL_MIN},20260801`);
for (const d of days) {
  lines.push(`300,${isoToNem12(d.dateIso)},${d.b1.join(',')},A,,,20260727120000`);
}
lines.push('900');

const meterData = parseNem12Text(lines.join('\r\n'));

/* ------------------------------------------------------------------ *
 * 1. Parsing sanity
 * ------------------------------------------------------------------ */

console.log('\n1. The fixture parses as expected');
pass('total days matches the fixture', meterData.summary.totalDays === TOTAL_DAYS, `${meterData.summary.totalDays}`);
pass('B1 channel present', Boolean(meterData.channels.B1));
pass('B1 has a raw peak reading', meterData.channels.B1.peakRawKwh > 0, `${meterData.channels.B1.peakRawKwh} kWh`);

/* ------------------------------------------------------------------ *
 * 2. Setup-change detection
 * ------------------------------------------------------------------ */

console.log('\n2. Setup-change (install month) detection');

const monthly = monthlyExportTotals(meterData.channels.B1);
pass(
  'November 2025 is the first month above 50 kWh export',
  [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).find(([, kwh]) => kwh > 50)?.[0] === '2025-11'
);

const change = detectSetupChange(meterData);
pass('a change was detected', change?.detected === true);
pass('detection used monthly export totals', change?.method === 'monthly', change?.method);
pass(
  'the change date is the first day of the install month',
  change?.changeDate === CHANGE_DATE,
  `detected ${change?.changeDate}, expected ${CHANGE_DATE} (install on ${ACTUAL_INSTALL})`
);
pass('pre-install export reads as near zero', near(change.preAvgExportKwh, 0, 0.1), `${change.preAvgExportKwh} kWh/day`);
pass('post-install export is substantial', change.postAvgExportKwh > 5, `${change.postAvgExportKwh} kWh/day`);
pass(
  'pre-install import approximates true household load (~13.6 kWh/day baseline, per householdLoadKw)',
  near(change.preAvgImportKwh, 13.6, 1),
  `${change.preAvgImportKwh} kWh/day`
);
pass(
  'post-install import is lower than pre-install (solar + battery displacing grid)',
  change.postAvgImportKwh < change.preAvgImportKwh,
  `${change.postAvgImportKwh} vs ${change.preAvgImportKwh} kWh/day`
);
pass('pre/post day counts sum close to the total', change.preDays + change.postDays >= TOTAL_DAYS - 5);
pass('monthYearLabel reads naturally', monthYearLabel(change.changeDate) === 'November 2025', monthYearLabel(change.changeDate));
pass('months since install is reported', (change.monthsSinceInstall ?? 0) >= 1, `${change.monthsSinceInstall}`);

// A file with no step at all — constant export throughout — must not report
// a phantom install partway through a normal year.
console.log('\n   No false positive on a site with no setup change');
const steadyDays = [];
for (let i = 0; i < 200; i++) {
  const dateIso = addDays(START, i);
  steadyDays.push({ dateIso, ...buildDay(i, true) }); // "installed" from day 1
}
const steadyLines = ['100,NEM12,202607270000,SAPN,RETAILER', `200,${NMI},E1B1,1,E1,N1,METER001,KWH,${INTERVAL_MIN},20260801`];
for (const d of steadyDays) steadyLines.push(`300,${isoToNem12(d.dateIso)},${d.e1.join(',')},A,,,20260727120000`);
steadyLines.push(`200,${NMI},B1,1,B1,N1,METER001,KWH,${INTERVAL_MIN},20260801`);
for (const d of steadyDays) steadyLines.push(`300,${isoToNem12(d.dateIso)},${d.b1.join(',')},A,,,20260727120000`);
steadyLines.push('900');

const steadyMeterData = parseNem12Text(steadyLines.join('\r\n'));
const steadyChange = detectSetupChange(steadyMeterData);
pass('no change detected when export is steady throughout', steadyChange === null, JSON.stringify(steadyChange));

/* ------------------------------------------------------------------ *
 * 3. Peak-export sizing — the headline validation target
 * ------------------------------------------------------------------ */

console.log('\n3. Sizing the existing system from its peak export');

const wholeFileEstimate = estimateSolarFromPeakExport(meterData.channels.B1);
pass('an estimate is returned', Boolean(wholeFileEstimate));
console.log(`   whole-file estimate: ${wholeFileEstimate.kw} kW (peak on ${wholeFileEstimate.atDate})`);
pass(
  'the estimate is nowhere near the old ~1.2 kW bug',
  wholeFileEstimate.kw > 10,
  `${wholeFileEstimate.kw} kW`
);
pass(
  'the estimate is within 5% of the real 12.75 kWp array',
  near(wholeFileEstimate.kw, 12.75, 12.75 * 0.05 + 0.3),
  `${wholeFileEstimate.kw} kW vs 12.75 kWp actual`
);

/* ------------------------------------------------------------------ *
 * 4. Splitting the file at the detected change
 * ------------------------------------------------------------------ */

console.log('\n4. Analysing only the post-install period');

const { pre, post } = splitAtChange(meterData, change);
pass('pre-install slice has (near) zero solar', !pre.summary.hasSolar || pre.summary.totalExportKwh < 5, `${pre.summary.totalExportKwh} kWh`);
pass('post-install slice has solar', post.summary.hasSolar);
pass(
  'pre + post day counts reconstruct the full file',
  pre.summary.totalDays + post.summary.totalDays === TOTAL_DAYS,
  `${pre.summary.totalDays} + ${post.summary.totalDays} vs ${TOTAL_DAYS}`
);
pass(
  'pre-install slice reads the same true household load as the change summary',
  near(pre.summary.avgDailyImportKwh, change.preAvgImportKwh, 0.5)
);

const postOnlyEstimate = estimateSolarFromPeakExport(post.channels.B1);
pass(
  'the post-install-only slice gives the same peak-based estimate',
  near(postOnlyEstimate.kw, wholeFileEstimate.kw, 0.05),
  `${postOnlyEstimate.kw} vs ${wholeFileEstimate.kw} kW`
);

// sliceMeterData directly, the way the UI will use it for a custom window.
const customSlice = sliceMeterData(meterData, { start: '2026-01-01', end: '2026-03-31' });
pass('a custom slice returns a well-formed summer window', customSlice.summary.totalDays === 90, `${customSlice.summary.totalDays}`);
pass('a custom slice has its own hasSolar', customSlice.summary.hasSolar === true);

/* ------------------------------------------------------------------ *
 * 5. Post-install interval analysis — the figures the UI must show
 * ------------------------------------------------------------------ */

console.log('\n5. Post-install interval analysis (494-day install fixture)');

const solarData = {
  name: 'Adelaide',
  state: 'SA',
  lat: -34.93,
  lng: 138.6,
  postcode: '5000',
  psh: {
    jan: 7.4, feb: 6.7, mar: 5.5, apr: 4.1, may: 3, jun: 2.5,
    jul: 2.7, aug: 3.5, sep: 4.6, oct: 5.8, nov: 6.8, dec: 7.3,
  },
  annual: 4.99,
};
const roofData = { orientation: 'N', pitchDegrees: 22.5, shading: 'none' };
const derate = effectiveDerate(roofData, solarData.lat);
const tariff = buildTariffModel({ dailyKwh: 13.6 }, 'SA', 40);
const existingKw = postOnlyEstimate.kw;
const batteryKwh = 13.5;

const postAnalysis = analyseIntervals({
  meterData: post,
  solarData,
  roofData,
  systemKw: existingKw,
  batteryKwh,
  derate,
  tariff,
  feedInCents: 5,
  existingSolarKw: existingKw,
});

// Whole-file analysis — analyseIntervals must self-filter to the install month.
const wholeFileAnalysis = analyseIntervals({
  meterData,
  solarData,
  roofData,
  systemKw: existingKw,
  batteryKwh,
  derate,
  tariff,
  feedInCents: 5,
  existingSolarKw: existingKw,
});

const postAnnual = postAnalysis.result.annual;
const wholeAnnual = wholeFileAnalysis.result.annual;
const postSelfPct = Math.round(postAnnual.selfConsumptionRatio * 100);
const factor = postAnalysis.annualisationFactor;

console.log(
  `   post-install only: ${post.summary.totalDays} calendar days, ` +
    `factor ${factor.toFixed(3)}, self-consumption ${postSelfPct}%, ` +
    `gen ${Math.round(postAnnual.totalSolarGeneration * factor)} kWh/yr, ` +
    `export ${Math.round(postAnnual.exported * factor)} kWh/yr`
);
console.log(
  `   whole file (self-filtered): install ${wholeFileAnalysis.installDate}, ` +
    `${wholeFileAnalysis.postInstallDays} post-install days, ` +
    `self-consumption ${Math.round(wholeAnnual.selfConsumptionRatio * 100)}%`
);

pass('post-install calendar days are fewer than the full file', post.summary.totalDays < meterData.summary.totalDays);
pass(
  'whole-file analysis detects the November install and filters itself',
  wholeFileAnalysis.installDate === CHANGE_DATE && wholeFileAnalysis.postInstallDays === post.summary.totalDays,
  `${wholeFileAnalysis.installDate}, ${wholeFileAnalysis.postInstallDays} days`
);
pass(
  'annualisation uses post-install days only',
  Math.abs(factor - 365 / post.summary.totalDays) < 0.001,
  `factor ${factor.toFixed(4)}`
);
pass(
  'existing-system path does not invent battery cycles from E1/B1',
  postAnnual.batteryCyclesPerYear === 0,
  `${postAnnual.batteryCyclesPerYear}/yr`
);
pass(
  'export comes from post-install meter B1',
  Math.abs(postAnnual.exported - post.summary.totalExportKwh) < 1,
  `${postAnnual.exported} vs ${post.summary.totalExportKwh}`
);
console.log('   (Real-file targets: November 2025, 268 days, ~60.8% self-consumption — run testRealFile.mjs)');

/* ------------------------------------------------------------------ *
 * 6. Battery likelihood from evening import drop
 * ------------------------------------------------------------------ */

console.log('\n6. Battery detection heuristics');

// Dedicated evening-drop fixture: solar+battery from 1 Feb so it aligns with
// monthly install detection (changeDate = first of install month).
const EVE_PRE = 31; // January only
const EVE_POST = 45; // February + into March
const eveLines = ['100,NEM12,202607270000,SAPN,RETAILER'];
eveLines.push(`200,${NMI},E1B1,1,E1,N1,METER001,KWH,30,20260801`);
for (let i = 0; i < EVE_PRE + EVE_POST; i++) {
  const installed = i >= EVE_PRE;
  const e1 = Array.from({ length: 48 }, (_, s) => {
    const hour = s / 2;
    const base = 0.2;
    const evening = 1.0 * Math.exp(-((hour - 19) ** 2) / 3.5);
    let load = Math.max(0.05, base + evening);
    if (installed && hour >= 18 && hour < 23) load *= 0.15; // battery covers evenings
    if (installed && hour >= 10 && hour < 16) load *= 0.4; // daytime solar
    return load.toFixed(3);
  });
  eveLines.push(`300,${isoToNem12(addDays('2025-01-01', i))},${e1.join(',')},A,,,,`);
}
eveLines.push(`200,${NMI},B1,1,B1,N1,METER001,KWH,30,20260801`);
for (let i = 0; i < EVE_PRE + EVE_POST; i++) {
  const installed = i >= EVE_PRE;
  const b1 = Array.from({ length: 48 }, (_, s) => {
    if (!installed) return '0.000';
    const hour = s / 2;
    if (hour < 7 || hour > 18) return '0.000';
    return Math.max(0, 1.8 * Math.exp(-((hour - 12.5) ** 2) / 6)).toFixed(3);
  });
  eveLines.push(`300,${isoToNem12(addDays('2025-01-01', i))},${b1.join(',')},A,,,,`);
}
eveLines.push('900');

const eveMeter = parseNem12Text(eveLines.join('\r\n'));
const eveChange = detectSetupChange(eveMeter);
const eveningHit = detectLikelyBattery(eveMeter, eveChange);
pass('evening-drop fixture detects a setup change', eveChange?.detected === true, eveChange?.changeDate);
pass(
  'evening import drop flags a likely battery',
  eveningHit.likely && eveningHit.reasons.includes('evening_import_drop'),
  `ratio=${eveningHit.eveningRatio}, reasons=${JSON.stringify(eveningHit.reasons)}`
);
pass(
  `evening ratio is below the ${BATTERY_EVENING_IMPORT_RATIO} threshold`,
  eveningHit.eveningRatio != null && eveningHit.eveningRatio < BATTERY_EVENING_IMPORT_RATIO,
  `${eveningHit.eveningRatio}`
);
pass('detection note mentions evening grid imports', /evening grid imports/i.test(eveningHit.note ?? ''));

// No install step → evening signal cannot fire.
const solarOnlyHit = detectLikelyBattery(steadyMeterData, null);
pass(
  'steady solar-only file is not flagged as a battery',
  solarOnlyHit.likely === false,
  JSON.stringify(solarOnlyHit)
);

console.log(
  `\n${failures === 0 ? 'All existing-system estimate checks passed.' : `${failures} check(s) FAILED.`}`
);
process.exit(failures > 0 ? 1 : 0);
