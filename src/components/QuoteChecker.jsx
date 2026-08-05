import { useMemo, useState } from 'react';
import { AU_STATES, QUOTE_PRICING_2026 } from '../config/defaults.js';
import { assessQuote, quotePosition } from '../services/quoteAssessor.js';
import { currency0, number } from '../utils/formatters.js';

const NEEDS = [
  { value: '', label: 'Choose…' },
  { value: 'new-solar', label: 'Quotes for a new solar system' },
  { value: 'solar-battery', label: 'Quotes for solar + battery' },
  { value: 'battery-only', label: 'Battery added to existing solar' },
  { value: 'second-opinion', label: "A second opinion on a quote I've received" },
];

/** Standalone tool for sanity-checking an installer's price. */
export default function QuoteChecker({ onGetQuotes }) {
  const [form, setForm] = useState({
    systemKw: '',
    quotedPrice: '',
    hasBattery: false,
    batteryKwh: '',
    batteryIncluded: true,
    state: 'SA',
    quotedSavings: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const assessment = useMemo(() => {
    if (!submitted) return null;
    return assessQuote({
      systemKw: Number(form.systemKw),
      quotedPrice: Number(form.quotedPrice),
      batteryKwh: form.hasBattery ? Number(form.batteryKwh) || 0 : 0,
      batteryIncluded: form.hasBattery && form.batteryIncluded,
      state: form.state,
    });
  }, [submitted, form]);

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    const kw = Number(form.systemKw);
    const price = Number(form.quotedPrice);
    if (!(kw > 0 && kw <= 5000)) next.systemKw = 'Enter the system size in kW.';
    if (!(price > 0)) next.quotedPrice = 'Enter the total price you were quoted.';
    if (form.hasBattery && !(Number(form.batteryKwh) > 0)) {
      next.batteryKwh = 'Enter the battery size in kWh.';
    }
    setErrors(next);
    setSubmitted(Object.keys(next).length === 0);
  };

  return (
    <div className="mx-auto max-w-2xl px-5 py-12 md:px-8">
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
        Check if your quote is fair
      </h1>
      <p className="mt-3 text-ink-600 dark:text-ink-300">
        Enter what you were quoted and we'll compare it against 2026 Australian
        market rates. Nothing is sent anywhere — this runs in your browser.
      </p>

      <form onSubmit={submit} className="card mt-8 space-y-5" noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="q-kw"
            label="System size"
            suffix="kW"
            value={form.systemKw}
            onChange={set('systemKw')}
            error={errors.systemKw}
            inputMode="decimal"
            placeholder="6.6"
          />
          <Field
            id="q-price"
            label="Total price quoted"
            hint="After rebates"
            prefix="$"
            value={form.quotedPrice}
            onChange={set('quotedPrice')}
            error={errors.quotedPrice}
            inputMode="numeric"
            placeholder="7,500"
          />
        </div>

        <div className="rounded-xl border border-ink-200 p-4 dark:border-ink-800">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 sm:min-h-0">
            <input
              type="checkbox"
              checked={form.hasBattery}
              onChange={set('hasBattery')}
              className="h-5 w-5 shrink-0 accent-solar-600 sm:h-4 sm:w-4"
            />
            <span className="text-sm font-medium">Battery included in this quote?</span>
          </label>

          {form.hasBattery && (
            <div className="mt-4 space-y-4">
              <Field
                id="q-batt"
                label="Battery size"
                suffix="kWh"
                value={form.batteryKwh}
                onChange={set('batteryKwh')}
                error={errors.batteryKwh}
                inputMode="decimal"
                placeholder="10"
              />
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 sm:min-h-0">
                <input
                  type="checkbox"
                  checked={form.batteryIncluded}
                  onChange={set('batteryIncluded')}
                  className="h-5 w-5 shrink-0 accent-solar-600 sm:h-4 sm:w-4"
                />
                <span className="text-sm">
                  The battery price is part of the total above
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="q-state" className="label">
              Your state
            </label>
            <select id="q-state" value={form.state} onChange={set('state')} className="field">
              {AU_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <Field
            id="q-savings"
            label="Quoted annual savings"
            hint="Optional"
            prefix="$"
            value={form.quotedSavings}
            onChange={set('quotedSavings')}
            inputMode="numeric"
            placeholder="1,500"
          />
        </div>

        <button type="submit" className="btn-primary w-full">
          Check this quote
        </button>
      </form>

      {assessment && (
        <Assessment
          assessment={assessment}
          form={form}
          onGetQuotes={onGetQuotes}
        />
      )}

      <HowWeCalculate />
    </div>
  );
}

function Assessment({ assessment, form, onGetQuotes }) {
  const position = quotePosition(assessment) * 100;
  const tone = {
    suspiciously_low: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20',
    good_deal: 'border-solar-300 bg-solar-50 dark:border-solar-800 dark:bg-solar-900/20',
    fair: 'border-solar-300 bg-solar-50 dark:border-solar-800 dark:bg-solar-900/20',
    above_average: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20',
    overpriced: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20',
  }[assessment.verdict];

  return (
    <section className={`mt-6 rounded-2xl border p-5 ${tone}`} aria-live="polite">
      <h2 className="text-lg font-bold">{assessment.headline}</h2>

      {/* Price range bar */}
      <div className="mt-5">
        <div className="relative h-3 overflow-hidden rounded-full">
          <div className="absolute inset-0 flex">
            <div className="w-[22%] bg-amber-300" title="Suspiciously low" />
            <div className="w-[30%] bg-solar-400" title="Competitive" />
            <div className="w-[26%] bg-solar-500" title="Normal range" />
            <div className="w-[14%] bg-amber-400" title="Above average" />
            <div className="w-[8%] bg-red-400" title="Overpriced" />
          </div>
        </div>

        <div className="relative mt-1 h-9">
          <div
            className="absolute -translate-x-1/2 text-center"
            style={{ left: `${Math.min(94, Math.max(6, position))}%` }}
          >
            <div className="text-base leading-none" aria-hidden="true">▲</div>
            <div className="whitespace-nowrap text-sm sm:text-xs font-semibold">
              Your quote: {currency0(assessment.quotedPrice)}
            </div>
          </div>
        </div>

        <div className="mt-1 flex justify-between text-sm sm:text-xs text-ink-500 dark:text-ink-400">
          <span>Budget</span>
          <span>Premium</span>
        </div>
      </div>

      <p className="mt-4 text-sm text-ink-700 dark:text-ink-200">
        For a {number(Number(form.systemKw), 1)} kW system
        {form.hasBattery && form.batteryIncluded
          ? ` with a ${number(Number(form.batteryKwh), 1)} kWh battery`
          : ''}{' '}
        in {form.state}, most people pay between{' '}
        <strong className="font-semibold">{currency0(assessment.range.low)}</strong> and{' '}
        <strong className="font-semibold">{currency0(assessment.range.high)}</strong> after
        rebates. Yours works out at{' '}
        <strong className="font-semibold">{currency0(assessment.perKwQuoted)}/kW</strong>.
      </p>

      {assessment.batteryRebate > 0 && (
        <p className="mt-2 text-sm sm:text-xs text-ink-600 dark:text-ink-300">
          Includes an estimated {currency0(assessment.batteryRebate)} federal battery
          rebate on {number(Number(form.batteryKwh), 1)} kWh.
        </p>
      )}

      <p className="mt-3 text-sm text-ink-700 dark:text-ink-200">{assessment.message}</p>

      {form.quotedSavings && Number(form.quotedSavings) > 0 && (
        <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm sm:text-xs text-ink-600 dark:bg-ink-900/50 dark:text-ink-300">
          They quoted {currency0(Number(form.quotedSavings))}/year in savings. Upload
          your actual bill and we'll model that independently from your real usage
          and tariff.
        </p>
      )}

      {(assessment.verdict === 'overpriced' || assessment.verdict === 'above_average') && (
        <button type="button" onClick={onGetQuotes} className="btn-primary mt-5 w-full">
          Get competitive quotes through WattShift
        </button>
      )}

      <p className="mt-4 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        Prices are based on 2026 national averages. Regional variations, roof
        complexity, and equipment choices all affect the final cost.
      </p>
    </section>
  );
}

function HowWeCalculate() {
  const { solar, battery, lastUpdated, source } = QUOTE_PRICING_2026;
  return (
    <details className="mt-6 rounded-xl border border-ink-200 dark:border-ink-800">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        How we calculate this
      </summary>
      <div className="border-t border-ink-200 px-4 py-3 text-sm text-ink-600 dark:border-ink-800 dark:text-ink-300">
        <p>
          Solar: ${solar.budget.min}–${solar.premium.max} per kW installed, after STC
          rebates — roughly $0.65–$1.50 per watt. Batteries: ${battery.perKwh.min}–$
          {battery.perKwh.max} per kWh installed, with a federal rebate of about $
          {battery.federalRebatePerKwh} per kWh applied where eligible.
        </p>
        <p className="tech mt-2">
          Source: {source}. Last updated {lastUpdated}.
        </p>
      </div>
    </details>
  );
}

function Field({ id, label, hint, prefix, suffix, error, ...inputProps }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {hint && <span className="ml-2 text-sm sm:text-xs font-normal text-ink-400">{hint}</span>}
      </label>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-ink-400">
            {prefix}
          </span>
        )}
        <input
          id={id}
          type="text"
          className={`field ${prefix ? 'pl-8' : ''} ${suffix ? 'pr-16' : ''} ${
            error ? 'border-red-500' : ''
          }`}
          aria-invalid={Boolean(error)}
          {...inputProps}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-ink-400">
            {suffix}
          </span>
        )}
      </div>
      {error && <p className="mt-1.5 text-sm sm:text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export { NEEDS };
