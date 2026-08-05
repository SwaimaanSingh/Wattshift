import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import BatterySimulation from './BatterySimulation.jsx';
import CostBreakdown from './CostBreakdown.jsx';
import { ExistingSystemInputs, PrePostInstallInsight, SetupChangeBanner } from './ExistingSystemPanel.jsx';
import PaybackChart from './PaybackChart.jsx';
import ReportDownload from './ReportDownload.jsx';
import Disclaimer from '../Disclaimer.jsx';
import SolarSizer from '../SolarSizer.jsx';
import { DEFAULTS, getMode } from '../../config/defaults.js';
import {
  calculateProduction,
  calculateSavings,
  calculateScenario,
  effectiveDerate,
} from '../../services/calculationEngine.js';
import { calculateCosts, withPayback } from '../../services/costEstimator.js';
import {
  detectLikelyBattery,
  detectSetupChange,
  estimateSolarFromPeakExport,
  monthYearLabel,
  splitAtChange,
} from '../../services/existingSystemEstimate.js';
import { analyseIntervals, describeUsage } from '../../services/intervalAnalysis.js';
import { friendlyTime } from '../../services/nem12Parser.js';
import { buildTariffModel, periodWindowLabel } from '../../services/touTariffModel.js';
import { MONTH_KEYS, currency0, kwh, number, percent } from '../../utils/formatters.js';

/**
 * Recharts is already the largest thing in the bundle and Stage 2 adds four
 * more charts on top. Splitting them out keeps the cost figures — which is
 * what people came for — on screen while the charts arrive.
 */
const LoadProfileChart = lazy(() => import('./LoadProfileChart.jsx'));
const EnergyBalanceChart = lazy(() => import('./EnergyBalanceChart.jsx'));
const UsageHeatmap = lazy(() => import('./UsageHeatmap.jsx'));
const GenerationOverlay = lazy(() => import('./GenerationOverlay.jsx'));

const ChartFallback = () => (
  <div className="card h-72 animate-pulse-soft" aria-hidden="true" />
);

/**
 * The Stage 2 results page.
 *
 * Handles both paths. With meter data every figure is calculated from the
 * customer's own half-hourly readings; without it, Stage 1's modelled ratios
 * carry the analysis and the page says so rather than implying a precision it
 * doesn't have.
 */
