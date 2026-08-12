import { useState } from 'react';
import { currency0, number } from '../utils/formatters.js';
import { downloadSummaryPdf } from '../services/summaryPdf.js';

/** Replace with your Formspree form URL after creating the form. */
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/myegwvrw';

const TOPICS = [
  'Understanding my solar estimate',
  'Getting quotes from local installers',
  'Reviewing a quote I\'ve received',
  'Assessing my existing system\'s performance',
  'Something else',
];

/** The option covering an existing-system review, found by meaning not index. */
const EXISTING_SYSTEM_TOPIC = TOPICS.find((t) => /existing system/i.test(t)) ?? '';

/**
 * Wording used by callers that does not match an option verbatim. Stage 2 asks
 * for a "performance review of my existing system", which is what the option
 * above already means.
 */
const TOPIC_ALIASES = {
  'performance review of my existing system': EXISTING_SYSTEM_TOPIC,
};

/**
 * Topic pre-fill from `?topic=`.
 *
 * This is a radio group over a fixed list, so a value outside it would select
 * nothing while still passing the "choose a topic" check — a pre-fill that
 * looks applied but leaves the form empty. Anything unrecognised is ignored so
 * the user simply picks for themselves.
 */
function topicFromUrl() {
  const raw = new URLSearchParams(window.location.search).get('topic');
  if (!raw) return '';

  const key = raw.trim().toLowerCase();
  return TOPICS.find((t) => t.toLowerCase() === key) ?? TOPIC_ALIASES[key] ?? '';
}

/**
 * Stage 3 — talk to a solar engineer.
 *
 * Separate from the installer quote modal: this is independent advice, not a
 * lead-gen handoff to CEC installers.
 */
