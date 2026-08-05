import { useCallback, useRef, useState } from 'react';
import { Nem12Error, maskNmi, parseNem12File } from '../../services/nem12Parser.js';
import { kwh, number } from '../../utils/formatters.js';

const ACCEPTED = '.csv,.zip,.txt,.dat,text/csv,application/zip';
const MAX_FILE_MB = 60;

/**
 * Drop zone and parser for NEM12 meter data.
 *
 * Parsing runs in the browser and takes a second or two on a year of
 * half-hourly readings, so progress is reported as it goes — a silent pause
 * on a file the customer had to go and fetch from a portal reads as a crash.
 */
export default function Nem12Upload({ onParsed, onError }) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ stage: '', pct: null });
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const accept = useCallback(
    async (fileList) => {
      const file = Array.from(fileList || [])[0];
      if (!file) return;

      setError(null);
      setResult(null);

      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setError({ message: `${file.name} is larger than ${MAX_FILE_MB} MB.` });
        return;
      }
      if (/\.(pdf|png|jpe?g|webp|xlsx?)$/i.test(file.name)) {
        setError({
          message:
            "That looks like a bill or a spreadsheet rather than meter data. You're after the CSV or ZIP download from your distributor's portal.",
        });
        return;
      }

      setBusy(true);
      try {
        const parsed = await parseNem12File(file, (stage, pct) => setProgress({ stage, pct }));
        setResult(parsed);
        onParsed?.(parsed, file);
      } catch (err) {
        const friendly =
          err instanceof Nem12Error
            ? { message: err.message, code: err.code }
            : {
                message:
                  "We couldn't read that file. Make sure it's the CSV or ZIP your distributor provided, downloaded rather than opened and re-saved.",
              };
        setError(friendly);
        onError?.(friendly);
      } finally {
        setBusy(false);
      }
    },
    [onParsed, onError]
  );

  if (busy) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-solar-400 bg-solar-50/60 px-6 py-10 text-center dark:border-solar-700 dark:bg-solar-900/15">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-[3px] border-solar-200 border-t-solar-600" aria-hidden="true" />
        <p className="mt-4 font-semibold">{progress.stage || 'Reading your meter data…'}</p>
        {progress.pct != null && (
          <div className="mx-auto mt-3 h-1.5 w-48 overflow-hidden rounded-full bg-solar-200 dark:bg-solar-900">
            <div
              className="h-full rounded-full bg-solar-600 transition-[width] duration-200"
              style={{ width: `${Math.round(progress.pct * 100)}%` }}
            />
          </div>
        )}
        <p className="mt-3 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
          This happens on your device — the file never leaves your browser.
        </p>
      </div>
    );
  }

  if (result) {
    return <ParsedSummary result={result} onReplace={() => setResult(null)} />;
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload your smart meter data file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files);
        }}
        className={[
          'group flex w-full cursor-pointer flex-col items-center justify-center gap-3',
          'rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging
            ? 'border-solar-600 bg-solar-50 dark:bg-solar-900/20'
            : 'border-ink-300 bg-ink-50/60 hover:border-solar-500 hover:bg-solar-50/50 dark:border-ink-700 dark:bg-ink-900/50 dark:hover:bg-solar-900/10',
        ].join(' ')}
      >
        <svg
          className="h-10 w-10 text-solar-600 transition-transform group-hover:-translate-y-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.6}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16.5V4.5m0 0L7.5 9M12 4.5 16.5 9M4.5 16.5v1.75A2.25 2.25 0 0 0 6.75 20.5h10.5a2.25 2.25 0 0 0 2.25-2.25V16.5"
          />
        </svg>

        <p className="text-lg font-semibold">
          <span className="hidden sm:inline">Drop your meter data file here, or </span>
          <span className="text-solar-700 underline decoration-solar-300 underline-offset-4 dark:text-solar-400">
            tap to select
          </span>
        </p>
        <p className="max-w-sm text-sm text-ink-500 dark:text-ink-400">
          A CSV or ZIP from your distributor's portal. Usually 12 months of
          half-hourly readings.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
        >
          <p className="text-sm text-amber-900 dark:text-amber-200">{error.message}</p>
          {error.code === 'too_few_days' && (
            <p className="mt-2 text-sm sm:text-xs text-amber-800 dark:text-amber-300">
              Most portals let you pick a date range — try requesting the last
              12 months.
            </p>
          )}
          {(error.code === 'not_nem12' || error.code === 'wrong_format') && (
            <p className="mt-2 text-sm sm:text-xs text-amber-800 dark:text-amber-300">
              You can continue with your bill data instead — you'll still get
              cost estimates and a full report.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** What we found, before committing to the analysis. */
function ParsedSummary({ result, onReplace }) {
  const { summary, channels, warnings } = result;

  const facts = [
    ['Meter', maskNmi(result.nmi)],
    ['Period', `${formatDate(summary.dateRange.start)} to ${formatDate(summary.dateRange.end)}`],
    ['Days of data', `${number(summary.totalDays)}${summary.estimatedDays ? ` (${summary.estimatedDays} estimated)` : ''}`],
    ['Reading interval', `${summary.intervalMinutes} minutes`],
    ['Total used', kwh(summary.totalImportKwh)],
    ['Daily average', `${number(summary.avgDailyImportKwh, 1)} kWh/day`],
    ['Peak demand', `${number(summary.peakDemandKw, 1)} kW${summary.peakDemandAt ? ` at ${summary.peakDemandAt.time}` : ''}`],
  ];

  if (summary.hasSolar) facts.push(['Existing solar export', kwh(summary.totalExportKwh)]);
  if (summary.hasControlledLoad) {
    facts.push(['Controlled load', kwh(summary.totalControlledKwh)]);
  }

  return (
    <div className="rounded-2xl border border-solar-300 bg-solar-50/60 p-5 dark:border-solar-800 dark:bg-solar-900/15">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-solar-900 dark:text-solar-100">
            Meter data read successfully
          </p>
          <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">
            {number(summary.totalDays)} days of {summary.intervalMinutes}-minute
            readings, {Object.keys(channels).length === 1 ? 'one channel' : `${Object.keys(channels).length} channels`}.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-[44px] shrink-0 items-center text-sm font-semibold text-solar-800 underline underline-offset-4 sm:min-h-0 sm:text-xs dark:text-solar-300"
          onClick={onReplace}
        >
          Use a different file
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
            <dd className="tnum font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {warnings.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-solar-200 pt-3 dark:border-solar-800">
          {warnings.map((warning) => (
            <li key={warning} className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