export default function Stage2Results({
  billData,
  solarData,
  roofData,
  meterData,
  stage1,
  manualSolarKw = null,
  manualBatteryKwh = null,
  onBack,
  onGetQuotes,
  onAdviceMetrics,
}) {
  console.log('[Stage2Results] received as props battery handoff', {
    hasBattery: (manualBatteryKwh ?? 0) > 0,
    manualBatteryKwh,
    manualSolarKw,
    stage1BatteryKwh: stage1?.batteryKwh ?? null,
  });

  const mode = stage1?.mode ?? 'home';
  const modeConfig = getMode(mode);
  const isCommercial = mode === 'business';
  const hasIntervalData = Boolean(meterData);

  const [systemKw, setSystemKw] = useState(stage1?.systemKw ?? 6.6);
  // Landing "existing battery" handoff beats Stage 1's modelled add-a-battery
  // slider — those answer different questions.
  const [batteryKwh, setBatteryKwh] = useState(
    (manualBatteryKwh ?? 0) > 0 ? manualBatteryKwh : (stage1?.batteryKwh ?? 0)
  );
  const [tier, setTier] = useState('standard');

  // Whether the customer has manually moved a slider — once they have, we
  // stop nudging it to match a newly-resolved existing-system size.
  const [sizeTouched, setSizeTouched] = useState(false);
  // Manual overrides for a system already on site. null fields fall back to
  // the meter-based estimate; hasBattery gates whether batteryKwh applies.
  const [existingSystemInput, setExistingSystemInput] = useState(() => {
    const initial = {
      solarKw: manualSolarKw ?? null,
      hasBattery: (manualBatteryKwh ?? 0) > 0,
      batteryKwh: manualBatteryKwh ?? null,
      inverterKw: null,
    };
    console.log('[Stage2Results] existingSystemInput useState init', {
      manualBatteryKwh,
      manualSolarKw,
      initial,
    });
    return initial;
  });

  const handleSystemKwChange = (kw) => {
    setSizeTouched(true);
    setSystemKw(kw);
  };
  // Simulation slider only — must NOT write into the existing-system form.
  // The form records what's physically installed (drives hasRealBattery);
  // the slider is a what-if. Syncing them made picking a simulated size
  // flip the page into "real battery" mode and destroy the simulation.
  const handleBatteryKwhChange = (kwhValue) => {
    setSizeTouched(true);
    setBatteryKwh(kwhValue);
  };
  // An explicit spec beats a slider position the customer never chose —
  // typing a real number here should move the sliders to match again.
  const updateExistingSystemInput = (patch) => {
    setSizeTouched(false);
    setExistingSystemInput((prev) => {
      const next = { ...prev, ...patch };
      // Battery typed in the existing-system form must drive chart analysis
      // even if the user already nudged a slider (sizeTouched).
      if ('batteryKwh' in patch || 'hasBattery' in patch) {
        const nextBattery =
          next.hasBattery || (manualBatteryKwh ?? 0) > 0
            ? next.batteryKwh ?? manualBatteryKwh ?? 0
            : 0;
        setBatteryKwh(nextBattery);
      }
      return next;
    });
  };

  const chartRefs = {
    loadProfile: useRef(null),
    energyBalance: useRef(null),
    heatmap: useRef(null),
    generationOverlay: useRef(null),
    payback: useRef(null),
  };

  const derate = useMemo(
    () => effectiveDerate(roofData, solarData?.lat),
    [roofData, solarData]
  );

  const state = solarData?.state ?? 'SA';

  /**
   * Existing solar and battery, from the customer's own meter data rather
   * than Stage 1's bill-derived guess.
   *
   * A file that spans an install date makes averaging the whole thing badly
   * wrong — a system installed nine months in reads as a tenth its real size
   * once diluted by the zero-export months before it. detectSetupChange()
   * finds that step in the export channel; everything past this point
   * analyses only the period since it, unless the customer asks otherwise.
   */
  const meterHasExport = hasIntervalData && Boolean(meterData.channels.B1);

  const setupChange = useMemo(
    () => (meterHasExport ? detectSetupChange(meterData) : null),
    [meterHasExport, meterData]
  );

  const batteryDetection = useMemo(
    () => (hasIntervalData ? detectLikelyBattery(meterData, setupChange) : null),
    [hasIntervalData, meterData, setupChange]
  );

  // Pre-select "Yes, I have one" once when detection fires; leave capacity blank.
  // Do not override a landing handoff that already named a battery size.
  const batteryDetectApplied = useRef(false);
  useEffect(() => {
    if (batteryDetectApplied.current) return;
    if (!batteryDetection?.likely) return;
    if ((manualBatteryKwh ?? 0) > 0) return;
    batteryDetectApplied.current = true;
    setExistingSystemInput((prev) =>
      prev.hasBattery ? prev : { ...prev, hasBattery: true }
    );
  }, [batteryDetection, manualBatteryKwh]);

  const postInstallData = useMemo(() => {
    if (!setupChange?.detected) return null;
    return splitAtChange(meterData, setupChange).post;
  }, [meterData, setupChange]);

  // Once a mid-file install is found, every chart and metric uses only the
  // post-install slice — never the full file blended with zero-export months.
  const activeMeterData = useMemo(() => {
    if (setupChange?.detected && postInstallData) return postInstallData;
    return meterData;
  }, [setupChange, postInstallData, meterData]);

  const meterHasSolar = hasIntervalData && activeMeterData.summary.hasSolar;

  // Sized from whichever export channel we're actually analysing, so the
  // estimate reflects the current system rather than a blend with the
  // zero-export months before it.
  const estimatedExistingSolar = useMemo(() => {
    if (!meterHasSolar) return null;
    return estimateSolarFromPeakExport(activeMeterData.channels.B1);
  }, [meterHasSolar, activeMeterData]);

  const resolvedExistingSolarKw =
    existingSystemInput.solarKw ??
    manualSolarKw ??
    (meterHasSolar ? estimatedExistingSolar?.kw ?? 0 : billData?.hasSolar ? stage1?.existingKw ?? 0 : 0);
  const resolvedExistingBatteryKwh =
    existingSystemInput.hasBattery || (manualBatteryKwh ?? 0) > 0
      ? existingSystemInput.batteryKwh ?? manualBatteryKwh ?? 0
      : 0;

  const existingSolarKw = resolvedExistingSolarKw;
  const isAssessingExisting = existingSolarKw > 3;
  // Meter E1/B1 already include a real battery's effect — simulating another
  // on top double-counts. Mode B solar-without-battery keeps the simulation.
  const hasRealBattery =
    isAssessingExisting &&
    existingSystemInput.hasBattery &&
    resolvedExistingBatteryKwh > 0;
  const simulatedBatteryKwh = hasRealBattery ? 0 : batteryKwh;

  console.log('[Stage2Results] battery section render decision', {
    hasRealBattery,
    batteryCapacityKwh: resolvedExistingBatteryKwh,
    hasBatteryToggle: existingSystemInput.hasBattery,
    willRenderSimulation: !hasRealBattery,
  });

  // Stage 1's numbers, still needed for rates and as the Path B model.
  // When a real battery is already in the data, never feed its kWh into the
  // add-a-battery model.
  const scenario = useMemo(
    () => calculateScenario(billData, solarData, roofData, simulatedBatteryKwh, systemKw, mode),
    [billData, solarData, roofData, simulatedBatteryKwh, systemKw, mode]
  );

  const tariff = useMemo(
    () =>
      buildTariffModel(
        billData,
        state,
        scenario?.savings.rates.tariffCents ?? DEFAULTS.defaultTariffCents
      ),
    [billData, state, scenario]
  );

  // Once a real existing-system size is known, the sliders should start
  // there rather than at Stage 1's "system to add" recommendation — the
  // customer already owns this capacity. Stops nudging once they've touched
  // a slider themselves, or once they've typed a spec of their own.
  // Battery from the landing handoff must apply even when solar size is still
  // unknown (previously this effect bailed entirely when solar ≤ 0).
  useEffect(() => {
    if (sizeTouched) return;
    if (resolvedExistingSolarKw > 0) {
      setSystemKw(resolvedExistingSolarKw);
    }
    if (resolvedExistingBatteryKwh > 0 || existingSystemInput.hasBattery) {
      setBatteryKwh(resolvedExistingBatteryKwh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedExistingSolarKw, resolvedExistingBatteryKwh, sizeTouched, existingSystemInput.hasBattery]);

  const showExistingSystemInputs =
    meterHasSolar ||
    isAssessingExisting ||
    existingSystemInput.hasBattery ||
    existingSystemInput.solarKw != null ||
    (manualBatteryKwh ?? 0) > 0 ||
    manualSolarKw != null;

  const analysis = useMemo(() => {
    if (!hasIntervalData) return null;
    return analyseIntervals({
      meterData: activeMeterData,
      solarData,
      roofData,
      systemKw,
      batteryKwh: simulatedBatteryKwh,
      derate,
      tariff,
      feedInCents: scenario?.savings.rates.feedInCents ?? 0,
      existingSolarKw,
    });
  }, [
    hasIntervalData, activeMeterData, solarData, roofData, systemKw, simulatedBatteryKwh, derate,
    tariff, scenario, existingSolarKw,
  ]);

  const usage = useMemo(
    () => (analysis ? describeUsage(analysis, activeMeterData) : null),
    [analysis, activeMeterData]
  );

  // Hand Stage 2 headline metrics to the advice enquiry page — display only.
  useEffect(() => {
    if (!onAdviceMetrics || !analysis || !activeMeterData) return;
    const annual = analysis.result.annual;
    const factor = analysis.annualisationFactor ?? 1;
    const gridImportKwh = Math.round(annual.gridImport * factor);
    const annualConsumptionKwh = Math.round(annual.totalLoad * factor);
    onAdviceMetrics({
      totalDays: activeMeterData.summary.totalDays,
      selfConsumptionPercent: Math.round(annual.selfConsumptionRatio * 100),
      gridDependencePercent: Math.round(
        (gridImportKwh / Math.max(annualConsumptionKwh, 1)) * 100
      ),
    });
  }, [onAdviceMetrics, analysis, activeMeterData]);

  /**
   * Savings, from whichever source is available.
   *
   * With interval data the saving is what the modelled grid bill actually
   * falls by, priced interval by interval. Without it, Stage 1's calculation
   * stands — it is the same model that produced the estimate they arrived
   * with, so the two pages agree.
   */
  const savings = useMemo(() => {
    if (!analysis) {
      return {
        low: scenario?.savings.annualSavingsLow ?? 0,
        mid: scenario?.savings.annualSavingsMid ?? 0,
        high: scenario?.savings.annualSavingsHigh ?? 0,
        source: 'model',
        breakdown: scenario?.savings.breakdown ?? { fromSelfConsumption: 0, fromExport: 0 },
        currentAnnualBill: scenario?.savings.currentAnnualBill ?? 0,
        newAnnualBill: {
          low: scenario?.savings.newAnnualBillLow ?? 0,
          high: scenario?.savings.newAnnualBillHigh ?? 0,
        },
      };
    }

    const factor = analysis.annualisationFactor;
    const supplyAnnual =
      ((billData?.dailySupplyChargeCents ?? DEFAULTS.defaultSupplyChargeCents) / 100) * 365;

    const withSystem = analysis.result.annual;

    // Dollar value of grid energy displaced by solar and battery, annualised.
    const displacedValue = withSystem.displacedValue * factor;
    // Revenue earned from exported surplus, annualised.
    const exportRevenue = withSystem.exportRevenue * factor;
    // Cost of grid energy still imported after the system, annualised.
    const gridCostAnnual = withSystem.gridCost * factor;

    // Total annual saving = displaced grid purchases + export credits.
    const mid = Math.round(displacedValue + exportRevenue);
    const { low, high } = DEFAULTS.uncertaintyRange;
    const savingsLow = Math.round(mid * low);
    const savingsHigh = Math.round(mid * high);

    // Pre-solar annual bill: all load bought at applicable rates + supply charge.
    // Without the system the self-consumed kWh would have been purchased from
    // the grid at the same rates, so pre-solar grid cost = gridCostAnnual + displacedValue.
    const currentAnnualBill = Math.round(gridCostAnnual + displacedValue + supplyAnnual);

    return {
      low: savingsLow,
      mid,
      high: savingsHigh,
      source: 'interval',
      breakdown: {
        fromSelfConsumption: Math.round(displacedValue),
        fromExport: Math.round(exportRevenue),
      },
      currentAnnualBill,
      newAnnualBill: {
        // Uncertainty applied symmetrically to total savings, not individual components.
        low: Math.round(currentAnnualBill - savingsHigh),
        high: Math.round(currentAnnualBill - savingsLow),
      },
    };
  }, [analysis, scenario, billData]);

  const costs = useMemo(
    () =>
      withPayback(
        calculateCosts({
          systemKw,
          batteryKwh,
          state,
          postcode: solarData?.postcode,
          isCommercial,
          tier,
        }),
        { low: savings.low, mid: savings.mid, high: savings.high }
      ),
    [systemKw, batteryKwh, state, solarData, isCommercial, tier, savings]
  );

  /** Monthly energy balance — measured where we can, modelled where we can't. */
  const monthlyBalance = useMemo(() => {
    console.log('[monthlyBalance] recalculating with batteryKwh=', simulatedBatteryKwh);

    if (analysis) {
      const factor = analysis.annualisationFactor;
      // Prefer the raw dispatch simulation for the chart so battery size
      // changes show up in grid import / from-battery stacks. Headline annual
      // figures may still come from meter totals when assessing an existing
      // system, but month-by-month must reflect the selected battery.
      // When hasRealBattery, simulatedBatteryKwh is 0 so stacks stay honest.
      const monthlySource = analysis.withBattery?.monthly ?? analysis.result.monthly;
      return monthlySource.map((month) => ({
        month: month.month,
        solarToLoad: month.solarToLoad,
        batteryToLoad: month.batteryToLoad,
        gridImport: month.gridImport,
        exported: month.exported,
        days: month.days,
        factor,
      }));
    }

    // Path B: bill-only. Attribute the battery's lift in self-consumption to
    // the battery stack rather than folding it into "solar used directly".
    const production = calculateProduction(systemKw, solarData, derate);
    const ratioWithBattery = scenario?.savings.selfConsumptionPercent / 100 || 0;
    const baseline = calculateScenario(billData, solarData, roofData, 0, systemKw, mode);
    const ratioNoBattery = baseline?.savings.selfConsumptionPercent / 100 || 0;
    const profile = billData?.profile?.monthly ?? {};

    return MONTH_KEYS.map((key) => {
      const generated = production.monthly[key] ?? 0;
      const used = profile[key] ?? 0;
      const selfNoBattery = Math.min(generated * ratioNoBattery, used);
      const selfWithBattery = Math.min(generated * ratioWithBattery, used);
      const batteryToLoad = Math.max(0, selfWithBattery - selfNoBattery);
      const solarToLoad = selfNoBattery;
      return {
        month: key,
        solarToLoad,
        batteryToLoad,
        gridImport: Math.max(0, used - selfWithBattery),
        exported: Math.max(0, generated - selfWithBattery),
      };
    });
  }, [analysis, simulatedBatteryKwh, systemKw, solarData, derate, scenario, billData, roofData, mode]);

  if (!scenario) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-center">
        <p className="text-ink-600 dark:text-ink-300">
          We couldn't build a detailed analysis from this data.
        </p>
        <button type="button" onClick={onBack} className="btn-primary mt-5">
          Back to your estimate
        </button>
      </div>
    );
  }

  const annual = analysis?.result.annual;
  const factor = analysis?.annualisationFactor ?? 1;

  const selfConsumptionPercent = analysis
    ? Math.round(annual.selfConsumptionRatio * 100)
    : scenario.savings.selfConsumptionPercent;

  const generationKwh = analysis
    ? Math.round(annual.totalSolarGeneration * factor)
    : scenario.production.annual;
  const selfConsumedKwh = analysis
    ? Math.round(annual.selfConsumed * factor)
    : scenario.savings.selfConsumedKwh;
  const exportedKwh = analysis
    ? Math.round(annual.exported * factor)
    : scenario.savings.exportedKwh;
  const gridImportKwh = analysis
    ? Math.round(annual.gridImport * factor)
    : Math.max(0, scenario.savings.annualConsumption - scenario.savings.selfConsumedKwh);
  const annualConsumptionKwh = analysis
    ? Math.round(annual.totalLoad * factor)
    : Math.round(scenario.sizing.annualConsumption);
  const gridDependencePercent = Math.round(
    (gridImportKwh / Math.max(annualConsumptionKwh, 1)) * 100
  );

  const buildReport = (preparedFor) => ({
    preparedFor: preparedFor || null,
    hasIntervalData,
    billData,
    solarData,
    roofData,
    mode,
    derate,
    systemKw,
    batteryKwh,
    panelCount: scenario.panelCount,
    roofAreaM2: scenario.roofAreaM2,
    tariff,
    costs,
    usage,
    annualisationFactor: factor,
    warnings: meterData?.warnings ?? [],
    meterSummary: meterData ? { ...activeMeterData.summary, nmi: meterData.nmi } : null,
    setupChange,
    existingSolarKw,
    existingBatteryKwh: resolvedExistingBatteryKwh,
    annualConsumption: analysis
      ? Math.round(annual.totalLoad * factor)
      : Math.round(scenario.sizing.annualConsumption),
    annualGeneration: analysis
      ? Math.round(annual.totalSolarGeneration * factor)
      : scenario.production.annual,
    selfConsumedKwh: analysis
      ? Math.round(annual.selfConsumed * factor)
      : scenario.savings.selfConsumedKwh,
    exportedKwh: analysis
      ? Math.round(annual.exported * factor)
      : scenario.savings.exportedKwh,
    gridImportKwh: analysis
      ? Math.round(annual.gridImport * factor)
      : Math.max(0, scenario.savings.annualConsumption - scenario.savings.selfConsumedKwh),
    storedKwh: analysis ? Math.round(annual.solarToBattery * factor) : 0,
    batteryToLoadKwh: analysis ? Math.round(annual.batteryToLoad * factor) : 0,
    batteryLossesKwh: analysis ? Math.round(annual.batteryLosses * factor) : 0,
    batteryCyclesPerYear: analysis ? annual.batteryCyclesPerYear : 0,
    selfConsumptionPercent,
    offsetPercent: analysis
      ? Math.round((annual.totalSolarGeneration / Math.max(annual.totalLoad, 1)) * 100)
      : scenario.savings.offsetPercent,
    isAssessingExisting,
    gridDependencePercent,
    annualSavings: { low: savings.low, mid: savings.mid, high: savings.high },
    savingsBreakdown: savings.breakdown,
    currentAnnualBill: savings.currentAnnualBill,
    newAnnualBill: savings.newAnnualBill,
    rates: scenario.savings.rates,
  });

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-8 md:max-w-5xl md:px-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[44px] items-center text-sm text-ink-500 underline underline-offset-4 hover:text-ink-800 sm:min-h-0 dark:text-ink-400 dark:hover:text-ink-200"
      >
        ← Back to your estimate
      </button>

      <header className="mt-4 mb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          {isAssessingExisting ? 'How your system is performing' : 'Detailed analysis'}
        </h1>
        <p className="mt-2 text-ink-600 dark:text-ink-300">
          {isAssessingExisting
            ? hasIntervalData
              ? setupChange?.detected
                ? `Analysing ${number(activeMeterData.summary.totalDays)} days of post-install data (from ${monthYearLabel(setupChange.changeDate)}).`
                : `Performance modelled from ${number(activeMeterData.summary.totalDays)} days of your own half-hourly meter readings.`
              : 'Performance estimated from your bill totals and the system size you entered.'
            : hasIntervalData
              ? setupChange?.detected
                ? `Analysing ${number(activeMeterData.summary.totalDays)} days of post-install data (from ${monthYearLabel(setupChange.changeDate)}).`
                : `Modelled from ${number(activeMeterData.summary.totalDays)} days of your own half-hourly meter readings.`
              : 'Modelled from your bill totals and long-term sun data for your postcode.'}
        </p>
      </header>

      <SetupChangeBanner
        setupChange={setupChange}
        resolvedExistingSolarKw={resolvedExistingSolarKw}
        resolvedExistingBatteryKwh={resolvedExistingBatteryKwh}
      />

      {isAssessingExisting && setupChange?.detected && (
        <PrePostInstallInsight
          setupChange={setupChange}
          tariffCents={scenario?.savings.rates.tariffCents}
          feedInCents={scenario?.savings.rates.feedInCents}
          annualExportKwh={exportedKwh}
        />
      )}

      {!hasIntervalData && <BillOnlyNote onBack={onBack} />}
      {analysis?.loadProfile.reconstructed && (
        <ReconstructionNote note={analysis.loadProfile.note} />
      )}
      {hasIntervalData && !activeMeterData.summary.coversFullYear && (
        <PartialYearNote
          days={activeMeterData.summary.totalDays}
          installLabel={setupChange?.detected ? monthYearLabel(setupChange.changeDate) : null}
          factor={factor}
        />
      )}

      <div className="space-y-4 md:space-y-6">
        {showExistingSystemInputs && (
          <ExistingSystemInputs
            estimatedSolar={estimatedExistingSolar}
            solarKwOverride={existingSystemInput.solarKw}
            onSolarKwOverrideChange={(solarKw) => updateExistingSystemInput({ solarKw })}
            hasBattery={existingSystemInput.hasBattery}
            onHasBatteryChange={(hasBattery) => updateExistingSystemInput({ hasBattery })}
            batteryKwh={existingSystemInput.batteryKwh}
            onBatteryKwhChange={(batteryKwhValue) =>
              updateExistingSystemInput({ batteryKwh: batteryKwhValue })
            }
            inverterKw={existingSystemInput.inverterKw}
            onInverterKwChange={(inverterKw) => updateExistingSystemInput({ inverterKw })}
            resolvedExistingSolarKw={resolvedExistingSolarKw}
            batteryDetectionNote={
              batteryDetection?.likely && existingSystemInput.hasBattery
                ? batteryDetection.note
                : null
            }
          />
        )}

        {/* Section 1 — usage pattern */}
        {hasIntervalData && usage && <UsageInsight usage={usage} meterData={activeMeterData} />}

        {hasIntervalData && (
          <Suspense fallback={<ChartFallback />}>
            <LoadProfileChart
              hourlyAverage={analysis.result.hourlyAverage}
              containerRef={chartRefs.loadProfile}
              batteryKwh={simulatedBatteryKwh}
            />
          </Suspense>
        )}

        {hasIntervalData && (
          <Suspense fallback={<ChartFallback />}>
            <UsageHeatmap heatmap={analysis.result.heatmap} containerRef={chartRefs.heatmap} />
          </Suspense>
        )}

        {/* Section 2 — how solar fits / existing performance */}
        {isAssessingExisting ? (
          <ExistingSystemPerformance
            systemKw={systemKw}
            generationKwh={generationKwh}
            selfConsumptionPercent={selfConsumptionPercent}
            selfConsumedKwh={selfConsumedKwh}
            exportedKwh={exportedKwh}
            gridImportKwh={gridImportKwh}
            gridDependencePercent={gridDependencePercent}
            annualConsumptionKwh={annualConsumptionKwh}
            precise={hasIntervalData}
            realBatteryKwh={hasRealBattery ? resolvedExistingBatteryKwh : 0}
          />
        ) : (
          <SolarFit
            systemKw={systemKw}
            selfConsumptionPercent={selfConsumptionPercent}
            selfConsumedKwh={selfConsumedKwh}
            exportedKwh={exportedKwh}
            generationKwh={generationKwh}
            valueOfSelfConsumption={savings.breakdown.fromSelfConsumption}
            valueOfExport={savings.breakdown.fromExport}
            precise={hasIntervalData}
            tariff={tariff}
            state={state}
          />
        )}

        {!isAssessingExisting && (
          <SolarSizer
            systemKw={systemKw}
            recommendedKw={scenario.sizing.recommendedKw}
            onChange={handleSystemKwChange}
            nearZero={null}
            supplyChargeCents={scenario.savings.rates.supplyChargeCents}
            modeConfig={modeConfig}
          />
        )}

        <Suspense fallback={<ChartFallback />}>
          <EnergyBalanceChart
            key={`energy-balance-${simulatedBatteryKwh}`}
            monthly={monthlyBalance}
            batteryKwh={simulatedBatteryKwh}
            containerRef={chartRefs.energyBalance}
            estimated={!hasIntervalData}
          />
        </Suspense>

        {/* Section 3 — battery: simulate only when the meter/bill data does
            not already include a real battery's effects. */}
        {hasRealBattery ? (
          <RealBatteryNote batteryKwh={resolvedExistingBatteryKwh} />
        ) : hasIntervalData ? (
          <BatterySimulation
            batteryKwh={batteryKwh}
            onChange={handleBatteryKwhChange}
            withBattery={analysis.withBattery}
            withoutBattery={analysis.withoutBattery}
            modeConfig={modeConfig}
            annualisationFactor={factor}
            assessingExisting={isAssessingExisting}
          />
        ) : (
          <ModelledBattery
            batteryKwh={batteryKwh}
            onChange={handleBatteryKwhChange}
            modeConfig={modeConfig}
            scenario={scenario}
            billData={billData}
            solarData={solarData}
            roofData={roofData}
            systemKw={systemKw}
            mode={mode}
          />
        )}

        {hasIntervalData && (
          <Suspense fallback={<ChartFallback />}>
            <GenerationOverlay
              loadByDate={analysis.loadProfile.byDate}
              generationByDate={analysis.generation.byDate}
              socByDate={analysis.result.socByDate}
              batteryKwh={simulatedBatteryKwh}
              containerRef={chartRefs.generationOverlay}
            />
          </Suspense>
        )}

        {/* Section 4 — costs */}
        {!isAssessingExisting && (
          <>
            {meterHasSolar &&
              Math.abs(systemKw - resolvedExistingSolarKw) < 0.05 &&
              Math.abs(batteryKwh - resolvedExistingBatteryKwh) < 0.05 && (
                <p className="rounded-xl border border-ink-200 bg-ink-50/70 px-4 py-3 text-sm sm:text-xs text-ink-600 dark:border-ink-800 dark:bg-ink-900/40 dark:text-ink-300">
                  The sliders above are currently set to your existing system, so the
                  cost below is what that size would cost today — useful for
                  comparison, not a bill you owe. Move a slider to see what adding
                  capacity would cost.
                </p>
              )}
            <CostBreakdown
              costs={costs}
              tier={tier}
              onTierChange={setTier}
              annualSavings={{ low: savings.low, high: savings.high }}
            />

            <PaybackChart costs={costs} containerRef={chartRefs.payback} />
          </>
        )}

        {/* Section 5 — report */}
        <ReportDownload
          buildReport={buildReport}
          chartRefs={chartRefs}
          hasIntervalData={hasIntervalData}
          isAssessingExisting={isAssessingExisting}
        />

        {/* Section 6 — next steps */}
        {!isAssessingExisting && (
          <section className="rounded-2xl border border-solar-200 bg-solar-50/60 p-5 text-center dark:border-solar-900 dark:bg-solar-900/15">
            <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
              Ready to get quotes for this system?
            </p>
            <p className="mt-1 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
              Take your report to up to 3 CEC-accredited installers. No spam, no
              pressure.
            </p>
            <button
              type="button"
              onClick={() => onGetQuotes?.(buildReport(''))}
              className="btn-primary mt-3"
            >
              Get quotes from local installers
            </button>
          </section>
        )}
      </div>

      <div className="mt-8">
        <Disclaimer onStartOver={onBack} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

/** The one thing on the page nobody could have told them without their data. */
function UsageInsight({ usage, meterData }) {
  const shapeCopy = {
    daytime:
      'You use most of your power during daylight hours, which is the best possible pattern for solar — most of what the panels make gets used on site without needing a battery.',
    evening:
      'You use most of your power in the evening, after the panels have stopped. This is exactly the pattern a battery is for: it moves midday generation into the hours you actually use it.',
    balanced:
      'Your usage is spread fairly evenly through the day. Solar will cover a decent share directly, and a battery adds a solid amount on top.',
  }[usage.shape];

  return (
    <section className="card animate-fade-up">
      <h2 className="text-base font-semibold">Your actual usage pattern</h2>
      <p className="mt-2 text-sm text-ink-700 dark:text-ink-200">{shapeCopy}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Metric
          label="Heaviest six hours"
          value={`${friendlyTime(usage.heaviestWindow.startSlot)}–${friendlyTime(usage.heaviestWindow.endSlot)}`}
        />
        <Metric label="Busiest half hour" value={friendlyTime(usage.peakSlot)} />
        <Metric
          label="Peak demand"
          value={`${number(usage.peakDemandKw, 1)} kW`}
          hint={usage.peakDemandAt ? `on ${usage.peakDemandAt.date}` : null}
        />
        <Metric
          label="Daytime share"
          value={percent(usage.daytimeShare * 100)}
          hint="8am–6pm"
        />
      </dl>

      {usage.weekendDiffers && (
        <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">
          Your weekends run {usage.weekendHigher ? 'heavier' : 'lighter'} than
          your weekdays — {number(usage.weekendDailyKwh, 1)} kWh against{' '}
          {number(usage.weekdayDailyKwh, 1)} kWh a day.
          {usage.weekendHigher
            ? ' Weekend daytime usage is worth a lot to a solar system.'
            : ''}
        </p>
      )}

      {meterData.summary.hasControlledLoad && (
        <p className="mt-3 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
          Your meter also shows{' '}
          {kwh(Math.round(meterData.summary.totalControlledKwh))} on a controlled
          load circuit — usually hot water on a cheaper overnight tariff. It sits
          on a separate meter element and isn't included above, because solar
          generally can't reach it.
        </p>
      )}
    </section>
  );
}

function ExistingSystemPerformance({
  systemKw,
  generationKwh,
  selfConsumptionPercent,
  selfConsumedKwh,
  exportedKwh,
  gridImportKwh,
  gridDependencePercent,
  annualConsumptionKwh,
  precise,
  realBatteryKwh = 0,
}) {
  const dailyAvg = annualConsumptionKwh > 0 ? annualConsumptionKwh / 365 : 0;

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '60ms' }}>
      <h2 className="text-base font-semibold">Your system performance</h2>

      <p className="mt-2 text-sm text-ink-700 dark:text-ink-200">
        Your {number(systemKw, 1)} kW system generates about {kwh(generationKwh)} a
        year. You use {percent(selfConsumptionPercent)} of that on site ({kwh(selfConsumedKwh)}),
        export {kwh(exportedKwh)}, and still draw {percent(gridDependencePercent)} of your
        total usage from the grid ({kwh(gridImportKwh)}).
      </p>

      {realBatteryKwh > 0 && (
        <p className="mt-2 text-sm text-ink-700 dark:text-ink-200">
          Includes a {number(realBatteryKwh, 1)} kWh battery — these figures already
          reflect its effect on your self-consumption and grid draw.
        </p>
      )}

      <p className="mt-2 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        {precise
          ? 'Generation from your system size and local sun data; export and grid import from your post-install meter readings.'
          : 'Estimated from typical usage patterns and your system size. Upload meter data for a precise read.'}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Metric label="Generation" value={kwh(generationKwh)} hint="per year" />
        <Metric label="Self-consumption" value={percent(selfConsumptionPercent)} />
        <Metric label="Exported" value={kwh(exportedKwh)} />
        <Metric label="Grid dependence" value={percent(gridDependencePercent)} hint="of total usage" />
        <Metric label="True consumption" value={kwh(annualConsumptionKwh)} hint="per year" />
        <Metric label="Daily average" value={`${number(dailyAvg, 1)} kWh/day`} />
      </dl>

    </section>
  );
}

