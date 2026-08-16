import { useRef, useState } from 'react';
import IntervalDataHelpModal from './IntervalDataHelpModal.jsx';
import Nem12Upload from './Nem12Upload.jsx';
import { kw, number } from '../../utils/formatters.js';

/**
 * How to get meter data, by state.
 *
 * The single biggest reason people abandon this step is not knowing where to
 * look, so each entry names the actual portal and the actual download option
 * rather than saying "contact your distributor".
 */
const METER_DATA_SOURCES = {
  SA: {
    label: 'South Australia',
    distributors: 'SA Power Networks',
    steps: [
      'Go to sapowernetworks.com.au and find "Your Meter Data".',
      'Register with your NMI — the 10 or 11-digit number on your electricity bill.',
      'Once approved, download the "Detailed" report as a CSV.',
    ],
  },
  NSW: {
    label: 'New South Wales',
    distributors: 'Ausgrid, Endeavour Energy or Essential Energy',
    steps: [
      'Find which distributor covers you — it is printed on your bill.',
      'Each runs a "My Energy" or energy data portal you can register for.',
      'Request the detailed interval data export, in NEM12 or CSV format.',
    ],
  },
  VIC: {
    label: 'Victoria',
    distributors: 'CitiPower, Powercor, AusNet, Jemena or United Energy',
    steps: [
      'Check your bill for your distributor, then open their customer portal.',
      'Victorian distributors provide interval data free under the state scheme.',
      'Download the detailed or NEM12 export as a CSV.',
    ],
  },
  QLD: {
    label: 'Queensland',
    distributors: 'Energex or Ergon Energy',
    steps: [
      'Energex covers the south-east; Ergon covers the rest of the state.',
      'Register on their metering data portal using your NMI.',
      'Request the detailed interval data download.',
    ],
  },
  WA: {
    label: 'Western Australia',
    distributors: 'Western Power or Horizon Power',
    steps: [
      'Synergy customers can request interval data through their online account.',
      'Western Power also supplies it directly on request with your meter number.',
      'Ask specifically for interval or NEM12 data, not a usage summary.',
    ],
  },
  TAS: {
    label: 'Tasmania',
    distributors: 'TasNetworks',
    steps: [
      'Request your interval data from TasNetworks or through Aurora Energy.',
      'You will need your NMI from your bill.',
      'Ask for the detailed interval data export.',
    ],
  },
  ACT: {
    label: 'Australian Capital Territory',
    distributors: 'Evoenergy',
    steps: [
      'Register on the Evoenergy customer portal with your NMI.',
      'Request your interval meter data.',
      'Download it as a CSV.',
    ],
  },
  NT: {
    label: 'Northern Territory',
    distributors: 'Power and Water Corporation',
    steps: [
      'Contact Power and Water or Jacana Energy to request interval data.',
      'Have your NMI and account number ready.',
      'Not every NT meter is a smart meter — ask whether yours records intervals.',
    ],
  },
};

/**
 * The fork at the top of Stage 2.
 *
 * Uploading meter data is genuinely better and is presented as the recommended
 * path, but it takes effort and a portal registration — so the alternative is
 * offered plainly rather than buried, and it says exactly what is lost.
 */
