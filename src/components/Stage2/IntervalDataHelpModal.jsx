import { useEffect, useMemo, useState } from 'react';

/**
 * Where to get a NEM12 file from each retailer's own portal.
 *
 * This is the retailer route. The state-by-state distributor route stays on the
 * Stage 2 page itself — distributors are the more reliable source, but most
 * people try their retailer first because that is who they already have a login
 * with.
 *
 * `url` is each retailer's domain root rather than a deep link to their login
 * screen. Portal paths change often and a 404 on a "go here" link is worse than
 * one extra click on a page that is certain to load; the domains match what
 * step 1 tells the reader to type.
 */
const RETAILERS = [
  {
    id: 'agl',
    label: 'AGL',
    url: 'https://www.agl.com.au',
    steps: [
      'Log in at agl.com.au',
      'Go to My Account → Energy usage',
      'Choose Download usage data',
      'Select NEM12 format',
      'Download the file',
    ],
  },
  {
    id: 'origin',
    label: 'Origin Energy',
    url: 'https://www.originenergy.com.au',
    steps: [
      'Log in at originenergy.com.au',
      'Go to My Account → Usage',
      'Open Detailed usage',
      'Choose Export, then NEM12',
    ],
  },
  {
    id: 'simply',
    label: 'Simply Energy',
    url: 'https://www.simplyenergy.com.au',
    steps: [
      'Log in at simplyenergy.com.au',
      'Go to My Account → My Usage',
      'Choose Download interval data',
    ],
  },
  {
    id: 'energyaustralia',
    label: 'Energy Australia',
    url: 'https://www.energyaustralia.com.au',
    steps: [
      'Log in at energyaustralia.com.au',
      'Go to My Account → Energy usage',
      'Choose Download',
      'Select interval data',
    ],
  },
  {
    id: 'alinta',
    label: 'Alinta Energy',
    url: 'https://www.alintaenergy.com.au',
    steps: [
      'Log in at alintaenergy.com.au',
      'Go to My Account → Usage history',
      'Choose Export data',
    ],
  },
  {
    id: 'amber',
    label: 'Amber Electric',
    url: 'https://www.amber.com.au',
    steps: ['Log in at amber.com.au', 'Account → Usage', 'Export → NEM12'],
  },
  {
    id: 'powershop',
    label: 'Powershop',
    url: 'https://www.powershop.com.au',
    steps: [
      'Log in at powershop.com.au',
      'Go to My Powershop → Usage',
      'Choose Download interval data',
    ],
  },
  {
    id: 'ovo',
    label: 'OVO Energy',
    url: 'https://www.ovoenergy.com.au',
    steps: ['Log in at ovoenergy.com.au', 'Go to My Account → Usage', 'Choose Download'],
  },
  {
    id: 'lumo',
    label: 'Lumo Energy',
    url: 'https://www.lumoenergy.com.au',
    steps: ['Log in at lumoenergy.com.au', 'Go to My Account → Usage data', 'Choose Export'],
  },
  {
    id: 'tango',
    label: 'Tango Energy',
    url: 'https://www.tangoenergy.com',
    steps: [
      'Log in at tangoenergy.com',
      'Go to My Account → Usage',
      'Choose Download interval data',
    ],
  },
  {
    id: 'other',
    label: 'Other',
    url: null,
    steps: [
      "Log in to your retailer's online account",
      'Go to Usage or Energy data',
      'Look for a download or export option',
      'Select NEM12 or interval data format',
      "If you can't find it, call your retailer and ask for your NEM12 interval data file",
    ],
  },
];

const DEFAULT_RETAILER_ID = 'agl';

/** Loose key so "EnergyAustralia" and "Energy Australia" land on the same tab. */
const normalise = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '');

const RETAILER_BY_KEY = new Map(RETAILERS.map((r) => [normalise(r.label), r.id]));

/**
 * Which tab to open on.
 *
 * A retailer we detected but have no steps for resolves to "Other" rather than
 * to the default — we do know who they are, so showing AGL's instructions would
 * be actively misleading. Only an undetected retailer falls back to AGL.
 *
 * @param {string|null|undefined} detected `billData.retailer` from the parser
 */
export function resolveRetailerId(detected) {
  const key = normalise(detected);
  if (!key) return DEFAULT_RETAILER_ID;
  return RETAILER_BY_KEY.get(key) ?? 'other';
}

/**
 * Instructions for fetching a NEM12 file, shown before the file picker.
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {() => void} onHaveFile closes and hands over to the file picker
 * @param {string|null} [detectedRetailer] from the bill parse, selects the tab
 */
export default function IntervalDataHelpModal({
  open,
  onClose,
  onHaveFile,
  detectedRetailer = null,
}) {
  const initialId = useMemo(() => resolveRetailerId(detectedRetailer), [detectedRetailer]);
  const [selectedId, setSelectedId] = useState(initialId);

  // Re-seed if the modal is reopened after the bill parse resolved a retailer.
  useEffect(() => {
    if (open) setSelectedId(initialId);
  }, [open, initialId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // Stop the page behind scrolling while the overlay is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const retailer = RETAILERS.find((r) => r.id === selectedId) ?? RETAILERS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="interval-help-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl dark:bg-ink-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="interval-help-title" className="text-xl font-bold tracking-tight">
              How to download your interval data
            </h2>
            <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
              Pick your retailer for the exact steps. Ask for{' '}
              <strong>NEM12</strong> or <strong>interval data</strong> — a
              monthly usage summary won&apos;t work.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-ink-400 hover:text-ink-700 sm:min-h-0 sm:min-w-0 dark:hover:text-ink-200"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* A select rather than a tab strip: eleven tabs either wrap to four
            rows on a phone or scroll horizontally, and both push the steps —
            the thing being read — off the screen. */}
        <div className="mt-5">
          <label htmlFor="interval-help-retailer" className="label">
            Your retailer
          </label>
          <select
            id="interval-help-retailer"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="field"
          >
            {RETAILERS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <ol className="mt-5 space-y-2.5">
          {retailer.steps.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm text-ink-700 dark:text-ink-200">
              <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-solar-100 text-sm sm:text-xs font-semibold text-solar-800 dark:bg-solar-900/50 dark:text-solar-200">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>

        {retailer.url && (
          <a
            href={retailer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-solar-700 underline underline-offset-4 sm:min-h-0 dark:text-solar-400"
          >
            Open {retailer.label}
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18v4.5M17.5 6.5 10 14M16 13v5H6V8h5" />
            </svg>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}

        <p className="mt-5 rounded-lg bg-ink-50 px-3 py-2.5 text-sm sm:text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">
          Can&apos;t find it? Email your retailer directly and ask for your NEM12
          interval data file for the last 12 months.
        </p>

        <button type="button" onClick={onHaveFile} className="btn-primary mt-5 w-full">
          I have my file
        </button>
      </div>
    </div>
  );
}
