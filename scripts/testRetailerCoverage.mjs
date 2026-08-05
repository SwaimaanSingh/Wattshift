/**
 * Coverage tests for the retailers with no sample bill of their own.
 *
 *   npm run test:retailers
 *
 * WHAT THIS DOES AND DOES NOT PROVE
 *
 * The fixtures below are SYNTHETIC. They are written from the label wording
 * Australian retailers use, not transcribed from real statements, so a pass
 * here means the patterns handle that wording — it does NOT mean they handle
 * that retailer's real layout. Only scripts/testParsers.mjs, which runs
 * against text extracted from actual PDFs, can show that.
 *
 * What it does catch, and what it was written for:
 *  - regexes that never fire, or fire on the wrong number
 *  - unit errors (cents read as dollars, or the reverse)
 *  - detection collisions between retailers who name each other in a footer
 *  - label variants silently regressing when the shared patterns change
 *
 * Fixtures deliberately vary the wording per retailer — "Units used", "kWh
 * used", "Energy used", DD/MM/YYYY against D MMM YYYY — so the fallback chain
 * is exercised rather than one blessed phrasing.
 */
import { parseWithPatterns, detectRetailer } from '../src/services/retailerPatterns/index.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Each fixture states the figures it encodes, so a mismatch points at the
 * pattern rather than at arithmetic done in the reader's head.
 */
