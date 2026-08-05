/**
 * Run the retailer patterns against every sample bill and check the results
 * against figures read by hand off the PDFs.
 *
 *   npm run test:parser
 *
 * Requires `npm run extract` (and ocrScannedBills.mjs for the two scans) to
 * have produced scripts/sample-text/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWithPatterns } from '../src/services/retailerPatterns/index.js';
import { applyConfidence } from '../src/services/confidence.js';
import { splitStatements } from '../src/services/statementSplitter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEXT_DIR = path.join(__dirname, 'sample-text');

/**
 * Ground truth, transcribed by hand from each bill. `null` means the bill
 * genuinely does not state that field.
 */
const EXPECTED = [
  {
    file: 'abe-chandra-sept25.txt',
    source: 'pdf-text',
    retailer: 'Lumo Energy',
    billingDays: 89,
    totalKwh: 4693, // 1318 + 3375
    dailyAverageKwh: 52.73,
    tariffType: 'flat',
    // (1318 x 39.03 + 3375 x 40.89) / 4693
    tariffRateCentsPerKwh: 40.37,
    dailySupplyChargeCents: 102.98, // (91.78 x 25 + 108.75 x 64) / 89
    hasSolar: true,
    solarExportKwh: 30, // 8 + 22
    feedInTariffCents: 2.667, // (8 x 4.5 + 22 x 2.0) / 30
    totalBillAmount: 2109.91,
    postcode: '5051',
  },
  {
    file: 'mcsherry-march2026.txt',
    source: 'pdf-text',
    retailer: 'AGL',
    billingDays: 31,
    // Local-time dates: toISOString() would shift these back a day in ACDT.
    billingPeriodStart: '2026-03-06',
    billingPeriodEnd: '2026-04-05',
    // Credits print as "$31.00cr" — a positive feed-in the customer is PAID.
    // (31.00 + 20.42) / 1331.243 = 3.863c
    feedInTariffCents: 3.863,
    totalKwh: 2389.873, // 1669.952 + 666.791 + 53.13
    dailyAverageKwh: 77.09,
    tariffType: 'tou',
    tariffRateCentsPerKwh: 46.7, // consumption-weighted across the three rates
    touRates: { peak: 53, shoulder: 24.35, offPeak: 34.45 },
    dailySupplyChargeCents: 110.89,
    hasSolar: true,
    solarExportKwh: 1331.243, // 310 + 1021.243
    totalBillAmount: 1226.89,
    postcode: '5044', // supply address, NOT the 5571 postal address
  },
  {
    file: 'pte-hq-april.txt',
    source: 'pdf-text',
    retailer: 'iO Energy',
    billingDays: 31,
    totalKwh: 2118.96, // 278.12 + 584.28 + 1256.56
    tariffType: 'tou',
    tariffRateCentsPerKwh: 41.84,
    touRates: { peak: 85, shoulder: 35, offPeak: 36 },
    dailySupplyChargeCents: 200,
    hasSolar: true,
    solarExportKwh: 477.82, // 383.37 + 1.65 + 92.80
    // Negative: iO charges for daytime export and only rebates in the evening.
    // (383.37 x 2 - 1.65 x 18 - 92.80 x 4) / 477.82 = +0.766 net charge
    feedInTariffCents: -0.766,
    totalBillAmount: 952.24,
    postcode: '5095',
  },
  {
    file: 'mclaren-vale-caravan.txt',
    source: 'pdf-text',
    retailer: 'Alinta Energy',
    billingDays: 95, // 89 + 6
    totalKwh: 777, // 731.811 + 45.189
    dailyAverageKwh: 8.18,
    tariffType: 'flat',
    tariffRateCentsPerKwh: 48.93,
    dailySupplyChargeCents: 127.49,
    hasSolar: false,
    totalBillAmount: 502.07,
    postcode: '5171',
  },
  {
    file: 'origin-farm-2025-10.txt',
    source: 'pdf-text',
    retailer: 'Origin Energy',
    billingDays: 31,
    totalKwh: 49255.25,
    tariffType: 'flat', // unbundled -> blended volumetric rate
    tariffRateCentsPerKwh: 13.83,
    dailySupplyChargeCents: 821.92,
    hasSolar: false,
    totalBillAmount: 10063.81,
    postcode: '5461',
  },
  {
    file: 'origin-farm-2024-11.txt',
    source: 'pdf-text',
    retailer: 'Origin Energy',
    billingDays: 30,
    totalKwh: 50921.91,
    hasSolar: false,
    postcode: '5461',
  },
  {
    file: 'origin-college-park.ocr.txt',
    source: 'ocr',
    retailer: 'Origin Energy',
    billingDays: 91,
    dailyAverageKwh: 63.84,
    hasSolar: false,
    postcode: '5069',
  },
  {
    // Four OCR'd pages of a 43-page bundle: two monthly statements, which the
    // splitter must separate before parsing.
    file: 'engie-adelaide-inn.ocr.txt',
    source: 'ocr',
    statements: 2,
    retailer: 'ENGIE',
    billingDays: 31, // 01 Jan 2025 - 31 Jan 2025, not the Jan-Feb union
    totalKwh: 22912.58,
    totalBillAmount: 6707.13,
    hasSolar: false,
    postcode: '5006',
  },
];

