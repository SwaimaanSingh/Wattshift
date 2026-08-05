import { useState } from 'react';
import { CRITICAL_FIELDS, FIELD_LABELS } from '../services/confidence.js';
import { DEFAULTS } from '../config/defaults.js';

/**
 * Last resort, shown only when regex and AI both fall short.
 *
 * Anything that *was* extracted is pre-filled and left editable, so the
 * customer only fills the genuine gaps. Framed as a quick check rather than a
 * failure.
 */
export default function FallbackForm({ billData, onSubmit, onRetry }) {
  const [values, setValues] = useState(() => ({
    totalKwh: billData?.totalKwh ?? '',
    billingDays: billData?.billingDays ?? '',
    tariffRateCentsPerKwh: billData?.tariffRateCentsPerKwh ?? '',
    postcode: billData?.postcode ?? '',
    dailySupplyChargeCents: billData?.dailySupplyChargeCents ?? '',
  }));
  const [errors, setErrors] = useState({});

  const found = (field) => billData?.[field] != null;

  const set = (field) => (e) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const next = {};

    const kwh = Number(values.totalKwh);
    if (!(kwh > 0)) next.totalKwh = 'Enter the total kWh from your bill.';

    const days = Number(values.billingDays);
    if (!(days > 0 && days <= 400)) next.billingDays = 'Enter the number of days (e.g. 91).';

    const rate = Number(values.tariffRateCentsPerKwh);
    if (!(rate >= 3 && rate <= 200)) {
      next.tariffRateCentsPerKwh = 'Enter the rate in cents, e.g. 39.5';
    }

    if (!/^\d{4}$/.test(String(values.postcode).trim())) {
      next.postcode = 'Enter a 4-digit postcode.';
    }

    const supply = values.dailySupplyChargeCents === '' ? null : Number(values.dailySupplyChargeCents);
    if (supply != null && !(supply >= 10 && supply <= 1500)) {
      next.dailySupplyChargeCents = 'Enter the daily charge in cents, e.g. 98.5';
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onSubmit({
      ...billData,
      totalKwh: kwh,
      billingDays: days,
      dailyAverageKwh: kwh / days,
      tariffRateCentsPerKwh: rate,
      dailySupplyChargeCents: supply ?? DEFAULTS.defaultSupplyChargeCents,
      postcode: String(values.postcode).trim(),
      confidence: 'medium',
      enteredManually: true,
    });
  };

  const missingCritical = CRITICAL_FIELDS.filter((f) => !found(f));

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-8">
      <h1 className="text-2xl font-bold tracking-tight">
        Almost there — just a few numbers
      </h1>
      <p className="mt-2 text-ink-600 dark:text-ink-300">
        {missingCritical.length === 0
          ? "We read most of your bill. Have a quick look and confirm these."
          : `Your bill is laid out in a way we couldn't fully read. Everything we did find is filled in below — you only need the ${missingCritical.length === 1 ? 'one highlighted' : 'highlighted'} field${missingCritical.length === 1 ? '' : 's'}.`}
      </p>

      <WhyThisHappened billData={billData} />

      <BillDiagram />

      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        <Field
          id="totalKwh"
          label="Total electricity used"
          hint="The big kWh number for the whole billing period"
          suffix="kWh"
          value={values.totalKwh}
          onChange={set('totalKwh')}
          error={errors.totalKwh}
          prefilled={found('totalKwh')}
          inputMode="decimal"
        />

        <Field
          id="billingDays"
          label="Days in the billing period"
          hint="Usually 30, 31, 62 or 91"
          suffix="days"
          value={values.billingDays}
          onChange={set('billingDays')}
          error={errors.billingDays}
          prefilled={found('billingDays')}
          inputMode="numeric"
        />

        <Field
          id="tariffRateCentsPerKwh"
          label="Rate per kWh"
          hint='Shown as "c/kWh" or as dollars like $0.39 — enter 39 either way'
          suffix="cents"
          value={values.tariffRateCentsPerKwh}
          onChange={set('tariffRateCentsPerKwh')}
          error={errors.tariffRateCentsPerKwh}
          prefilled={found('tariffRateCentsPerKwh')}
          inputMode="decimal"
        />

        <Field
          id="postcode"
          label="Postcode"
          hint="Where the power is used — not your postal address"
          value={values.postcode}
          onChange={set('postcode')}
          error={errors.postcode}
          prefilled={found('postcode')}
          inputMode="numeric"
          maxLength={4}
        />

        <Field
          id="dailySupplyChargeCents"
          label="Daily supply charge"
          hint={`Optional — we'll assume ${DEFAULTS.defaultSupplyChargeCents}c/day if you skip it`}
          suffix="cents/day"
          value={values.dailySupplyChargeCents}
          onChange={set('dailySupplyChargeCents')}
          error={errors.dailySupplyChargeCents}
          prefilled={found('dailySupplyChargeCents')}
          inputMode="decimal"
          optional
        />

        <div className="flex flex-col gap-3 pt-2 sm:flex-row-reverse">
          <button type="submit" className="btn-primary flex-1">
            See my estimate
          </button>
          <button type="button" onClick={onRetry} className="btn-secondary flex-1">
            Try another bill
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  suffix,
  error,
  prefilled,
  optional,
  ...inputProps
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {prefilled && (
          <span className="ml-2 rounded bg-solar-100 px-1.5 py-0.5 text-sm sm:text-xs font-medium text-solar-800 dark:bg-solar-900/50 dark:text-solar-300">
            found on your bill
          </span>
        )}
        {optional && !prefilled && (
          <span className="ml-2 text-sm sm:text-xs font-normal text-ink-400">optional</span>
        )}
      </label>

      <div className="relative">
        <input
          id={id}
          type="text"
          className={`field ${suffix ? 'pr-20' : ''} ${
            error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/25' : ''
          }`}
          aria-describedby={`${id}-hint`}
          aria-invalid={Boolean(error)}
          {...inputProps}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-ink-400">
            {suffix}
          </span>
        )}
      </div>

      <p
        id={`${id}-hint`}
        className={`mt-1.5 text-sm sm:text-xs ${
          error ? 'text-red-600 dark:text-red-400' : 'text-ink-500 dark:text-ink-400'
        }`}
      >
        {error || hint}
      </p>
    </div>
  );
}

