import { useCallback, useEffect, useRef, useState } from 'react';
import AboutPage from './components/AboutPage.jsx';
import EnquirePage from './components/EnquirePage.jsx';
import EnquiryModal from './components/EnquiryModal.jsx';
import FallbackForm from './components/FallbackForm.jsx';
import Landing, { recordEstimate } from './components/Landing.jsx';
import LocationInput from './components/LocationInput.jsx';
import PrivacyPage from './components/PrivacyPage.jsx';
import ProcessingScreen from './components/ProcessingScreen.jsx';
import QuoteChecker from './components/QuoteChecker.jsx';
import Results from './components/Results.jsx';
import Stage2Landing from './components/Stage2/Stage2Landing.jsx';
import Stage2Results from './components/Stage2/Stage2Results.jsx';
import SiteFooter from './components/SiteFooter.jsx';
import SiteHeader from './components/SiteHeader.jsx';
import { DEFAULTS } from './config/defaults.js';
import { extractMultipleBills } from './services/billParser.js';
import { mergeBills } from './services/calculationEngine.js';
import { getRoofData } from './services/googleSolarApi.js';
import { lookupPostcode } from './services/solarDataService.js';
import { readResultsUrl } from './services/resultsLink.js';

const STAGE = {
  LANDING: 'landing',
  PROCESSING: 'processing',
  FALLBACK: 'fallback',
  LOCATION: 'location',
  RESULTS: 'results',
  ABOUT: 'about',
  PRIVACY: 'privacy',
  QUOTE: 'quote',
  ENQUIRE: 'enquire',
  STAGE2_LANDING: 'stage2-landing',
  STAGE2_RESULTS: 'stage2-results',
};

/** Stages that get the site chrome. The focused flow stages don't. */
const CHROME_STAGES = new Set([
  STAGE.LANDING,
  STAGE.ABOUT,
  STAGE.PRIVACY,
  STAGE.QUOTE,
  STAGE.ENQUIRE,
  STAGE.RESULTS,
  STAGE.STAGE2_LANDING,
  STAGE.STAGE2_RESULTS,
]);

