/**
 * One-shot check against a real NEM12 export on disk.
 *
 *   node scripts/testRealFile.mjs path/to/file.csv
 */
import { readFileSync } from 'node:fs';
import { effectiveDerate } from '../src/services/calculationEngine.js';
import {
  detectSetupChange,
  estimateSolarFromPeakExport,
  monthYearLabel,
  splitAtChange,
} from '../src/services/existingSystemEstimate.js';
import { analyseIntervals, describeUsage } from '../src/services/intervalAnalysis.js';
import { maskNmi, parseNem12Text } from '../src/services/nem12Parser.js';
import { buildTariffModel } from '../src/services/touTariffModel.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/testRealFile.mjs <path-to-nem12.csv>');
  process.exit(1);
}

const parsed = parseNem12Text(readFileSync(path, 'utf8'));

console.log('\n=== NEM12 parse ===');
console.log('NMI (masked)     ', maskNmi(parsed.nmi));
console.log('Channels         ', Object.entries(parsed.channels).map(([s, c]) => `${s}${c.role ? ` (${c.role})` : ''}`).join(', '));
console.log('Date range       ', `${parsed.summary.dateRange.start} → ${parsed.summary.dateRange.end}`);
console.log('Days             ', `${parsed.summary.totalDays} (${parsed.summary.measuredDays} measured, ${parsed.summary.estimatedDays} filled)`);
console.log('Interval         ', `${parsed.summary.intervalMinutes} min`);
console.log('Import (E1)      ', `${parsed.summary.totalImportKwh} kWh (${parsed.summary.avgDailyImportKwh} kWh/day)`);
console.log('Export (B1)      ', `${parsed.summary.totalExportKwh} kWh (${parsed.summary.avgDailyExportKwh} kWh/day)`);
console.log('Peak demand      ', `${parsed.summary.peakDemandKw} kW at ${parsed.summary.peakDemandAt?.time}`);
console.log('Has solar        ', parsed.summary.hasSolar);
if (parsed.warnings.length) console.log('Warnings:\n ', parsed.warnings.join('\n  '));

let existingSolarKwForAnalysis = 0;
let analysisMeterData = parsed;

if (parsed.summary.hasSolar) {
  console.log('\n=== Existing system detection ===');
  const wholeFileEstimate = estimateSolarFromPeakExport(parsed.channels.B1);
  console.log(
    'Peak-export estimate (whole file)',
    wholeFileEstimate ? `${wholeFileEstimate.kw} kW (on ${wholeFileEstimate.atDate})` : 'n/a'
  );

  const setupChange = detectSetupChange(parsed);
  if (setupChange?.detected) {
    console.log('Setup change detected  ', `around ${monthYearLabel(setupChange.changeDate)} (${setupChange.changeDate})`);
    console.log('  Pre-install export   ', `${setupChange.preAvgExportKwh} kWh/day over ${setupChange.preDays} days`);
    console.log('  Post-install export  ', `${setupChange.postAvgExportKwh} kWh/day over ${setupChange.postDays} days`);
    console.log('  Pre-install import   ', `${setupChange.preAvgImportKwh} kWh/day (true household usage before solar)`);
    console.log('  Post-install import  ', `${setupChange.postAvgImportKwh} kWh/day`);

    const { post } = splitAtChange(parsed, setupChange);
    const postEstimate = estimateSolarFromPeakExport(post.channels.B1);
    console.log(
      'Peak-export estimate (post-install only)',
      postEstimate ? `${postEstimate.kw} kW (on ${postEstimate.atDate})` : 'n/a'
    );
    analysisMeterData = post;
    existingSolarKwForAnalysis = postEstimate?.kw ?? wholeFileEstimate?.kw ?? 0;
  } else {
    console.log('Setup change detected   none — export looks steady across the file');
    existingSolarKwForAnalysis = wholeFileEstimate?.kw ?? 0;
  }
}

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
const tariff = buildTariffModel({ dailyKwh: parsed.summary.avgDailyImportKwh }, 'SA', 40);

// If there's an existing system, model it (rather than a hypothetical 6.6 kW
// + 13.5 kWh new install) so the figures below describe what's actually on
// site, analysed only over the period the setup detection settled on.
const modelSystemKw = existingSolarKwForAnalysis > 0 ? existingSolarKwForAnalysis : 6.6;
const modelBatteryKwh = existingSolarKwForAnalysis > 0 ? 13.5 : 13.5;

const analysis = analyseIntervals({
  meterData: analysisMeterData,
  solarData,
  roofData,
  systemKw: modelSystemKw,
  batteryKwh: modelBatteryKwh,
  derate,
  tariff,
  feedInCents: 5,
  existingSolarKw: existingSolarKwForAnalysis,
});

const usage = describeUsage(analysis, analysisMeterData);
const annual = analysis.result.annual;
const factor = analysis.annualisationFactor;

console.log(`\n=== Interval analysis (${modelSystemKw} kW + ${modelBatteryKwh} kWh battery, ${analysisMeterData === parsed ? 'whole file' : 'post-install period'}) ===`);
console.log('Annualisation    ', factor === 1 ? 'full year' : `×${factor.toFixed(3)}`);
console.log('Load shape       ', usage.shape);
console.log('Self-consumption ', `${Math.round(annual.selfConsumptionRatio * 100)}%`);
console.log('Annual load      ', `${Math.round(annual.totalLoad * factor)} kWh`);
console.log('Generation       ', `${Math.round(annual.totalSolarGeneration * factor)} kWh`);
console.log('Self-used        ', `${Math.round(annual.selfConsumed * factor)} kWh`);
console.log('Exported         ', `${Math.round(annual.exported * factor)} kWh`);
console.log('Grid import      ', `${Math.round(annual.gridImport * factor)} kWh`);
console.log('Battery cycles   ', annual.batteryCyclesPerYear);
console.log('Load reconstructed?', analysis.loadProfile.reconstructed);