/** Shown instead of the add-a-battery simulation when a real battery is already on site. */
function RealBatteryNote({ batteryKwh }) {
  return (
    <section className="card animate-fade-up" style={{ animationDelay: '300ms' }}>
      <p className="text-sm text-ink-700 dark:text-ink-200">
        Battery: {number(batteryKwh, 1)} kWh — actively storing daytime solar for
        evening use. The performance figures above already include its effect.
      </p>
    </section>
  );
}

function SolarFit({
  systemKw,
  selfConsumptionPercent,
  selfConsumedKwh,
  exportedKwh,
  generationKwh,
  valueOfSelfConsumption,
  valueOfExport,
  precise,
  tariff,
  state,
}) {
  return (
    <section className="card animate-fade-up" style={{ animationDelay: '60ms' }}>
      <h2 className="text-base font-semibold">How solar fits your pattern</h2>

      <p className="mt-2 text-sm text-ink-700 dark:text-ink-200">
        With {number(systemKw, 1)} kW of solar you'd use{' '}
        <strong className="font-semibold">{percent(selfConsumptionPercent)}</strong>{' '}
        of your production directly — that's {kwh(selfConsumedKwh)} worth about{' '}
        <strong className="font-semibold">{currency0(valueOfSelfConsumption)}</strong>{' '}
        a year at your rate. The remaining {kwh(exportedKwh)} would be exported
        for around {currency0(valueOfExport)}.
      </p>

      <p className="mt-2 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        {precise
          ? 'Calculated by matching every half hour of your meter data against modelled generation — not an assumed ratio.'
          : 'Estimated from typical usage patterns. Uploading your meter data would replace this with a calculation from your own readings.'}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Metric label="Generated" value={kwh(generationKwh)} hint="per year" />
        <Metric label="Used on site" value={kwh(selfConsumedKwh)} />
        <Metric label="Exported" value={kwh(exportedKwh)} />
        <Metric label="Self-consumption" value={percent(selfConsumptionPercent)} />
      </dl>

      {tariff?.isTou && (
        <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-sm sm:text-xs text-ink-600 dark:bg-ink-800/50 dark:text-ink-300">
          You're on a time-of-use tariff — peak {periodWindowLabel(state, 'peak')} on
          weekdays at {number(tariff.rates.peak, 1)}c, off-peak at{' '}
          {number(tariff.rates.offPeak, 1)}c. Every interval above is priced at
          the rate that actually applied.
          {tariff.shoulderAssumed && ' Your shoulder rate wasn\'t on the bill, so it\'s been interpolated.'}
        </p>
      )}
      {tariff?.reason && (
        <p className="mt-3 text-sm sm:text-xs text-amber-700 dark:text-amber-400">{tariff.reason}</p>
      )}
    </section>
  );
}

