import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BatteryToggle from './BatteryToggle.jsx';
import BillComparison from './BillComparison.jsx';
import ConsumptionSummary from './ConsumptionSummary.jsx';
import Disclaimer from './Disclaimer.jsx';
import ExistingSolar from './ExistingSolar.jsx';
import {
  ExistingSolarIntentPicker,
  ExistingSolarUnknownPrompt,
  ExistingSystemPerformance,
  GridImportSizingNote,
  TrueConsumptionCard,
  TrueConsumptionSizingNote,
} from './ExistingSolarFlow.jsx';
import NextSteps from './NextSteps.jsx';
import RoofInfo from './RoofInfo.jsx';
import ScenarioTable from './ScenarioTable.jsx';
import SiteTypeToggle from './SiteTypeToggle.jsx';
import SolarRecommendation from './SolarRecommendation.jsx';
import SolarSizer from './SolarSizer.jsx';
import StickyResultsBar from './StickyResultsBar.jsx';
import { DEFAULTS, detectMode, getMode } from '../config/defaults.js';
import {
  calculateSavings,
  calculateScenario,
  calculateSelfConsumption,
  estimateTrueConsumption,
  sizeForNearZeroBill,
} from '../services/calculationEngine.js';

/**
 * The chart pulls in Recharts, which is the largest dependency in the bundle
 * and sits below the fold. Loading it separately keeps the numbers people
 * actually came for on screen sooner — this is a phone-first app.
 */
const MonthlyBreakdown = lazy(() => import('./MonthlyBreakdown.jsx'));