export default function App() {
  const [stage, setStage] = useState(STAGE.LANDING);
  const [progress, setProgress] = useState({ stage: '', pct: null, fileCount: 0 });
  const [billData, setBillData] = useState(null);
  const [solarData, setSolarData] = useState(null);
  const [roofData, setRoofData] = useState({ ...DEFAULTS.roofDefaults, detected: false });
  const [shared, setShared] = useState(null);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  // Estimate context handed to the installer quote modal.
  const [enquiryContext, setEnquiryContext] = useState(null);
  // Stage 3 advice page — Stage 1 summary + optional Stage 2 NEM12 metrics.
  const [adviceContext, setAdviceContext] = useState({ summary: null, stage2: null });
  // Stage 2 — context carried forward from Stage 1, and parsed NEM12 data.
  const [stage1Summary, setStage1Summary] = useState(null);
  const [meterData, setMeterData] = useState(null);
  const [stage2Manual, setStage2Manual] = useState({ solarKw: null, batteryKwh: null });
  const howRef = useRef(null);

  // Deep-link: /enquire opens the advice form; shared estimate links still win.
  useEffect(() => {
    if (window.location.pathname === '/enquire' && !readResultsUrl()) {
      setStage(STAGE.ENQUIRE);
    }
  }, []);

  // A shared link carries enough numbers to rebuild the estimate, so it lands
  // straight on results without an upload.
  useEffect(() => {
    const restored = readResultsUrl();
    if (!restored) return;

    let cancelled = false;
    (async () => {
      try {
        const solar = await lookupPostcode(restored.postcode);
        if (cancelled) return;
        setSolarData(solar);
        setRoofData(restored.roofData);
        setBillData(mergeBills([restored.billData]));
        setShared({
          systemKw: restored.systemKw,
          batteryKwh: restored.batteryKwh,
          mode: restored.mode,
        });
        setStage(STAGE.RESULTS);
      } catch {
        // A malformed link just leaves the landing page in place.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Resolve location and roof, then show results. Roof lookup is best-effort:
   * no key or no coverage simply means we keep the typical-roof assumptions.
   */
  const resolveLocation = useCallback(async (postcode, bill) => {
    const solar = await lookupPostcode(postcode);
    setSolarData(solar);

    const roof = await getRoofData(solar.lat, solar.lng);
    setRoofData(roof ? { ...roof, shading: 'none' } : { ...DEFAULTS.roofDefaults, detected: false });

    setBillData(bill);
    setStage(STAGE.RESULTS);
  }, []);

  const handleFiles = useCallback(
    async (files) => {
      setStage(STAGE.PROCESSING);
      setProgress({ stage: 'Reading your bill…', pct: null, fileCount: files.length });

      const bills = await extractMultipleBills(files, (text, pct) =>
        setProgress((p) => ({ ...p, stage: text, pct }))
      );

      const usable = bills.filter((b) => b.confidence !== 'low');
      const merged = mergeBills(usable.length > 0 ? usable : bills);

      // Regex and AI both fell short — ask for the few numbers we need.
      if (usable.length === 0) {
        setBillData(merged);
        setStage(STAGE.FALLBACK);
        return;
      }

      setProgress((p) => ({ ...p, stage: 'Setting up your estimate…', pct: 0.9 }));
      recordEstimate();

      if (merged.postcode) {
        await resolveLocation(merged.postcode, merged);
      } else {
        setBillData(merged);
        setStage(STAGE.LOCATION);
      }
    },
    [resolveLocation]
  );

  const handleManualEntry = useCallback(
    async (manual) => {
      const withProfile = mergeBills([manual]);
      await resolveLocation(manual.postcode, withProfile);
    },
    [resolveLocation]
  );

  const handleLocationResolved = useCallback(
    async (location) => {
      setSolarData(location);
      const roof = await getRoofData(location.lat, location.lng);
      setRoofData(
        roof ? { ...roof, shading: 'none' } : { ...DEFAULTS.roofDefaults, detected: false }
      );
      setStage(STAGE.RESULTS);
    },
    []
  );

  const startOver = useCallback(() => {
    setBillData(null);
    setSolarData(null);
    setShared(null);
    setStage1Summary(null);
    setMeterData(null);
    setAdviceContext({ summary: null, stage2: null });
    setRoofData({ ...DEFAULTS.roofDefaults, detected: false });
    // Drop any shared-link params or Stage 2/3 paths so a reload starts clean.
    if (window.location.search || window.location.pathname !== '/') {
      window.history.replaceState({}, '', '/');
    }
    setStage(STAGE.LANDING);
  }, []);

  /**
   * @param {object|null} summary
   * @param {{topic?: string|null}} [options] pre-selects the enquiry topic.
   *   Destructured with a default so a caller that passes an event object in
   *   this slot is harmless — existing callers pass nothing and are unchanged.
   */
  const openEnquire = useCallback((summary = null, { topic = null } = {}) => {
    if (summary) {
      setAdviceContext((prev) => ({ ...prev, summary }));
    }
    setStage(STAGE.ENQUIRE);
    const query = topic ? `?topic=${encodeURIComponent(topic)}` : '';
    window.history.pushState({}, '', `/enquire${query}`);
  }, []);

  const handleAdviceMetrics = useCallback((stage2) => {
    setAdviceContext((prev) => ({ ...prev, stage2 }));
  }, []);

  const handleAdviceSummary = useCallback((summary) => {
    setAdviceContext((prev) => ({ ...prev, summary }));
  }, []);

  /** Transition to the Stage 2 landing page, carrying Stage 1 context. */
  const handleStartStage2 = useCallback((stage1Data) => {
    setStage1Summary(stage1Data);
    setMeterData(null);
    setStage2Manual({ solarKw: null, batteryKwh: null });
    setStage(STAGE.STAGE2_LANDING);
    window.history.pushState({}, '', '/stage2');
  }, []);

  /** Stage 2 landing → results: store the parsed meter data (or null for bill-only). */
  const handleStage2Proceed = useCallback(({ meterData: data, manualSolarKw, manualBatteryKwh } = {}) => {
    console.log('[App] received FROM Stage2Landing battery handoff', {
      hasBattery: (manualBatteryKwh ?? 0) > 0,
      manualBatteryKwh: manualBatteryKwh ?? null,
      manualSolarKw: manualSolarKw ?? null,
      hasMeterData: Boolean(data),
    });
    setMeterData(data ?? null);
    setStage2Manual({
      solarKw: manualSolarKw ?? null,
      batteryKwh: manualBatteryKwh ?? null,
    });
    setStage(STAGE.STAGE2_RESULTS);
    window.history.pushState({}, '', '/stage2/results');
  }, []);

  /** Stage 2 results → back to Stage 2 landing. */
  const handleStage2Back = useCallback(() => {
    setStage(STAGE.STAGE2_LANDING);
    window.history.pushState({}, '', '/stage2');
  }, []);

  /** Stage 2 landing → back to Stage 1 results. */
  const handleStage2LandingBack = useCallback(() => {
    setStage(STAGE.RESULTS);
    window.history.pushState({}, '', '/');
  }, []);

  // Browser back/forward within Stage 2 / Stage 3 paths.
  useEffect(() => {
    const onPop = () => {
      const { pathname } = window.location;
      if (pathname === '/enquire') {
        setStage(STAGE.ENQUIRE);
      } else if (pathname === '/stage2/results' && stage1Summary) {
        setStage(STAGE.STAGE2_RESULTS);
      } else if (pathname === '/stage2' && stage1Summary) {
        setStage(STAGE.STAGE2_LANDING);
      } else {
        setStage(billData ? STAGE.RESULTS : STAGE.LANDING);
        if (pathname !== '/') window.history.replaceState({}, '', '/');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [billData, stage1Summary]);

  /** Header/footer navigation. "how" scrolls rather than switching view. */
  const navigate = useCallback(
    (key) => {
      if (key === 'enquire') return openEnquire();
      if (key === 'about') {
        if (window.location.pathname === '/enquire') {
          window.history.pushState({}, '', '/');
        }
        return setStage(STAGE.ABOUT);
      }
      if (key === 'privacy') {
        if (window.location.pathname === '/enquire') {
          window.history.pushState({}, '', '/');
        }
        return setStage(STAGE.PRIVACY);
      }
      if (key === 'quote') {
        if (window.location.pathname === '/enquire') {
          window.history.pushState({}, '', '/');
        }
        return setStage(STAGE.QUOTE);
      }
      if (key === 'how') {
        setStage(STAGE.LANDING);
        if (window.location.pathname !== '/') {
          window.history.pushState({}, '', '/');
        }
        // Wait for the landing view to mount before scrolling to it.
        requestAnimationFrame(() =>
          howRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        );
        return undefined;
      }
      return startOver();
    },
    [startOver, openEnquire]
  );

  const body = renderStage();

  function renderStage() {
    switch (stage) {
      case STAGE.PROCESSING:
        return (
          <ProcessingScreen
            stage={progress.stage}
            progress={progress.pct}
            fileCount={progress.fileCount}
          />
        );

      case STAGE.FALLBACK:
        return (
          <FallbackForm
            billData={billData}
            onSubmit={handleManualEntry}
            onRetry={startOver}
          />
        );

      case STAGE.LOCATION:
        return (
          <LocationInput
            initialPostcode={billData?.postcode}
            onResolved={handleLocationResolved}
            onBack={startOver}
          />
        );

      case STAGE.ABOUT:
        return <AboutPage onUpload={startOver} />;

      case STAGE.PRIVACY:
        return <PrivacyPage />;

      case STAGE.QUOTE:
        return <QuoteChecker onGetQuotes={() => setEnquiryOpen(true)} />;

      case STAGE.ENQUIRE:
        return (
          <EnquirePage
            adviceContext={adviceContext}
            onBack={() => {
              if (billData) {
                setStage(STAGE.RESULTS);
                window.history.pushState({}, '', '/');
              } else {
                startOver();
              }
            }}
          />
        );

      case STAGE.RESULTS:
        return (
          <Results
            billData={billData}
            solarData={solarData}
            roofData={roofData}
            initialSystemKw={shared?.systemKw}
            initialBatteryKwh={shared?.batteryKwh}
            initialMode={shared?.mode}
            onRoofChange={setRoofData}
            onChangeLocation={() => setStage(STAGE.LOCATION)}
            onStartOver={startOver}
            onStartStage2={handleStartStage2}
            onGetQuotes={(context) => {
              setEnquiryContext(context);
              setEnquiryOpen(true);
            }}
            onTalkToEngineer={openEnquire}
            onAdviceSummary={handleAdviceSummary}
          />
        );

      case STAGE.STAGE2_LANDING:
        return (
          <Stage2Landing
            stage1={stage1Summary}
            state={solarData?.state ?? 'SA'}
            onProceed={handleStage2Proceed}
            onBack={handleStage2LandingBack}
          />
        );

      case STAGE.STAGE2_RESULTS:
        console.log('[App] passing TO Stage2Results battery handoff', {
          hasBattery: (stage2Manual.batteryKwh ?? 0) > 0,
          manualBatteryKwh: stage2Manual.batteryKwh,
          manualSolarKw: stage2Manual.solarKw,
        });
        return (
          <Stage2Results
            billData={billData}
            solarData={solarData}
            roofData={roofData}
            meterData={meterData}
            stage1={stage1Summary}
            manualSolarKw={stage2Manual.solarKw}
            manualBatteryKwh={stage2Manual.batteryKwh}
            onBack={handleStage2Back}
            onGetQuotes={(context) => {
              setEnquiryContext(context);
              setEnquiryOpen(true);
            }}
            onAdviceMetrics={handleAdviceMetrics}
            onTalkToEngineer={(topic) => openEnquire(null, { topic })}
          />
        );

      default:
        return (
          <Landing
            onFiles={handleFiles}
            onCheckQuote={() => navigate('quote')}
            howRef={howRef}
          />
        );
    }
  }

  const enquiry = (
    <EnquiryModal
      open={enquiryOpen}
      onClose={() => setEnquiryOpen(false)}
      context={enquiryContext}
      onPrivacy={() => {
        setEnquiryOpen(false);
        setStage(STAGE.PRIVACY);
      }}
    />
  );

  // The upload and location steps are deliberately chrome-free: they're a
  // focused task, and a nav bar invites people to wander off mid-flow.
  if (!CHROME_STAGES.has(stage)) {
    return (
      <>
        {body}
        {enquiry}
      </>
    );
  }

  const activeNav =
    {
      [STAGE.ABOUT]: 'about',
      [STAGE.PRIVACY]: 'privacy',
      [STAGE.QUOTE]: 'quote',
      [STAGE.ENQUIRE]: 'enquire',
    }[stage] ?? null;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteHeader onNavigate={navigate} onUpload={startOver} active={activeNav} />
      <main className="flex-1">{body}</main>
      <SiteFooter onNavigate={navigate} />
      {enquiry}
    </div>
  );
}
