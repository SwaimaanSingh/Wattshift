/**
 * Verification for the self-consumption model.
 *
 *   node scripts/testSelfConsumption.mjs
 *
 * Two behaviours matter and are checked separately:
 *   Decision 1 — a steeper capture curve for commercial sites (k 2.4 vs 1.8).
 *   Decision 2 — the base ratio falls as the system outgrows the load.
 *
 * To exercise Decision 1 on its own, consumption is set at or above
 * production so the oversizing factor is exactly 1 and the base is untouched.
 */
import { calculateSelfConsumption } from '../src/services/calculationEngine.js';

const pct = (v) => `${(v * 100).toFixed(1)}%`;
let failures = 0;
const deviations = [];

const check = (label, actual, min, max) => {
  const ok = actual >= min && actual <= max;
  if (!ok) deviations.push({ label, actual, min, max });
  console.log(
    `  ${ok ? 'ok  ' : 'note'}  ${label.padEnd(34)} ${pct(actual).padStart(7)}` +
      `   spec says ${pct(min)}–${pct(max)}`
  );
  return actual;
};

const hard = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ *
 * Decision 1 — split capture curve, load matched to production
 * ------------------------------------------------------------------ */

console.log('\nDecision 1 — capture curve (load matched, no oversizing derate)');

const resiDaily = 6.6 * 4.5 * 0.78;
const resiLoad = resiDaily * 365; // matched
const resi = (kwh) => calculateSelfConsumption(kwh, 6.6, 4.5, 0.78, false, resiLoad);

console.log(`\n  residential 6.6 kW — ${resiDaily.toFixed(1)} kWh/day produced`);
const r0 = check('no battery', resi(0), 0.29, 0.31);
const r5 = check('5 kWh', resi(5), 0.53, 0.58);
const r10 = check('10 kWh', resi(10), 0.68, 0.75);
const r135 = check('13.5 kWh', resi(13.5), 0.78, 0.85);

const commDaily = 500 * 4.8 * 0.78;
const commLoad = commDaily * 365; // matched
const comm = (kwh) => calculateSelfConsumption(kwh, 500, 4.8, 0.78, true, commLoad);

console.log(`\n  commercial 500 kW — ${commDaily.toFixed(0)} kWh/day produced`);
const c30 = check('30 kWh', comm(30), 0.57, 0.6);
const c50 = check('50 kWh', comm(50), 0.59, 0.63);
const c100 = check('100 kWh', comm(100), 0.65, 0.67);
const c500 = check('500 kWh', comm(500), 0.87, 0.9);

console.log('\n  hard requirements');
const commercial = [c30, c50, c100, c500];
hard(
  'all four commercial values distinct',
  new Set(commercial.map((v) => v.toFixed(5))).size === 4
);
hard(
  'commercial strictly increasing',
  commercial.every((v, i) => i === 0 || v > commercial[i - 1])
);
hard(
  'residential strictly increasing',
  [r0, r5, r10, r135].every((v, i) => i === 0 || v > [r0, r5, r10, r135][i - 1])
);
hard(
  'residential curve unchanged by the commercial k',
  Math.abs(r5 - 0.5752) < 0.002 && Math.abs(r10 - 0.7423) < 0.002,
  `${pct(r5)} / ${pct(r10)}`
);
hard(
  'commercial captures better than residential at equal export share',
  comm(500) > 0.85
);

/* ------------------------------------------------------------------ *
 * Decision 2 — oversizing derates the base ratio
 * ------------------------------------------------------------------ */

console.log('\nDecision 2 — oversizing factor');

console.log('\n  residential, right-sized (6.6 kW, 8,395 kWh/yr)');
check('no battery', calculateSelfConsumption(0, 6.6, 4.5, 0.78, false, 8395), 0.28, 0.32);
check('10 kWh', calculateSelfConsumption(10, 6.6, 4.5, 0.78, false, 8395), 0.7, 0.75);

console.log('\n  residential, heavily oversized (30 kW, 1,825 kWh/yr)');
const over0 = check(
  'no battery',
  calculateSelfConsumption(0, 30, 4.5, 0.78, false, 1825),
  0.07,
  0.1
);
const over135 = check(
  '13.5 kWh',
  calculateSelfConsumption(13.5, 30, 4.5, 0.78, false, 1825),
  0.2,
  0.25
);

console.log('\n  commercial, right-sized (500 kW, 438,000 kWh/yr)');
const cm0 = check('no battery', calculateSelfConsumption(0, 500, 4.8, 0.78, true, 438000), 0.42, 0.46);
const cm100 = check(
  '100 kWh',
  calculateSelfConsumption(100, 500, 4.8, 0.78, true, 438000),
  0.5,
  0.6
);

console.log('\n  commercial, undersized (50 kW, 438,000 kWh/yr)');
const under = check(
  'no battery',
  calculateSelfConsumption(0, 50, 4.8, 0.78, true, 438000),
  0.55,
  0.55
);

console.log('\n  hard requirements');
hard('an undersized system keeps the full base ratio', Math.abs(under - 0.55) < 1e-9);
hard(
  'oversizing lowers the base below the matched case',
  over0 < r0,
  `${pct(over0)} oversized vs ${pct(r0)} matched`
);
hard('a battery still helps an oversized system', over135 > over0);
hard(
  'oversizing lowers the commercial base too',
  cm0 < 0.55,
  `${pct(cm0)} vs 55.0% full base`
);
hard('battery still lifts the commercial matched case', cm100 > cm0);

/* ------------------------------------------------------------------ *
 * Sanity
 * ------------------------------------------------------------------ */

console.log('\nEdge cases');
const edge = (label, value, expected) => {
  const ok = Math.abs(value - expected) < 1e-9;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(36)} ${pct(value)}`);
};
edge('zero system size falls back to base', calculateSelfConsumption(10, 0, 4.5, 0.78, false, 8395), 0.3);
edge('negative battery treated as none', calculateSelfConsumption(-5, 6.6, 4.5, 0.78, false, resiLoad), r0);

const absurd = calculateSelfConsumption(100000, 6.6, 4.5, 0.78, false, resiLoad);
hard('absurd battery capped at 98%', absurd <= 0.98 + 1e-9, pct(absurd));

const missingLoad = calculateSelfConsumption(0, 6.6, 4.5, 0.78, false, undefined);
hard(
  'unknown consumption keeps the full base ratio',
  Math.abs(missingLoad - 0.3) < 1e-9,
  pct(missingLoad)
);

console.log('\nSame battery, different system sizes (matched loads)');
for (const kw of [6.6, 30, 100, 500]) {
  const load = kw * 4.8 * 0.78 * 365;
  const v = calculateSelfConsumption(30, kw, 4.8, 0.78, true, load);
  console.log(`  30 kWh on ${String(kw).padStart(5)} kW: ${pct(v)}`);
}

if (deviations.length > 0) {
  console.log("\nDeviations from the spec's stated ranges");
  for (const d of deviations) {
    console.log(`  ${d.label}: got ${pct(d.actual)}, spec expected ${pct(d.min)}–${pct(d.max)}`);
  }
}

console.log(
  `\n${failures === 0 ? 'All hard requirements passed.' : `${failures} hard requirement(s) FAILED.`}`
);
process.exit(failures > 0 ? 1 : 0);