/**
 * Say plainly why extraction fell short.
 *
 * Landing here used to be a dead end for diagnosis — "it didn't work" with no
 * way to tell a hard read failure from a bill whose layout we don't know yet.
 */
function WhyThisHappened({ billData }) {
  const diagnostics = billData?.diagnostics ?? {};
  const hardError = diagnostics.error;
  const retailer = diagnostics.retailerName;
  const source = diagnostics.textSource;
  const chars = diagnostics.textLength;

  let reason;
  if (hardError) {
    reason = `We couldn't read the file at all: ${hardError}`;
  } else if (source === 'ocr') {
    reason =
      "This bill is a scan rather than a digital PDF, so we read it with text recognition — and some figures didn't come through cleanly.";
  } else if (retailer) {
    reason = `We recognised this as a ${retailer} bill and read the text, but couldn't find every figure we need.`;
  } else {
    reason =
      "We read the text but couldn't tell which retailer this is, so we didn't know where to look for the figures.";
  }

  return (
    <details className="mt-4 rounded-xl border border-ink-200 dark:border-ink-800">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Why couldn't it read my bill?
      </summary>
      <div className="border-t border-ink-200 px-4 py-3 dark:border-ink-800">
        <p className="text-sm text-ink-600 dark:text-ink-300">{reason}</p>
        <p className="tech mt-2">
          source: {source ?? 'unknown'}
          {retailer ? ` · retailer: ${retailer}` : ' · retailer: not detected'}
          {chars != null ? ` · ${chars} characters read` : ''}
          {diagnostics.usageSource ? ` · usage: ${diagnostics.usageSource}` : ''}
          {diagnostics.tariffSource ? ` · tariff: ${diagnostics.tariffSource}` : ''}
          {billData?.missingFields?.length
            ? ` · missing: ${billData.missingFields.join(', ')}`
            : ''}
        </p>
      </div>
    </details>
  );
}

/** Simple diagram pointing at where the numbers live on a typical AU bill. */
function BillDiagram() {
  return (
    <figure className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
      <svg viewBox="0 0 320 208" className="w-full" role="img" aria-labelledby="diagram-title">
        <title id="diagram-title">
          Where to find these numbers on a typical Australian electricity bill
        </title>

        <rect x="8" y="8" width="180" height="192" rx="6" className="fill-ink-50 dark:fill-ink-800" />
        <rect x="20" y="20" width="70" height="8" rx="3" className="fill-ink-300 dark:fill-ink-600" />
        <rect x="20" y="34" width="46" height="6" rx="3" className="fill-ink-200 dark:fill-ink-700" />

        {/* billing period */}
        <rect x="20" y="56" width="120" height="10" rx="3" className="fill-solar-200 dark:fill-solar-800" />
        <line x1="140" y1="61" x2="196" y2="61" className="stroke-solar-500" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x="200" y="64" className="fill-ink-600 dark:fill-ink-300" fontSize="9">
          days in period
        </text>

        {/* usage table */}
        <rect x="20" y="86" width="156" height="1" className="fill-ink-300 dark:fill-ink-600" />
        <rect x="20" y="94" width="52" height="7" rx="2" className="fill-ink-300 dark:fill-ink-600" />
        <rect x="96" y="94" width="34" height="7" rx="2" className="fill-solar-300 dark:fill-solar-700" />
        <rect x="142" y="94" width="34" height="7" rx="2" className="fill-solar-200 dark:fill-solar-800" />

        <rect x="20" y="108" width="52" height="7" rx="2" className="fill-ink-200 dark:fill-ink-700" />
        <rect x="96" y="108" width="34" height="7" rx="2" className="fill-ink-200 dark:fill-ink-700" />
        <rect x="142" y="108" width="34" height="7" rx="2" className="fill-ink-200 dark:fill-ink-700" />

        <line x1="130" y1="97" x2="196" y2="112" className="stroke-solar-500" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x="200" y="115" className="fill-ink-600 dark:fill-ink-300" fontSize="9">
          kWh used
        </text>

        <line x1="176" y1="97" x2="196" y2="88" className="stroke-solar-500" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x="200" y="90" className="fill-ink-600 dark:fill-ink-300" fontSize="9">
          rate c/kWh
        </text>

        {/* address block */}
        <rect x="20" y="150" width="86" height="6" rx="3" className="fill-ink-200 dark:fill-ink-700" />
        <rect x="20" y="162" width="64" height="6" rx="3" className="fill-solar-200 dark:fill-solar-800" />
        <line x1="84" y1="165" x2="196" y2="165" className="stroke-solar-500" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x="200" y="168" className="fill-ink-600 dark:fill-ink-300" fontSize="9">
          supply postcode
        </text>
      </svg>
      <figcaption className="border-t border-ink-200 px-4 py-2 text-sm sm:text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
        Roughly where each number sits on most Australian bills.
      </figcaption>
    </figure>
  );
}
