import { useEffect, useState } from 'react';
import { centsPerDayAsMonthly, currency0, kwh, number } from '../utils/formatters.js';

/**
 * Where the saving actually comes from.
 *
 * Open by default on desktop where there's room, collapsed on phones so the
 * headline figure stays the focus.
 */
export default function SavingsBreakdown({ savings }) {
  const [open, setOpen] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : false
  );

  // Follow the breakpoint until the customer expresses a preference.
  const [userSet, setUserSet] = useState(false);
  useEffect(() => {
    if (userSet) return undefined;
    const query = window.matchMedia('(min-width: 768px)');
    const apply = (e) => setOpen(e.matches);
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [userSet]);

  const { breakdown, rates } = savings;

  return (
    <div className="mt-4 border-t border-ink-200 pt-3 dark:border-ink-800">
      <button
        type="button"
        onClick={() => {
          setUserSet(true);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-controls="savings-breakdown"
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left sm:min-h-0"
      >
        <span className="text-sm font-medium text-ink-700 dark:text-ink-200">
          See breakdown
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div id="savings-breakdown" className="mt-3 space-y-2.5">
          <Line
            amount={breakdown.fromSelfConsumption}
            text="from using solar power instead of buying it from the grid"
            detail={`${kwh(savings.selfConsumedKwh)} used on site @ ${number(rates.tariffCents, 1)}c`}
          />
          <Line
            amount={breakdown.fromExport}
            text="from selling excess solar back to the grid"
            detail={`${kwh(savings.exportedKwh)} exported @ ${number(rates.feedInCents, 1)}c${
              rates.feedInAssumed ? ' (assumed)' : ''
            }`}
          />

          <p className="pt-1 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
            Your supply charge (~{centsPerDayAsMonthly(rates.supplyChargeCents)})
            is a fixed connection fee. Once on-site use covers your energy,
            export credits can offset it too.
          </p>

          {savings.savingsCapped && (
            <p className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">
              At this size the system already covers your whole bill, so the
              saving shown here stops growing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Line({ amount, text, detail }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-solar-500" aria-hidden="true" />
      <p className="text-sm text-ink-700 dark:text-ink-200">
        <strong className="font-semibold tabular-nums">{currency0(amount)}</strong>{' '}
        {text}
        <span className="tech ml-1 block">{detail}</span>
      </p>
    </div>
  );
}