/** Screen 4 — the whole estimate. */
export default function Results({
  billData,
  solarData,
  roofData,
  initialSystemKw,
  initialBatteryKwh,
  initialMode,
  onRoofChange,
  onChangeLocation,
  onStartOver,
  onStartStage2,
  onGetQuotes,
  onTalkToEngineer,
  onAdviceSummary,
}) {
  const [batteryKwh, setBatteryKwh] = useState(initialBatteryKwh ?? 0);
  const chartRef = useRef(null);

  // Suggested from usage, but always the customer's call.
  const suggestedMode = useMemo(
    () => detectMode(billData.dailyAverageKwh ?? 0),
    [billData.dailyAverageKwh]
  );
  const [mode, setMode] = useState(initialMode ?? 'home');
  const modeConfig = getMode(mode);

  // Never seed this from bill export — export is surplus after self-use and
  // cannot size the system. Only a user-picked size (or none) goes downstream.
  const [existingKw, setExistingKw] = useState(null);
  // Case B: which exploration path the customer chose.
  const [intent, setIntent] = useState(null);

  const hasExistingSolar = Boolean(billData.hasSolar);
  const existingSizeUnknown = hasExistingSolar && existingKw == null;
  const existingSizeKnown = hasExistingSolar && existingKw != null;

  const trueEstimate = useMemo(() => {
    if (!existingSizeKnown) return null;
    return estimateTrueConsumption(billData, solarData, roofData, existingKw);
  }, [existingSizeKnown, billData, solarData, roofData, existingKw]);

  // Changing size invalidates a stale intent only when leaving the known path.
  useEffect(() => {
    if (!existingSizeKnown) setIntent(null);
  }, [existingSizeKnown]);

  // Bill for Case C (and grid-import display): untouched.
  // Bill for Case B replace (and add modelling): load = reconstructed true consumption.
  const billTrueLoad = useMemo(() => {
    if (!trueEstimate) return null;
    return {
      ...billData,
      dailyAverageKwh: trueEstimate.dailyTrueConsumption,
      totalKwh: trueEstimate.trueConsumption,
      billingDays: 365,
      existingSolarSizeKw: null,
    };
  }, [billData, trueEstimate]);

  // Add-more path: size the top-up against load the existing system doesn't cover.
  const billResidualLoad = useMemo(() => {
    if (!trueEstimate) return null;
    const residual = Math.max(
      0,
      trueEstimate.trueConsumption - trueEstimate.modelledGeneration
    );
    // Engine needs a positive load; a fully-covered residual still yields the
    // practical-minimum recommendation via the sizing floor.
    const load = residual > 0 ? residual : 1;
    return {
      ...billData,
      dailyAverageKwh: load / 365,
      totalKwh: load,
      billingDays: 365,
      existingSolarSizeKw: null,
    };
  }, [billData, trueEstimate]);
  const showSizingFlow =
    !hasExistingSolar || intent === 'add' || intent === 'replace';

  // Which bill drives modelling/savings for the active flow.
  // Add recommendation sizing uses billResidualLoad separately below.
  const billForCalc = useMemo(() => {
    if (!hasExistingSolar) {
      return { ...billData, existingSolarSizeKw: null };
    }
    if (intent === 'add') {
      return billTrueLoad ?? billData;
    }
    /**
     * Replace means the old array comes off the roof, so its generation is
     * irrelevant to what the new one has to cover. Size against raw grid
     * import — the same untouched bill Case C uses. Reconstructed true
     * consumption would make the recommendation grow with the existing size
     * the customer selected, which is exactly what must not happen here.
     */
    if (intent === 'replace') {
      return { ...billData, existingSolarSizeKw: null };
    }
    // Case A / Case B before an intent — grid-import bill for the summary card.
    return billData;
  }, [hasExistingSolar, intent, billData, billTrueLoad]);

  // Grid-import scenario always available for "What you buy from the grid".
  const gridScenario = useMemo(
    () => calculateScenario(billData, solarData, roofData, 0, undefined, mode),
    [billData, solarData, roofData, mode]
  );

  // Recommendation size: add uses residual load (true − existing generation);
  // replace / no-solar use billForCalc through the same engine.
  const recommendedKw = useMemo(() => {
    if (!showSizingFlow) return null;
    const bill =
      intent === 'add' && billResidualLoad ? billResidualLoad : billForCalc;
    const base = calculateScenario(bill, solarData, roofData, 0, undefined, mode);
    return base?.sizing.recommendedKw ?? null;
  }, [
    showSizingFlow,
    intent,
    billResidualLoad,
    billForCalc,
    solarData,
    roofData,
    mode,
  ]);

  const [systemKw, setSystemKw] = useState(initialSystemKw ?? recommendedKw ?? 6.6);
  const [touched, setTouched] = useState(initialSystemKw != null);

  // Follow the recommendation while the customer hasn't overridden it.
  useEffect(() => {
    if (!touched && recommendedKw != null) setSystemKw(recommendedKw);
  }, [recommendedKw, touched]);

  // When switching intents, allow the recommendation to re-seed the slider.
  useEffect(() => {
    if (intent === 'add' || intent === 'replace') {
      setTouched(false);
    }
  }, [intent]);

  // For "add more solar", the slider is additional kW; modelling uses the
  // combined array so savings compare existing-only vs existing + top-up.
  const modelledSystemKw =
    intent === 'add' && existingKw != null ? existingKw + systemKw : systemKw;

  // Card scenario for the add-more recommendation — addition alone vs residual load.
  const addRecommendation = useMemo(() => {
    if (intent !== 'add' || !billResidualLoad) return null;
    return calculateScenario(
      billResidualLoad,
      solarData,
      roofData,
      0,
      systemKw,
      mode
    );
  }, [intent, billResidualLoad, solarData, roofData, systemKw, mode]);

  const scenario = useMemo(() => {
    if (!showSizingFlow) return gridScenario;
    return calculateScenario(
      billForCalc,
      solarData,
      roofData,
      batteryKwh,
      modelledSystemKw,
      mode
    );
  }, [
    showSizingFlow,
    gridScenario,
    billForCalc,
    solarData,
    roofData,
    batteryKwh,
    modelledSystemKw,
    mode,
  ]);

  // Same modelled array, no battery — drives the battery toggle comparison.
  const solarOnlyBaseline = useMemo(() => {
    if (!showSizingFlow || !scenario) return null;
    return calculateScenario(
      billForCalc,
      solarData,
      roofData,
      0,
      modelledSystemKw,
      mode
    );
  }, [
    showSizingFlow,
    scenario,
    billForCalc,
    solarData,
    roofData,
    modelledSystemKw,
    mode,
  ]);

  // Existing system alone — "Now" on the add-more path.
  const existingOnlyBaseline = useMemo(() => {
    if (intent !== 'add' || existingKw == null || !billTrueLoad) return null;
    return calculateScenario(billTrueLoad, solarData, roofData, 0, existingKw, mode);
  }, [intent, existingKw, billTrueLoad, solarData, roofData, mode]);

  /**
   * Battery options for the system already on the roof.
   *
   * Not routed through calculateScenario, and that is the point. The engine
   * has two self-consumption models: sizing holds an undersized system at the
   * flat base ratio, while the reconstruction behind the performance card
   * extends the power law below the production = load crossover. A small array
   * on a large load lands far apart under the two — 30% against 59% here — so
   * pricing these rows the sizing way would contradict the card sitting
   * directly above them about the very same system.
   *
   * So the card's own rate is handed to the engine as the starting share and
   * only the battery capture is modelled on top. Generation comes from the
   * reconstruction's production figure too, so the kWh agree as well as the
   * percentage.
   */
  const performBattery = useMemo(() => {
    if (intent !== 'perform' || existingKw == null) return null;
    if (!trueEstimate || !billTrueLoad) return null;

    const savingsAt = (kwh) =>
      calculateSavings(
        trueEstimate.production,
        billTrueLoad,
        calculateSelfConsumption(
          kwh,
          existingKw,
          solarData.annual,
          trueEstimate.effectiveDerate,
          mode === 'business',
          trueEstimate.trueConsumption,
          { baseRatioOverride: trueEstimate.selfConsumptionRate }
        )
      );

    const sizes = [...modeConfig.battery.presets];
    const isCustom =
      batteryKwh > 0 && !sizes.some((kwh) => Math.abs(kwh - batteryKwh) < 0.01);
    if (isCustom) sizes.push(batteryKwh);

    return {
      baseline: savingsAt(0),
      current: savingsAt(batteryKwh),
      scenarios: sizes
        .sort((a, b) => a - b)
        .map((kwh) => ({
          label: kwh === 0 ? 'Solar only' : `Solar + ${DEFAULTS.batteryLabel(kwh)}`,
          batteryKwh: kwh,
          isCustom: isCustom && Math.abs(kwh - batteryKwh) < 0.01,
          savings: savingsAt(kwh),
        })),
    };
  }, [
    intent,
    existingKw,
    trueEstimate,
    billTrueLoad,
    solarData,
    modeConfig,
    batteryKwh,
    mode,
  ]);

  const displaySavings = useMemo(() => {
    if (!scenario) return null;
    if (intent === 'add' && existingOnlyBaseline) {
      const now = existingOnlyBaseline.savings.newAnnualBillMid;
      const afterLow = scenario.savings.newAnnualBillLow;
      const afterHigh = scenario.savings.newAnnualBillHigh;
      const afterMid = scenario.savings.newAnnualBillMid;
      return {
        ...scenario.savings,
        currentAnnualBill: now,
        annualSavingsLow: Math.max(0, now - afterHigh),
        annualSavingsHigh: Math.max(0, now - afterLow),
        annualSavingsMid: Math.max(0, now - afterMid),
      };
    }
    return scenario.savings;
  }, [scenario, intent, existingOnlyBaseline]);

  const nearZero = useMemo(() => {
    if (!showSizingFlow) return null;
    const bill =
      intent === 'add' && billResidualLoad ? billResidualLoad : billForCalc;
    return sizeForNearZeroBill(bill, solarData, roofData, batteryKwh, mode);
  }, [
    showSizingFlow,
    intent,
    billResidualLoad,
    billForCalc,
    solarData,
    roofData,
    batteryKwh,
    mode,
  ]);

  const scenarios = useMemo(() => {
    if (!showSizingFlow || !scenario) return [];

    const sizes = [...modeConfig.battery.presets];
    const isCustom =
      batteryKwh > 0 && !sizes.some((kwh) => Math.abs(kwh - batteryKwh) < 0.01);
    if (isCustom) sizes.push(batteryKwh);

    return sizes
      .sort((a, b) => a - b)
      .map((kwh) => {
        const s = calculateScenario(
          billForCalc,
          solarData,
          roofData,
          kwh,
          modelledSystemKw,
          mode
        );
        return {
          label: kwh === 0 ? 'Solar only' : `Solar + ${DEFAULTS.batteryLabel(kwh)}`,
          batteryKwh: kwh,
          isCustom: isCustom && Math.abs(kwh - batteryKwh) < 0.01,
          savings: s.savings,
        };
      });
  }, [
    showSizingFlow,
    billForCalc,
    solarData,
    roofData,
    modelledSystemKw,
    mode,
    batteryKwh,
    modeConfig,
    scenario,
  ]);

  const buildStage1Summary = useCallback(
    () => ({
      mode,
      systemKw,
      batteryKwh,
      existingKw: billData.hasSolar ? existingKw : 0,
      solarData,
      sizing: scenario?.sizing,
    }),
    [mode, systemKw, batteryKwh, billData, existingKw, solarData, scenario]
  );

  const goStage2 = onStartStage2
    ? () => onStartStage2(buildStage1Summary())
    : null;

  if (!gridScenario) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-center">
        <p className="text-ink-600 dark:text-ink-300">
          We couldn&apos;t work out an estimate from this bill.
        </p>
        <button type="button" onClick={onStartOver} className="btn-primary mt-5">
          Try another bill
        </button>
      </div>
    );
  }

  // Consumption card always reflects grid purchases from the bill.
  const gridSizing = gridScenario.sizing;
  const gridSavings = gridScenario.savings;

  const activeScenario = scenario ?? gridScenario;
  const { sizing, production } = activeScenario;
  const savings = displaySavings ?? activeScenario.savings;
  const batteryLabel = DEFAULTS.batteryLabel(batteryKwh);

  const summary = {
    billData,
    solarData,
    roofData,
    sizing,
    production,
    savings,
    systemKw: modelledSystemKw,
    batteryKwh,
    batteryLabel,
    mode,
    panelCount: activeScenario.panelCount,
    roofAreaM2: activeScenario.roofAreaM2,
    scenarios,
  };

  // Keep the Stage 3 advice page in sync even if they open it from the nav.
  useEffect(() => {
    onAdviceSummary?.(summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemKw, batteryKwh, mode, savings, billData, solarData]);

  const showSticky =
    !hasExistingSolar || intent === 'add' || intent === 'replace';

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-8 md:max-w-5xl md:px-8">
      {showSticky && (
        <StickyResultsBar
          systemKw={intent === 'add' ? systemKw : modelledSystemKw}
          savingsLow={savings.annualSavingsLow}
          savingsHigh={savings.annualSavingsHigh}
          onUpload={onStartOver}
        />
      )}

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Your solar estimate
          </h1>
          <button
            type="button"
            onClick={onChangeLocation}
            className="mt-1 inline-flex min-h-[44px] items-center text-sm text-ink-500 underline underline-offset-4 hover:text-ink-800 sm:min-h-0 dark:text-ink-400 dark:hover:text-ink-200"
          >
            {solarData.name} ({solarData.postcode}) — change
          </button>
        </div>

        <button
          type="button"
          onClick={onStartOver}
          className="btn-secondary min-h-[44px] shrink-0 px-4 py-2 text-sm sm:min-h-0"
        >
          Upload a bill
        </button>
      </header>

      {billData.confidence !== 'high' && (
        <ConfidenceNote billData={billData} onStartOver={onStartOver} />
      )}

      <div className="space-y-4 md:space-y-6">
        <SiteTypeToggle
          mode={mode}
          onChange={setMode}
          dailyAverageKwh={
            trueEstimate && (intent === 'add' || intent === 'replace')
              ? trueEstimate.dailyTrueConsumption
              : billData.dailyAverageKwh
          }
          suggested={suggestedMode}
        />

        {/* ── Case C: no existing solar — original Stage 1 ─────────────── */}
        {!hasExistingSolar && (
          <>
            <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 md:gap-6">
              <ConsumptionSummary
                billData={billData}
                sizing={gridSizing}
                savings={gridSavings}
              />
              <SolarRecommendation
                sizing={sizing}
                production={production}
                savings={savings}
                solarData={solarData}
                hasExistingSolar={false}
                existingKw={null}
                systemKw={systemKw}
                panelCount={activeScenario.panelCount}
                roofAreaM2={activeScenario.roofAreaM2}
                modeConfig={modeConfig}
              />
            </div>

            {solarOnlyBaseline && (
              <StandardSizingBlocks
                savings={savings}
                batteryKwh={batteryKwh}
                systemKw={systemKw}
                recommendedKw={sizing.recommendedKw}
                setTouched={setTouched}
                setSystemKw={setSystemKw}
                nearZero={nearZero}
                modeConfig={modeConfig}
                billData={billData}
                production={production}
                chartRef={chartRef}
                setBatteryKwh={setBatteryKwh}
                baseline={solarOnlyBaseline}
                scenarios={scenarios}
                summary={summary}
                onGetQuotes={onGetQuotes}
                onRoofChange={onRoofChange}
                roofData={roofData}
                solarData={solarData}
                goStage2={goStage2}
                onTalkToEngineer={onTalkToEngineer}
              />
            )}
          </>
        )}

        {/* ── Cases A & B: existing solar detected ─────────────────────── */}
        {hasExistingSolar && (
          <>
            <ExistingSolar
              billData={billData}
              value={existingKw}
              onChange={setExistingKw}
            />

            <ConsumptionSummary
              billData={billData}
              sizing={gridSizing}
              savings={gridSavings}
            />

            {/* Case A — size unknown */}
            {existingSizeUnknown && (
              <ExistingSolarUnknownPrompt onStartStage2={goStage2} />
            )}

            {/* Case B — size known */}
            {existingSizeKnown && trueEstimate && (
              <>
                <TrueConsumptionCard
                  estimate={trueEstimate}
                  billGridAnnual={trueEstimate.annualGridImport}
                />

                <ExistingSolarIntentPicker intent={intent} onChange={setIntent} />

                {intent === 'perform' && (
                  <>
                    <ExistingSystemPerformance
                      estimate={trueEstimate}
                      billData={billData}
                    />

                    {/* Same battery block the other two intents get, sized
                        against the existing array. Sits above the roof /
                        next-steps grid rendered below. */}
                    {performBattery && (
                      <>
                        <BatteryToggle
                          batteryKwh={batteryKwh}
                          onChange={setBatteryKwh}
                          baseline={performBattery.baseline}
                          current={performBattery.current}
                          modeConfig={modeConfig}
                        />
                        <ScenarioTable
                          scenarios={performBattery.scenarios}
                          batteryKwh={batteryKwh}
                          systemKw={existingKw}
                        />
                      </>
                    )}
                  </>
                )}

                {intent === 'add' && scenario && solarOnlyBaseline && (
                  <>
                    <TrueConsumptionSizingNote />
                    {addRecommendation && (
                      <SolarRecommendation
                        sizing={{
                          ...addRecommendation.sizing,
                          recommendedKw:
                            recommendedKw ?? addRecommendation.sizing.recommendedKw,
                          additionalKwNeeded:
                            recommendedKw ?? addRecommendation.sizing.recommendedKw,
                        }}
                        production={addRecommendation.production}
                        savings={addRecommendation.savings}
                        solarData={solarData}
                        hasExistingSolar={false}
                        existingKw={existingKw}
                        systemKw={systemKw}
                        panelCount={addRecommendation.panelCount}
                        roofAreaM2={addRecommendation.roofAreaM2}
                        modeConfig={modeConfig}
                        isAddition
                      />
                    )}
                    <StandardSizingBlocks
                      savings={savings}
                      batteryKwh={batteryKwh}
                      systemKw={systemKw}
                      recommendedKw={recommendedKw ?? sizing.recommendedKw}
                      setTouched={setTouched}
                      setSystemKw={setSystemKw}
                      nearZero={nearZero}
                      modeConfig={modeConfig}
                      billData={billForCalc}
                      production={production}
                      chartRef={chartRef}
                      setBatteryKwh={setBatteryKwh}
                      baseline={solarOnlyBaseline}
                      scenarios={scenarios}
                      summary={summary}
                      onGetQuotes={onGetQuotes}
                      onRoofChange={onRoofChange}
                      roofData={roofData}
                      solarData={solarData}
                      goStage2={goStage2}
                      onTalkToEngineer={onTalkToEngineer}
                      sizerTitle="Additional solar"
                      sizerDescription={`Extra capacity on top of your ${existingKw.toFixed(1)} kW system. Drag or type to model the top-up against your estimated true consumption.`}
                      scenarioSystemKw={modelledSystemKw}
                    />
                  </>
                )}

                {intent === 'replace' && scenario && solarOnlyBaseline && (
                  <>
                    <GridImportSizingNote />
                    <SolarRecommendation
                      sizing={sizing}
                      production={production}
                      savings={savings}
                      solarData={solarData}
                      hasExistingSolar={false}
                      existingKw={null}
                      systemKw={systemKw}
                      panelCount={activeScenario.panelCount}
                      roofAreaM2={activeScenario.roofAreaM2}
                      modeConfig={modeConfig}
                    />
                    <StandardSizingBlocks
                      savings={savings}
                      batteryKwh={batteryKwh}
                      systemKw={systemKw}
                      recommendedKw={sizing.recommendedKw}
                      setTouched={setTouched}
                      setSystemKw={setSystemKw}
                      nearZero={nearZero}
                      modeConfig={modeConfig}
                      billData={billForCalc}
                      production={production}
                      chartRef={chartRef}
                      setBatteryKwh={setBatteryKwh}
                      baseline={solarOnlyBaseline}
                      scenarios={scenarios}
                      summary={summary}
                      onGetQuotes={onGetQuotes}
                      onRoofChange={onRoofChange}
                      roofData={roofData}
                      solarData={solarData}
                      goStage2={goStage2}
                      onTalkToEngineer={onTalkToEngineer}
                    />
                  </>
                )}
              </>
            )}

            {/* Roof / next-steps: only once a size is known. Add/replace
                intents already include these inside StandardSizingBlocks. */}
            {existingSizeKnown && intent !== 'add' && intent !== 'replace' && (
              <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 md:gap-6">
                <RoofInfo
                  roof={roofData}
                  detected={roofData.detected}
                  locationName={solarData.name}
                  onChange={onRoofChange}
                />
                <NextSteps
                  summary={summary}
                  chartRef={chartRef}
                  onGetQuotes={() => onGetQuotes?.(summary)}
                  onStartStage2={goStage2}
                  onTalkToEngineer={
                    onTalkToEngineer ? () => onTalkToEngineer(summary) : null
                  }
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-8">
        <Disclaimer onStartOver={onStartOver} />
      </div>
    </div>
  );
}

/**
 * Shared Stage 1 sizing / savings / battery / quotes block.
 * Used by Case C and by Case B intents add & replace.
 */
function StandardSizingBlocks({
  savings,
  batteryKwh,
  systemKw,
  recommendedKw,
  setTouched,
  setSystemKw,
  nearZero,
  modeConfig,
  billData,
  production,
  chartRef,
  setBatteryKwh,
  baseline,
  scenarios,
  summary,
  onGetQuotes,
  onRoofChange,
  roofData,
  solarData,
  goStage2,
  onTalkToEngineer,
  sizerTitle,
  sizerDescription,
  // The comparison rows are modelled on the whole array, which on the add-more
  // path is existing + addition while the slider above shows the addition
  // alone. Defaults to the slider size everywhere those two are the same.
  scenarioSystemKw = systemKw,
}) {
  return (
    <>
      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 md:gap-6">
        <BillComparison savings={savings} batteryKwh={batteryKwh} />
        <SolarSizer
          systemKw={systemKw}
          recommendedKw={recommendedKw}
          onChange={(kw) => {
            setTouched(true);
            setSystemKw(kw);
          }}
          nearZero={nearZero}
          supplyChargeCents={savings.rates.supplyChargeCents}
          modeConfig={modeConfig}
          title={sizerTitle}
          description={sizerDescription}
        />
      </div>

      <Suspense
        fallback={<div className="card h-80 animate-pulse-soft" aria-hidden="true" />}
      >
        <MonthlyBreakdown
          profile={billData.profile}
          production={production}
          containerRef={chartRef}
        />
      </Suspense>

      <BatteryToggle
        batteryKwh={batteryKwh}
        onChange={setBatteryKwh}
        baseline={baseline.savings}
        current={savings}
        modeConfig={modeConfig}
      />

      <ScenarioTable
        scenarios={scenarios}
        batteryKwh={batteryKwh}
        systemKw={scenarioSystemKw}
      />

      <div className="rounded-2xl border border-solar-200 bg-solar-50/60 p-5 text-center dark:border-solar-900 dark:bg-solar-900/15">
        <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
          Not sure which option is right for {modeConfig.site}?
        </p>
        <button
          type="button"
          onClick={() => onGetQuotes?.(summary)}
          className="btn-primary mt-3"
        >
          Get expert quotes
        </button>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 md:gap-6">
        <RoofInfo
          roof={roofData}
          detected={roofData.detected}
          locationName={solarData.name}
          onChange={onRoofChange}
        />
        <NextSteps
          summary={summary}
          chartRef={chartRef}
          onGetQuotes={() => onGetQuotes?.(summary)}
          onStartStage2={goStage2}
          onTalkToEngineer={
            onTalkToEngineer ? () => onTalkToEngineer(summary) : null
          }
        />
      </div>
    </>
  );
}

/** Honest about what we couldn't read, rather than quietly guessing. */
function ConfidenceNote({ billData, onStartOver }) {
  const assumed = [];
  if (billData.tariffRateCentsPerKwh == null) assumed.push('your usage rate');
  if (billData.dailySupplyChargeCents == null) assumed.push('your daily supply charge');
  if (billData.feedInTariffCents == null && billData.hasSolar) {
    assumed.push('your feed-in tariff');
  }

  const wasScanned = billData.diagnostics?.textSource === 'ocr';

  let heading;
  if (billData.fromSharedLink) heading = 'Opened from a shared link';
  else if (billData.enteredManually) heading = 'Based on the numbers you entered';
  else if (assumed.length > 0) heading = "We couldn't read everything on this bill";
  else if (wasScanned) heading = 'This bill was a scan, so we read it with text recognition';
  else heading = 'Some details on this bill were hard to read';

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20 md:mb-6">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{heading}</p>

      {assumed.length > 0 ? (
        <p className="mt-1 text-sm sm:text-xs text-amber-800 dark:text-amber-300">
          We&apos;ve used typical South Australian figures for {listToText(assumed)}.
          The estimate is still useful, but treat it as indicative.
        </p>
      ) : (
        wasScanned && (
          <p className="mt-1 text-sm sm:text-xs text-amber-800 dark:text-amber-300">
            We found everything we needed, but it&apos;s worth checking the usage and
            rate above against your bill — scans can blur a digit.
          </p>
        )
      )}

      {billData.fromSharedLink && (
        <>
          <p className="mt-1 text-sm sm:text-xs text-amber-800 dark:text-amber-300">
            This estimate was shared with you. Upload your own bill for a
            personalised estimate based on your actual usage.
          </p>
          <button
            type="button"
            onClick={onStartOver}
            className="mt-2 text-sm sm:text-xs font-semibold text-amber-900 underline underline-offset-4 dark:text-amber-200"
          >
            Upload your own bill instead
          </button>
        </>
      )}
    </div>
  );
}

function listToText(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