/** Tolerances: rates and derived averages carry rounding, counts do not. */
const TOLERANCE = {
  totalKwh: 0.01,
  dailyAverageKwh: 0.02,
  tariffRateCentsPerKwh: 0.02,
  dailySupplyChargeCents: 0.02,
  solarExportKwh: 0.01,
  totalBillAmount: 0.001,
  feedInTariffCents: 0.02,
  'touRates.peak': 0.02,
  'touRates.shoulder': 0.02,
  'touRates.offPeak': 0.02,
};

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
const failures = [];

for (const spec of EXPECTED) {
  const filePath = path.join(TEXT_DIR, spec.file);

  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    console.log(`${RED}SKIP${RESET} ${spec.file} — not extracted yet`);
    continue;
  }

  // Recreate the per-page structure the browser extractor produces, so the
  // statement splitter is exercised exactly as it is at runtime.
  const pages = text
    .split(/^===== PAGE \d+.*=====$/m)
    .map((p) => p.trim())
    .filter(Boolean);

  const statements = splitStatements(pages);
  const { data } = parseWithPatterns(statements[0]);
  const result = applyConfidence(data, spec.source);

  console.log(
    `\n${spec.file}  ${DIM}(${result.confidence} confidence, ${statements.length} statement(s), ${result.diagnostics?.usageSource}, ${result.diagnostics?.tariffSource})${RESET}`
  );

  for (const [key, expected] of Object.entries(spec)) {
    if (key === 'file' || key === 'source') continue;

    if (key === 'statements') {
      check(spec.file, 'statements', statements.length, expected);
      continue;
    }

    if (key === 'touRates') {
      for (const [tk, tv] of Object.entries(expected)) {
        check(spec.file, `touRates.${tk}`, result.touRates?.[tk], tv);
      }
      continue;
    }
    check(spec.file, key, result[key], expected);
  }
}

function check(file, field, actual, expected) {
  const tolerance = TOLERANCE[field];
  let ok;

  if (expected === null) {
    ok = actual == null;
  } else if (typeof expected === 'number' && typeof actual === 'number') {
    ok = tolerance
      ? Math.abs(actual - expected) <= Math.abs(expected) * tolerance + 1e-9
      : actual === expected;
  } else {
    ok = actual === expected;
  }

  const shown =
    typeof actual === 'number' ? Number(actual.toFixed(3)) : String(actual);

  if (ok) {
    passed++;
    console.log(`  ${GREEN}PASS${RESET} ${field.padEnd(24)} ${shown}`);
  } else {
    failed++;
    failures.push(`${file} :: ${field} — got ${shown}, expected ${expected}`);
    console.log(
      `  ${RED}FAIL${RESET} ${field.padEnd(24)} got ${shown}  ${DIM}expected ${expected}${RESET}`
    );
  }
}

console.log(`\n${'-'.repeat(60)}`);
console.log(`${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