export default function EnquirePage({ adviceContext, onBack }) {
  const postcodeDefault =
    adviceContext?.summary?.billData?.postcode ??
    adviceContext?.summary?.solarData?.postcode ??
    '';

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    postcode: String(postcodeDefault || ''),
    topic: topicFromUrl(),
    message: '',
  });
  const [errors, setErrors] = useState({});
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const estimateLines = buildEstimateLines(adviceContext);
  const hasEstimate = estimateLines.length > 0;
  const firstName = form.name.trim().split(/\s+/)[0] || 'there';

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = 'Please tell us your name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      next.email = 'Enter a valid email address.';
    }
    if (!/^\d{4}$/.test(String(form.postcode).trim())) {
      next.postcode = 'Enter a 4-digit postcode.';
    }
    if (!form.topic) next.topic = 'Choose what you need help with.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setState('sending');
    try {
      const estimateSummary = estimateLines
        .map(([label, value]) => `${label}: ${value}`)
        .join('\n');

      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          postcode: form.postcode.trim(),
          topic: form.topic,
          message: form.message.trim() || undefined,
          _subject: `WattShift advice enquiry — ${form.topic}`,
          estimateSummary: estimateSummary || undefined,
        }),
      });

      if (!res.ok) throw new Error(`Submission failed (${res.status})`);
      setState('done');
    } catch {
      setState('error');
    }
  };

  const downloadPdf = async () => {
    if (!adviceContext?.summary) return;
    setPdfBusy(true);
    try {
      await downloadSummaryPdf(adviceContext.summary, null);
    } catch {
      // PDF export is best-effort on the confirmation screen.
    } finally {
      setPdfBusy(false);
    }
  };

  if (state === 'done') {
    return (
      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-solar-50 to-white dark:from-solar-950/30 dark:to-ink-950"
        />
        <div className="relative mx-auto max-w-lg px-5 py-14 md:px-8">
          <section className="card text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-solar-100 dark:bg-solar-900/40">
              <svg
                className="h-9 w-9 text-solar-700 dark:text-solar-400"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight">
              Thanks {firstName} — we&apos;ll be in touch within one business day.
            </h1>
            <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">
              In the meantime, you can download your estimate PDF or share it with
              your household.
            </p>
            {adviceContext?.summary && (
              <button
                type="button"
                onClick={downloadPdf}
                disabled={pdfBusy}
                className="btn-primary mt-6 w-full"
              >
                {pdfBusy ? 'Building your summary…' : 'Download PDF summary'}
              </button>
            )}
            <button
              type="button"
              onClick={onBack}
              className="mt-4 inline-flex min-h-[44px] items-center text-sm font-medium text-solar-700 underline underline-offset-4 sm:min-h-0 dark:text-solar-400"
            >
              Back to your estimate
            </button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-solar-50 to-white dark:from-solar-950/30 dark:to-ink-950"
      />

      <div className="relative mx-auto max-w-lg px-5 py-10 md:px-8">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Talk to a solar engineer
        </h1>
        <p className="mt-2 text-ink-600 dark:text-ink-300">
          Independent advice on system design and quotes — no installer
          commissions. We&apos;ll reply within one business day.
        </p>

        <form onSubmit={submit} className="card mt-6 space-y-5" noValidate>
          <Field
            id="advise-name"
            label="Name"
            value={form.name}
            onChange={set('name')}
            error={errors.name}
            autoComplete="name"
          />
          <Field
            id="advise-email"
            label="Email"
            type="email"
            value={form.email}
            onChange={set('email')}
            error={errors.email}
            autoComplete="email"
          />
          <Field
            id="advise-phone"
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            optional
            autoComplete="tel"
          />
          <Field
            id="advise-postcode"
            label="Postcode"
            value={form.postcode}
            onChange={set('postcode')}
            error={errors.postcode}
            inputMode="numeric"
            maxLength={4}
            autoComplete="postal-code"
          />

          <fieldset>
            <legend className="label">What would you like help with?</legend>
            <div className="mt-1 space-y-2">
              {TOPICS.map((topic) => (
                <label
                  key={topic}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm transition-colors ${
                    form.topic === topic
                      ? 'border-solar-500 bg-solar-50/70 dark:border-solar-600 dark:bg-solar-900/20'
                      : 'border-ink-200 hover:border-ink-300 dark:border-ink-700 dark:hover:border-ink-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="topic"
                    value={topic}
                    checked={form.topic === topic}
                    onChange={set('topic')}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-solar-600 sm:h-4 sm:w-4"
                  />
                  <span className="text-ink-700 dark:text-ink-200">{topic}</span>
                </label>
              ))}
            </div>
            {errors.topic && (
              <p className="mt-1.5 text-sm sm:text-xs text-red-600 dark:text-red-400">{errors.topic}</p>
            )}
          </fieldset>

          <div>
            <label htmlFor="advise-message" className="label">
              Message{' '}
              <span className="text-sm sm:text-xs font-normal text-ink-400">optional</span>
            </label>
            <textarea
              id="advise-message"
              rows={4}
              value={form.message}
              onChange={set('message')}
              placeholder="Any extra context — your system size, specific questions, timeline..."
              className="field"
            />
          </div>

          {hasEstimate && (
            <div className="rounded-xl border border-ink-200 dark:border-ink-700">
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                aria-expanded={detailsOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                  Your estimate details
                </span>
                <span className="text-sm sm:text-xs font-medium text-solar-700 dark:text-solar-400">
                  {detailsOpen ? 'Hide details' : 'Show details'}
                </span>
              </button>
              {detailsOpen && (
                <dl className="space-y-1.5 border-t border-ink-200 px-4 py-3 text-sm dark:border-ink-700">
                  {estimateLines.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
                      <dd className="tnum text-right font-medium">{value}</dd>
                    </div>
                  ))}
                  <p className="pt-1 text-sm sm:text-xs text-ink-400 dark:text-ink-500">
                    Read-only — sent with your enquiry so we have the context.
                  </p>
                </dl>
              )}
            </div>
          )}

          {state === 'error' && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
              Something went wrong — please email us directly at{' '}
              <a
                href="mailto:hello@wattshift.com.au"
                className="font-semibold underline underline-offset-4"
              >
                hello@wattshift.com.au
              </a>
            </p>
          )}

          <button
            type="submit"
            disabled={state === 'sending'}
            className="btn-primary w-full"
          >
            {state === 'sending' ? 'Sending…' : 'Send my enquiry'}
          </button>
        </form>
      </div>
    </div>
  );
}

function buildEstimateLines(adviceContext) {
  if (!adviceContext) return [];
  const lines = [];
  const summary = adviceContext.summary;
  const stage2 = adviceContext.stage2;

  if (summary?.systemKw != null) {
    lines.push(['System size modelled', `${number(summary.systemKw, 1)} kW`]);
  }
  if (summary?.savings) {
    lines.push([
      'Annual savings estimate',
      `${currency0(summary.savings.annualSavingsLow)} – ${currency0(summary.savings.annualSavingsHigh)}/yr`,
    ]);
  }
  if (summary?.billData?.totalBillAmount != null) {
    lines.push(['Bill size', currency0(summary.billData.totalBillAmount)]);
  } else if (summary?.savings?.currentAnnualBill != null) {
    lines.push(['Bill size', `${currency0(summary.savings.currentAnnualBill)}/yr`]);
  }
  if (stage2?.totalDays) {
    lines.push([
      'NEM12 analysis',
      `${number(stage2.totalDays)} days analysed, ${percentLabel(stage2.selfConsumptionPercent)} self-consumption, ${percentLabel(stage2.gridDependencePercent)} grid dependence`,
    ]);
  }

  return lines;
}

function percentLabel(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${number(value, 0)}%`;
}

function Field({
  id,
  label,
  type = 'text',
  optional,
  error,
  ...props
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {optional && (
          <span className="ml-2 text-sm sm:text-xs font-normal text-ink-400">optional</span>
        )}
      </label>
      <input
        id={id}
        type={type}
        className={`field ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/25' : ''}`}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error && <p className="mt-1.5 text-sm sm:text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
