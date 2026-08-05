import { useState } from 'react';

const BENEFITS = [
  {
    title: 'Use your solar at night',
    body: "Store what your panels make during the day and use it in the evening, when rates are highest, instead of buying it back from the grid.",
  },
  {
    title: 'Backup during outages',
    body: 'Some battery systems can keep your lights on during a power cut. Not all setups do this — ask your installer whether backup is included.',
  },
  {
    title: 'Rely on the grid less',
    body: 'A battery typically lifts the share of your own solar you actually use from around 35% to 70–85%.',
  },
  {
    title: 'Virtual Power Plant (VPP)',
    body: 'Some South Australian retailers run VPP programs that pay credits — commonly $200–$800 a year — for sharing stored power at times of peak demand. Ask about VPP-compatible systems.',
  },
];

/** Collapsed by default — context for people who want it, out of the way otherwise. */
export default function BatteryBenefits() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-ink-200 dark:border-ink-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="battery-benefits"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold">Why consider a battery?</span>
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
        <div
          id="battery-benefits"
          className="space-y-3 border-t border-ink-200 px-4 py-4 dark:border-ink-800"
        >
          {BENEFITS.map((b) => (
            <div key={b.title}>
              <p className="text-sm font-semibold">{b.title}</p>
              <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">{b.body}</p>
            </div>
          ))}

          <a
            href="#"
            className="inline-block pt-1 text-sm font-medium text-solar-700 underline underline-offset-4 dark:text-solar-400"
          >
            Learn more
          </a>
        </div>
      )}
    </div>
  );
}