/** Path B battery control — Stage 1's model, honestly labelled. */
function ModelledBattery({
  batteryKwh, onChange, modeConfig, scenario, billData, solarData, roofData, systemKw, mode,
}) {
  const baseline = useMemo(
    () => calculateScenario(billData, solarData, roofData, 0, systemKw, mode),
    [billData, solarData, roofData, systemKw, mode]
  );

  const presets = [...modeConfig.battery.presets];
  if (batteryKwh > 0 && !presets.some((k) => Math.abs(k - batteryKwh) < 0.01)) {
    presets.push(batteryKwh);
  }
  presets.sort((a, b) => a - b);

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '300ms' }}>
      <h2 className="text-base font-semibold">Battery impact</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        Based on typical {modeConfig.occupants} usage patterns.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {presets.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-pressed={Math.abs(value - batteryKwh) < 0.01}
            className={`chip ${Math.abs(value - batteryKwh) < 0.01 ? 'chip-active' : ''}`}
          >
            {DEFAULTS.batteryLabel(value)}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor="stage2-battery-modelled" className="label">
          Battery capacity: <span className="tnum">{number(batteryKwh, 1)} kWh</span>
        </label>
        <input
          id="stage2-battery-modelled"
          type="range"
          min={0}
          max={modeConfig.battery.maxKwh}
          step={modeConfig.battery.stepKwh}
          value={batteryKwh}
          onChange={(e) => onChange(Number(e.target.value))}
          className="range"
        />
      </div>

      {batteryKwh > 0 && baseline && (
        <p className="mt-4 rounded-xl bg-solar-50 px-4 py-3 text-sm text-solar-900 dark:bg-solar-900/25 dark:text-solar-100">
          A {number(batteryKwh, 1)} kWh battery would lift self-consumption from
          about {percent(baseline.savings.selfConsumptionPercent)} to{' '}
          {percent(scenario.savings.selfConsumptionPercent)}.
        </p>
      )}

      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm sm:text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        These are modelled ratios, not measured. A battery's real value depends
        almost entirely on when you use power in the evening — upload your meter
        data to replace this with a half-hourly simulation.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

function BillOnlyNote({ onBack }) {
  return (
    <div className="mb-5 rounded-xl border border-ink-200 bg-ink-50/70 p-4 dark:border-ink-800 dark:bg-ink-900/40">
      <p className="text-sm font-medium">Working from your bill totals</p>
      <p className="mt-1 text-sm sm:text-xs text-ink-600 dark:text-ink-300">
        Upload your smart meter data for charts showing your actual usage
        pattern and precise self-consumption modelling. Everything else on this
        page — costs, rebates, payback and the report — is unaffected.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-solar-700 underline underline-offset-4 sm:min-h-0 sm:text-xs dark:text-solar-400"
      >
        Go back and upload meter data
      </button>
    </div>
  );
}

function ReconstructionNote({ note }) {
  return (
    <div className="mb-5 rounded-xl border border-ink-200 bg-ink-50/70 p-4 dark:border-ink-800 dark:bg-ink-900/40">
      <p className="text-sm font-medium">Your existing solar has been allowed for</p>
      <p className="mt-1 text-sm sm:text-xs text-ink-600 dark:text-ink-300">{note}</p>
    </div>
  );
}

function PartialYearNote({ days, installLabel, factor }) {
  const factorLabel = factor != null ? number(factor, 2) : number(365 / Math.max(days, 1), 2);
  return (
    <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        {installLabel
          ? `Analysing ${number(days)} days of post-install data (from ${installLabel})`
          : `${number(days)} days of data, scaled to a year`}
      </p>
      <p className="mt-1 text-sm sm:text-xs text-amber-800 dark:text-amber-300">
        {installLabel
          ? `Annualisation: ${number(days)} days of post-install data (from ${installLabel}) scaled to a full year (factor: ${factorLabel}).`
          : `Annual figures are extrapolated from what your file covers. If those days aren't representative of the whole year — a summer-only file, for instance — the annual numbers will lean the same way. A full 12 months would remove the guesswork.`}
      </p>
    </div>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div>
      <dt className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className="tnum text-sm font-semibold">{value}</dd>
      {hint && <p className="text-sm text-ink-400 sm:text-[11px] dark:text-ink-500">{hint}</p>}
    </div>
  );
}