export default function Stage2Landing({
  stage1,
  state = 'SA',
  retailer = null,
  onProceed,
  onBack,
}) {
  const [parsed, setParsed] = useState(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showRetailerHelp, setShowRetailerHelp] = useState(false);
  const [manualSolarKw, setManualSolarKw] = useState('');
  const [manualBatteryKwh, setManualBatteryKwh] = useState('');
  const uploadRef = useRef(null);

  const source = METER_DATA_SOURCES[state] ?? METER_DATA_SOURCES.SA;

  const manualInputs = {
    solarKw: manualSolarKw === '' ? null : Number(manualSolarKw),
    batteryKwh: manualBatteryKwh === '' ? null : Number(manualBatteryKwh),
  };

  const proceed = (payload) => {
    const hasBattery = (manualInputs.batteryKwh ?? 0) > 0;
    console.log('[Stage2Landing] proceed battery handoff', {
      hasBattery,
      batteryKwh: manualInputs.batteryKwh,
      solarKw: manualInputs.solarKw,
      mode: payload?.mode,
    });
    onProceed({
      ...payload,
      manualSolarKw: manualInputs.solarKw,
      manualBatteryKwh: manualInputs.batteryKwh,
    });
  };

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-8 md:max-w-3xl md:px-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[44px] items-center text-sm text-ink-500 underline underline-offset-4 hover:text-ink-800 sm:min-h-0 dark:text-ink-400 dark:hover:text-ink-200"
      >
        ← Back to your estimate
      </button>

      <header className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Get a detailed analysis
        </h1>
        <p className="mt-2 text-ink-600 dark:text-ink-300">
          Your Stage 1 estimate used your bill totals. This step models your
          system half hour by half hour, prices it, and produces a report you
          can hand to an installer.
        </p>
      </header>

      {stage1 && <CarriedForward stage1={stage1} />}

      <section className="card mt-6 animate-fade-up">
        <h2 className="text-base font-semibold">Your system (optional)</h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
          If you already have solar or a battery, enter the sizes here. We'll
          assess how your system is performing rather than sizing a new one.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ManualNumberField
            id="landing-solar-kw"
            label="Solar system size (kW)"
            suffix="kW"
            placeholder="e.g. 6.6"
            value={manualSolarKw}
            onChange={setManualSolarKw}
          />
          <ManualNumberField
            id="landing-battery-kwh"
            label="Battery size (kWh)"
            suffix="kWh"
            placeholder="e.g. 13.5"
            value={manualBatteryKwh}
            onChange={setManualBatteryKwh}
          />
        </div>
      </section>

      {/* Path A */}
      <section className="card mt-6 animate-fade-up">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Upload your smart meter data</h2>
          <span className="rounded-full bg-solar-100 px-2.5 py-0.5 text-sm sm:text-xs font-semibold text-solar-800 dark:bg-solar-900/50 dark:text-solar-200">
            Recommended
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
          Your smart meter records exactly when you use electricity — every 30
          minutes, all day. This lets us model precisely how much solar you'd
          use directly versus export to the grid.
        </p>

        <div className="mt-4">
          <Nem12Upload ref={uploadRef} onParsed={(result) => setParsed(result)} />
        </div>

        {/* The retailer route. The distributor route, by state, stays in the
            disclosure below — they are genuinely different sources, and most
            people try the retailer they already have a login with first. */}
        <button
          type="button"
          onClick={() => setShowRetailerHelp(true)}
          className="btn-secondary mt-3 w-full"
        >
          How to download your interval data
        </button>

        {parsed && (
          <button
            type="button"
            onClick={() => proceed({ mode: 'interval', meterData: parsed })}
            className="btn-primary mt-4 w-full"
          >
            Analyse my usage
          </button>
        )}

        <div className="mt-5 border-t border-ink-200 pt-4 dark:border-ink-800">
          <button
            type="button"
            onClick={() => setShowInstructions((open) => !open)}
            aria-expanded={showInstructions}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left sm:min-h-0"
          >
            <span className="text-sm font-semibold">How to get your meter data</span>
            <svg
              className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${showInstructions ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {showInstructions && (
            <div className="mt-3 animate-fade-in">
              <p className="text-sm font-medium text-ink-700 dark:text-ink-200">
                {source.label} — {source.distributors}
              </p>
              <ol className="mt-2 space-y-1.5">
                {source.steps.map((step, i) => (
                  <li key={step} className="flex gap-2.5 text-sm text-ink-600 dark:text-ink-300">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-sm sm:text-xs font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              <p className="mt-3 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
                It's free, and most portals send the file within minutes. Ask
                for the <strong>Detailed</strong> or <strong>NEM12</strong>{' '}
                format — a monthly summary won't work.
              </p>

              <details className="mt-3">
                <summary className="cursor-pointer text-sm sm:text-xs font-medium text-ink-500 underline underline-offset-4 dark:text-ink-400">
                  I'm in a different state
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {Object.entries(METER_DATA_SOURCES)
                    .filter(([key]) => key !== state)
                    .map(([key, entry]) => (
                      <li key={key} className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">
                        <strong className="text-ink-600 dark:text-ink-300">{entry.label}:</strong>{' '}
                        {entry.distributors}
                      </li>
                    ))}
                </ul>
              </details>
            </div>
          )}
        </div>

        <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-sm sm:text-xs text-ink-500 dark:bg-ink-800/50 dark:text-ink-400">
          Your meter data is read in your browser and never uploaded. It shows
          when your home is empty, so we'd rather not have it.
        </p>
      </section>

      {/* Path B */}
      <section className="card mt-4 animate-fade-up" style={{ animationDelay: '80ms' }}>
        <h2 className="text-base font-semibold">Continue with bill data only</h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
          We'll use your bill totals with industry-standard assumptions. You'll
          still get cost estimates and a downloadable report, but
          self-consumption figures will be estimated rather than calculated from
          your actual usage pattern.
        </p>

        <ul className="mt-3 space-y-1.5">
          <Availability available>Cost estimates, rebates and payback</Availability>
          <Availability available>Full PDF report</Availability>
          <Availability available>Monthly energy balance from your bills</Availability>
          <Availability>Your actual daily usage curve</Availability>
          <Availability>Usage heatmap and day-by-day browsing</Availability>
          <Availability>Precise self-consumption and battery modelling</Availability>
        </ul>

        <button
          type="button"
          onClick={() => proceed({ mode: 'bill' })}
          className="btn-secondary mt-4 w-full"
        >
          Continue with bill data
        </button>
      </section>

      <IntervalDataHelpModal
        open={showRetailerHelp}
        onClose={() => setShowRetailerHelp(false)}
        detectedRetailer={retailer}
        onHaveFile={() => {
          setShowRetailerHelp(false);
          // Deferred so the modal has unmounted and released the body scroll
          // lock before the picker opens. A timer rather than
          // requestAnimationFrame: rAF stops firing whenever the tab is not
          // compositing, which would strand the customer on a closed modal
          // with no file dialog — the same trap as BILL_FORMATS.md #10a.
          setTimeout(() => uploadRef.current?.openFilePicker(), 0);
        }}
      />
    </div>
  );
}

function Availability({ available = false, children }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {available ? (
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-solar-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
        </svg>
      ) : (
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-ink-300 dark:text-ink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      )}
      <span className={available ? 'text-ink-700 dark:text-ink-200' : 'text-ink-400 dark:text-ink-500'}>
        {children}
      </span>
    </li>
  );
}

function CarriedForward({ stage1 }) {
  const items = [
    stage1.solarData?.name && `${stage1.solarData.name} (${stage1.solarData.postcode})`,
    stage1.sizing?.dailyConsumption &&
      `${number(stage1.sizing.dailyConsumption, 1)} kWh/day`,
    stage1.systemKw && `${kw(stage1.systemKw)} system`,
    stage1.batteryKwh > 0 && `${number(stage1.batteryKwh, 1)} kWh battery`,
  ].filter(Boolean);

  if (items.length === 0) return null;

  return (
    <div className="mt-5 rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-3 dark:border-ink-800 dark:bg-ink-900/40">
      <p className="text-sm sm:text-xs font-medium text-ink-500 dark:text-ink-400">
        Carried over from your estimate
      </p>
      <p className="mt-1 text-sm text-ink-700 dark:text-ink-200">{items.join(' · ')}</p>
    </div>
  );
}

function ManualNumberField({ id, label, suffix, placeholder, value, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field pr-12"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm sm:text-xs text-ink-400 dark:text-ink-500">
          {suffix}
        </span>
      </div>
    </div>
  );
}
