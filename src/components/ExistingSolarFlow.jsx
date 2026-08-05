import { DEFAULTS, getDefaultFiT } from '../config/defaults.js';
import { currency0, kwh, number, percent } from '../utils/formatters.js';

/**
 * Case A — size unknown: can't reconstruct true load.
 *
 * With no system size there is nothing to model, so interval data is the only
 * way forward from here. That makes "Get a detailed analysis" the primary
 * action of this state rather than an aside, and it renders unconditionally —
 * previously it was gated on the Stage 2 handler being passed, which meant the
 * one useful next step could disappear and leave the state a dead end.
 */
export function ExistingSolarUnknownPrompt({ onStartStage2 }) {
  return (
    <>
      <section className="card animate-fade-up">
        <h2 className="text-base font-semibold">We need a bit more to continue</h2>
        <p className="mt-3 text-sm text-ink-700 dark:text-ink-200">
          We can&apos;t estimate your system&apos;s performance without knowing its
          size. Select your size above, or upload your interval meter data for a
          full analysis.
        </p>
      </section>

      <section
        className="card animate-fade-up border-solar-300 ring-1 ring-solar-500/30 dark:border-solar-700 dark:ring-solar-500/20"
        style={{ animationDelay: '60ms' }}
      >
        <button
          type="button"
          onClick={() => onStartStage2?.()}
          className="btn-primary w-full text-lg"
        >
          Get a detailed analysis
        </button>
        <p className="mt-3 text-center text-sm text-ink-600 dark:text-ink-300">
          Upload your interval data for a full breakdown of generation,
          self-consumption, and savings.
        </p>
      </section>
    </>
  );
}

/** Case B step 1 — reconstructed load from grid import + modelled self-use. */
export function TrueConsumptionCard({ estimate, billGridAnnual }) {
  const daily = estimate.dailyTrueConsumption;

  return (
    <section className="card animate-fade-up">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Your estimated true consumption</h2>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-semibold uppercase tracking-wide text-amber-900 sm:text-[11px] dark:bg-amber-900/30 dark:text-amber-200">
          Estimate
        </span>
      </div>

      <p className="mt-3 text-sm text-ink-700 dark:text-ink-200">
        Your bill shows {kwh(billGridAnnual)}/yr bought from the grid. Your
        existing {number(estimate.existingKw, 1)} kW system adds back an
        estimated {kwh(estimate.solarSelfConsumed)}/yr used on-site.
      </p>

      <p className="mt-4 text-ink-800 dark:text-ink-100">
        Total estimated consumption:{' '}
        <strong className="text-xl font-bold tabular-nums text-solar-700 dark:text-solar-400">
          {kwh(estimate.trueConsumption)}
        </strong>
        /yr{' '}
        <span className="text-sm text-ink-600 dark:text-ink-300">
          ({number(daily, 1)} kWh/day)
        </span>
      </p>

      <p className="mt-3 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        Based on modelled generation — upload interval data for measured
        figures.
      </p>
    </section>
  );
}

const INTENTS = [
  {
    id: 'perform',
    label: 'How is my current system performing?',
    description: 'Generation, self-consumption and estimated annual benefit',
  },
  {
    id: 'add',
    label: 'I want to add more solar',
    description: 'Size extra capacity on top of what you already have',
  },
  {
    id: 'replace',
    label: 'I want a full new system',
    description: 'Size a replacement against what you buy from the grid',
  },
];

/** Case B step 2 — pick what to explore next. */
export function ExistingSolarIntentPicker({ intent, onChange }) {
  return (
    <section className="card animate-fade-up">
      <h2 className="text-base font-semibold">What would you like to look at?</h2>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {INTENTS.map((item) => {
          const active = intent === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-pressed={active}
              className={`rounded-xl border px-4 py-3.5 text-left transition-colors ${
                active
                  ? 'border-solar-500 bg-solar-50 dark:border-solar-600 dark:bg-solar-900/20'
                  : 'border-ink-200 hover:border-solar-400 hover:bg-solar-50/50 dark:border-ink-700 dark:hover:border-solar-700 dark:hover:bg-solar-900/10'
              }`}
            >
              <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                {item.label}
              </p>
              <p className="mt-1 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
                {item.description}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Intent A — performance of the existing system against reconstructed load.
 */
export function ExistingSystemPerformance({ estimate, billData }) {
  const gen = estimate.modelledGeneration;
  const selfConsumed = estimate.solarSelfConsumed;
  const trueLoad = estimate.trueConsumption;
  // Share of generation used on site, from the self-consumption engine —
  // the same model behind the sizing flow's percentages.
  const selfPct = Math.round((estimate.selfConsumptionRate ?? 0) * 100);
  const coverPct =
    trueLoad > 0 ? Math.round((gen / trueLoad) * 100) : 0;

  const usageRateCPerKwh =
    billData.tariffRateCentsPerKwh ?? DEFAULTS.defaultTariffCents;
  const feedInTariffCPerKwh =
    billData.feedInTariffCents ?? getDefaultFiT(billData.retailer);

  const annualBenefit = Math.round(
    (selfConsumed * usageRateCPerKwh) / 100 +
      (estimate.annualExport * feedInTariffCPerKwh) / 100
  );

  return (
    <section className="card animate-fade-up">
      <h2 className="text-base font-semibold">How your system is performing</h2>
      <p className="mt-2 text-sm text-ink-700 dark:text-ink-200">
        Your {number(estimate.existingKw, 1)} kW system is modelled to generate
        about {kwh(gen)}/yr — roughly {percent(coverPct)} of your estimated true
        consumption.
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Metric label="Modelled generation" value={kwh(gen)} hint="per year" />
        <Metric
          label="Est. self-consumption"
          value={percent(selfPct)}
          hint={`${kwh(selfConsumed)} on site`}
        />
        <Metric
          label="Est. annual benefit"
          value={currency0(annualBenefit)}
          hint="self-use + export credits"
        />
      </dl>

      <p className="mt-4 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        For measured performance, upload your interval data.
      </p>
    </section>
  );
}

/** Note shown on the add-more path (intent B). */
export function TrueConsumptionSizingNote() {
  return (
    <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-sm sm:text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">
      Sized against your estimated true consumption, which includes solar your
      meter doesn&apos;t record.
    </p>
  );
}

/**
 * Note shown on the full-replacement path (intent C).
 *
 * Replacing the array means its generation no longer offsets anything, so the
 * new system is sized against what the bill actually shows being bought.
 */
export function GridImportSizingNote() {
  return (
    <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-sm sm:text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">
      Sized against the electricity your bill shows you buying from the grid.
      Your existing system is being replaced, so its generation isn&apos;t part
      of this figure — changing the size above won&apos;t move it.
    </p>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div>
      <dt className="text-sm sm:text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-xl font-bold tnum">{value}</dd>
      {hint && <p className="tech mt-0.5">{hint}</p>}
    </div>
  );
}
