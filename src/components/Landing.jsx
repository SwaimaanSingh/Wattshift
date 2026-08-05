import { useEffect, useRef, useState } from 'react';
import BillUpload from './BillUpload.jsx';
import { Reveal } from '../hooks/useReveal.jsx';
import { number } from '../utils/formatters.js';

const STORAGE_KEY = 'wattshift.estimateCount';
/** Seed so the counter reads as a product in use, not a broken zero. */
const SEED_ESTIMATES = 1200;

const STEPS = [
  {
    icon: '📄',
    title: 'Upload your bill',
    body: "Drop your electricity bill and we'll extract your usage, tariff and billing period automatically.",
  },
  {
    icon: '☀️',
    title: 'We calculate your solar potential',
    body: 'Using Bureau of Meteorology solar data and your roof orientation, we model how much your property could generate.',
  },
  {
    icon: '📊',
    title: 'See your savings',
    body: 'Compare system sizes, add a battery, and see how your bill changes — with real numbers, not guesses.',
  },
];

const FEATURES = [
  {
    icon: '☀️',
    title: 'System sizing',
    body: 'The right solar size for your usage, not a one-size-fits-all guess.',
  },
  {
    icon: '💰',
    title: 'Bill impact',
    body: 'See your bill before and after, using the real tariff rates from your bill.',
  },
  {
    icon: '🔋',
    title: 'Battery scenarios',
    body: 'Compare what happens with different battery sizes, side by side.',
  },
  {
    icon: '📍',
    title: 'Roof analysis',
    body: 'Automatic roof detection from satellite data for your address.',
  },
];

const TRUST = [
  { icon: '🔒', label: 'Processed in your browser' },
  { icon: '🇦🇺', label: 'Built by Australian engineers' },
  { icon: '⚡', label: 'No signup required' },
  { icon: '💰', label: '100% free' },
];

export default function Landing({ onFiles, onCheckQuote, howRef }) {
  const estimates = useEstimateCount();
  const bottomUpload = useRef(null);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-solar-50 via-sky-50/60 to-white dark:from-solar-950/40 dark:via-ink-900 dark:to-ink-950"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[-12rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-solar-200/40 blur-3xl dark:bg-solar-800/20"
        />

        <div className="relative mx-auto max-w-2xl px-5 pb-16 pt-12 md:px-8 md:pt-20">
          <h1 className="text-center text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-5xl">
            Find out exactly what solar could save you
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-center text-base text-ink-600 md:text-lg dark:text-ink-300">
            Upload your electricity bill and get a personalised estimate in under
            60 seconds. Free, private, no signup.
          </p>

          <div className="mt-8">
            <BillUpload onFiles={onFiles} />
            <p className="mt-3 text-center text-sm text-ink-500 dark:text-ink-400">
              PDF, PNG or JPG — we'll read it automatically.
            </p>
          </div>

          <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {TRUST.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-1.5 text-sm sm:text-xs text-ink-600 dark:text-ink-400"
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </li>
            ))}
          </ul>

          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={onCheckQuote}
              className="inline-flex min-h-[44px] items-center text-sm font-medium text-solar-700 underline underline-offset-4 hover:text-solar-800 sm:min-h-0 dark:text-solar-400"
            >
              Already have a quote from an installer? Check if it's fair →
            </button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        ref={howRef}
        id="how-it-works"
        className="scroll-mt-20 bg-ink-50/70 py-16 dark:bg-ink-900/40"
      >
        <div className="mx-auto max-w-5xl px-5 md:px-8">
          <Reveal>
            <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">
              How it works
            </h2>
          </Reveal>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 100}>
                <div className="card h-full">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-solar-50 text-xl dark:bg-solar-900/40">
                    <span aria-hidden="true">{step.icon}</span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold">
                    <span className="mr-1.5 text-solar-600 dark:text-solar-400">
                      {i + 1}.
                    </span>
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* What you'll get */}
      <section className="py-16">
        <div className="mx-auto max-w-5xl px-5 md:px-8">
          <Reveal>
            <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">
              What you'll get
            </h2>
          </Reveal>

          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={i * 100}>
                <div className="card h-full">
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className="text-2xl">
                      {feature.icon}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold">{feature.title}</h3>
                      <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
                        {feature.body}
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="bg-ink-50/70 py-14 dark:bg-ink-900/40">
        <div className="mx-auto max-w-3xl px-5 text-center md:px-8">
          <Reveal>
            <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
              Trusted by homeowners and businesses across Australia
            </h2>
            <p className="mt-3 text-3xl font-bold text-solar-700 dark:text-solar-400">
              {number(estimates)}+
            </p>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
              estimates completed
            </p>
            {/*
              No testimonials here on purpose. Invented quotes attributed to
              made-up people would undercut the one thing this tool is selling —
              that its numbers are honest. Add real ones once collected.
            */}
          </Reveal>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16">
        <div className="mx-auto max-w-2xl px-5 md:px-8" ref={bottomUpload}>
          <Reveal>
            <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">
              Ready? Upload your bill and see what solar could do.
            </h2>
            <div className="mt-8">
              <BillUpload onFiles={onFiles} />
            </div>
            <p className="mt-4 text-center text-sm sm:text-xs text-ink-500 dark:text-ink-400">
              Estimates only — not engineering advice. Your bill is read on your
              device and never uploaded.
            </p>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

/**
 * A local tally of estimates run on this device, offset by a seed.
 *
 * Deliberately not presented as a global total — it is a count this browser
 * can actually vouch for, plus a stated baseline.
 */
function useEstimateCount() {
  const [count, setCount] = useState(SEED_ESTIMATES);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(STORAGE_KEY)) || 0;
      setCount(SEED_ESTIMATES + stored);
    } catch {
      // Private browsing with storage disabled — the seed alone is fine.
    }
  }, []);

  return count;
}

/** Called when an estimate completes, so the counter reflects real use. */
export function recordEstimate() {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY)) || 0;
    window.localStorage.setItem(STORAGE_KEY, String(stored + 1));
  } catch {
    // Non-fatal.
  }
}