const FIXTURES = [
  {
    name: 'Momentum Energy — flat rate, D MMM YYYY dates, no solar',
    expect: {
      retailer: 'Momentum Energy',
      billingPeriodStart: '2025-07-01',
      billingPeriodEnd: '2025-09-30',
      billingDays: 92,
      totalKwh: 1842,
      tariffRateCentsPerKwh: 28.6,
      dailySupplyChargeCents: 108.35,
      totalBillAmount: 626.44,
      hasSolar: false,
    },
    text: `
Momentum Energy Pty Ltd ABN 42 100 569 159
A Hydro Tasmania business
momentumenergy.com.au
TAX INVOICE
Supply address 14 Rosewood Ave, GEELONG VIC 3220
Billing period: 1 Jul 2025 to 30 Sep 2025 (92 days)
Electricity charges
Peak usage 1842 kWh 28.6 c/kWh $526.81
Supply charge 92 days 108.35 c/day $99.68
Total usage 1842 kWh
Total amount due $626.44
`,
  },
  {
    name: 'Amber Electric — subscription must not become the supply charge',
    expect: {
      retailer: 'Amber Electric',
      billingPeriodStart: '2025-08-01',
      billingPeriodEnd: '2025-08-31',
      billingDays: 31,
      totalKwh: 604.2,
      // 96.5 c/day from the network row alone. The membership is pro-rated on
      // the fixture using supply-charge wording, which is the case that bites:
      // without amberElectric.js filtering it the two rows average to 78.9,
      // overstating the fixed daily cost by 22%.
      dailySupplyChargeCents: 96.5,
      totalBillAmount: 243.17,
      hasSolar: true,
      solarExportKwh: 288.4,
    },
    text: `
Amber Electric Pty Ltd
amber.com.au
Tax invoice for 8 Kestrel Court, BRUNSWICK VIC 3056
Bill period start 01/08/2025 Bill period end 31/08/2025
Your usage
Usage this bill 604.2 kWh
General usage 604.2 kWh 24.8 c/kWh $149.84
Daily supply charge 31 days 96.5 c/day $29.92
Amber subscription daily charge 31 days 61.29 c/day $19.00
Solar exported 288.4 kWh
Feed-in credit 288.4 kWh 3.9 c/kWh -$11.25
Total amount due $243.17
`,
  },
  {
    name: 'Powershop — "Energy used" label, DD/MM/YYYY range',
    expect: {
      retailer: 'Powershop',
      billingPeriodStart: '2025-06-15',
      billingPeriodEnd: '2025-07-14',
      billingDays: 30,
      totalKwh: 511.6,
      dailySupplyChargeCents: 118,
      totalBillAmount: 289.05,
    },
    text: `
Powershop Australia Pty Ltd ABN 41 154 914 075
powershop.com.au
A Shell Energy business
Supply address 5/22 Lygon St, CARLTON VIC 3053
Bill period 15/06/2025 - 14/07/2025 (30 days)
Energy used 511.6 kWh
Anytime usage 511.6 kWh 29.9 c/kWh $152.97
Daily supply charge 30 days 118.0 c/day $35.40
Total amount due $289.05
`,
  },
  {
    name: 'OVO Energy — "Units used", service charge wording, shared-year range',
    expect: {
      retailer: 'OVO Energy',
      billingPeriodStart: '2025-09-01',
      billingPeriodEnd: '2025-09-30',
      billingDays: 30,
      totalKwh: 733,
      dailySupplyChargeCents: 102.4,
      totalBillAmount: 341.88,
    },
    text: `
OVO Energy Pty Ltd
ovoenergy.com.au
Electricity tax invoice
Site address 91 Wattle Rd, HAWTHORN VIC 3122
Billing period 1 - 30 September 2025
Units used 733
Usage 733 kWh 31.2 c/kWh $228.70
Service charge 30 days 102.4 c/day $30.72
Total amount due $341.88
`,
  },
  {
    name: 'Tango Energy — TOU rows, "kWh used", solar with feed-in',
    expect: {
      retailer: 'Tango Energy',
      billingDays: 31,
      totalKwh: 812,
      tariffType: 'tou',
      dailySupplyChargeCents: 115.5,
      hasSolar: true,
      solarExportKwh: 402,
      feedInTariffCents: 4.5,
      totalBillAmount: 318.7,
    },
    text: `
Tango Energy Pty Ltd ABN 43 155 908 839
tangoenergy.com.au
A Pacific Hydro company
Supply address 3 Bellarine Hwy, GEELONG VIC 3220
Billing period: 01 Mar 2026 - 31 Mar 2026 (31 days)
kWh used 812
Peak 402 kWh 38.5 c/kWh $154.77
Off peak 410 kWh 22.0 c/kWh $90.20
Daily supply charge 31 days 115.5 c/day $35.81
Solar export 402 kWh 4.5 c/kWh -$18.09
Total amount due $318.70
`,
  },
  {
    name: 'GloBird Energy — "Total consumption", network charge as daily rate',
    expect: {
      retailer: 'GloBird Energy',
      billingDays: 90,
      totalKwh: 2140.5,
      // Reached through the loose supply label, which requires an explicit
      // per-day rate on the same line.
      dailySupplyChargeCents: 99.9,
      totalBillAmount: 812.36,
    },
    text: `
GloBird Energy Pty Ltd
globirdenergy.com.au
Tax invoice for 27 Blackburn Rd, MOUNT WAVERLEY VIC 3149
Supply period: 02 Apr 2025 to 30 Jun 2025 (90 days)
Total consumption 2140.5 kWh
General usage 2140.5 kWh 27.4 c/kWh $586.50
Daily network charge 90 days 99.9 c/day $89.91
Total amount due $812.36
`,
  },
  {
    name: 'ReAmped Energy — labelled start/end fields, "You used" wording',
    expect: {
      retailer: 'ReAmped Energy',
      billingPeriodStart: '2025-10-05',
      billingPeriodEnd: '2025-11-04',
      billingDays: 31,
      totalKwh: 489.7,
      dailySupplyChargeCents: 94.2,
      totalBillAmount: 201.55,
    },
    text: `
ReAmped Energy Pty Ltd
reamped.com.au
Supply address 12 Marsden St, PARRAMATTA NSW 2150
Period start: 05/10/2025
Period end: 04/11/2025
You used 489.7 kWh this billing period
Usage 489.7 kWh 30.1 c/kWh $147.40
Daily supply charge 31 days 94.2 c/day $29.20
Amount payable $201.55
`,
  },
  {
    name: 'Dodo Power & Gas — detected via M2 Energy entity, "Balance due"',
    expect: {
      retailer: 'Dodo Power & Gas',
      billingDays: 62,
      totalKwh: 1355,
      dailySupplyChargeCents: 105.6,
      totalBillAmount: 498.22,
    },
    text: `
M2 Energy Pty Ltd trading as Dodo Power & Gas
dodo.com.au
Electricity tax invoice
Supply address 8 Sydney Rd, COBURG VIC 3058
Bill period 1 Aug 2025 to 1 Oct 2025 (62 days)
Total electricity usage 1355 kWh
Anytime 1355 kWh 26.9 c/kWh $364.50
Supply charge 62 days 105.6 c/day $65.47
Balance due $498.22
`,
  },
  {
    name: 'Simply Energy — must not lose detection to its ENGIE parent footer',
    expect: { retailer: 'Simply Energy', billingDays: 31, totalKwh: 720 },
    text: `
Simply Energy
simplyenergy.com.au
Simply Energy is a trading name of ENGIE Retail Pty Ltd
Supply address 44 Grote St, ADELAIDE SA 5000
Billing period: 01 May 2025 to 31 May 2025 (31 days)
Total usage 720 kWh
Peak 720 kWh 41.2 c/kWh $296.64
Daily supply charge 31 days 98.7 c/day $30.60
Total amount due $327.24
`,
  },
  {
    name: 'EnergyAustralia — one-word brand form',
    expect: { retailer: 'EnergyAustralia', billingDays: 31, totalKwh: 655 },
    text: `
EnergyAustralia Pty Ltd
energyaustralia.com.au
Tax invoice for 19 Flinders Lane, MELBOURNE VIC 3000
Billing period 1 Apr 2025 to 1 May 2025 (31 days)
Total usage 655 kWh
Peak 655 kWh 33.8 c/kWh $221.39
Daily supply charge 31 days 112.3 c/day $34.81
Total amount due $256.20
`,
  },
];

/** Detection must not be stolen by a brand merely named in a footer. */
const DETECTION_ONLY = [
  { text: 'Lumo Energy Australia Pty Limited ABN 69 100 528 327', expect: 'Lumo Energy' },
  { text: 'Red Energy Pty Ltd is the owner of the trademark EvenPay®. Lumo Energy', expect: 'Lumo Energy' },
  { text: 'Powered by clean energy Australia wide — Tango Energy Pty Ltd', expect: 'Tango Energy' },
  { text: 'Amber Electric Pty Ltd, amber.com.au', expect: 'Amber Electric' },
  { text: 'Momentum Energy Pty Ltd, a Hydro Tasmania business', expect: 'Momentum Energy' },
  { text: 'Powershop Australia Pty Ltd, a Shell Energy business', expect: 'Powershop' },
  { text: 'Your OVO Energy electricity bill', expect: 'OVO Energy' },
  { text: 'GloBird Energy Pty Ltd globirdenergy.com.au', expect: 'GloBird Energy' },
  { text: 'ReAmped Energy Pty Ltd reamped.com.au', expect: 'ReAmped Energy' },
  { text: 'M2 Energy Pty Ltd trading as Dodo Power & Gas', expect: 'Dodo Power & Gas' },
  { text: 'AGL South Australia Pty Ltd agl.com.au', expect: 'AGL' },
  { text: 'Origin Energy Electricity Limited originenergy.com.au', expect: 'Origin Energy' },
  // No retailer at all: the router must not invent one.
  { text: 'A plain page of text with no retailer named anywhere on it.', expect: null },
];

const TOLERANCE = {
  tariffRateCentsPerKwh: 0.02,
  dailySupplyChargeCents: 0.02,
  totalKwh: 0.01,
  solarExportKwh: 0.01,
  feedInTariffCents: 0.02,
  totalBillAmount: 0.001,
};

let passed = 0;
let failed = 0;
const failures = [];

function check(scope, field, actual, expected) {
  const tolerance = TOLERANCE[field];
  let ok;

  if (expected === null) ok = actual == null;
  else if (typeof expected === 'number' && typeof actual === 'number') {
    ok = tolerance
      ? Math.abs(actual - expected) <= Math.abs(expected) * tolerance + 1e-9
      : actual === expected;
  } else ok = actual === expected;

  const shown = typeof actual === 'number' ? Number(actual.toFixed(3)) : String(actual);

  if (ok) {
    passed++;
    console.log(`  ${GREEN}PASS${RESET} ${field.padEnd(24)} ${shown}`);
  } else {
    failed++;
    failures.push(`${scope} :: ${field} — got ${shown}, expected ${expected}`);
    console.log(
      `  ${RED}FAIL${RESET} ${field.padEnd(24)} got ${shown}  ${DIM}expected ${expected}${RESET}`
    );
  }
}

for (const fixture of FIXTURES) {
  const { data, retailerId } = parseWithPatterns(fixture.text);
  console.log(`\n${fixture.name}  ${DIM}(${retailerId})${RESET}`);
  for (const [field, expected] of Object.entries(fixture.expect)) {
    check(fixture.name, field, data[field], expected);
  }
}

console.log(`\nDetection${DIM} — brand named in a footer must not win${RESET}`);
for (const { text, expect } of DETECTION_ONLY) {
  const { name } = detectRetailer(text);
  check('detection', text.slice(0, 44), name, expect);
}

console.log(`\n${'-'.repeat(60)}`);
console.log(`${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
