import { useState } from 'react';

/**
 * Generates the multi-page PDF.
 *
 * The name field is optional and deliberately unvalidated — it only ends up on
 * the cover page. Anyone who would rather not type their name gets "Property
 * Owner" and loses nothing.
 */
export default function ReportDownload({ buildReport, chartRefs, hasIntervalData, isAssessingExisting = false }) {
  const [name, setName] = useState('');
  const [state, setState] = useState('idle');

  const download = async () => {
    setState('working');
    try {
      const { downloadReport } = await import('../../services/reportGenerator.js');
      const report = buildReport(name.trim());
      const refs = Object.fromEntries(
        Object.entries(chartRefs).map(([key, ref]) => [key, ref.current])
      );
      await downloadReport(report, refs);
      setState('done');
    } catch (err) {
      console.error('Report generation failed', err);
      setState('error');
    }
  };

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '480ms' }}>
      <h2 className="text-base font-semibold">Download your report</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        {isAssessingExisting
          ? 'A PDF covering your consumption, how your existing system is performing, and every assumption behind the numbers.'
          : 'A five-page PDF covering your consumption, the system modelled, the costs and rebates, and every assumption behind the numbers — the thing to hand an installer when you ask for a quote.'}
      </p>

      <ul className="mt-3 space-y-1">
        {(isAssessingExisting
          ? [
              'Summary with generation, self-consumption, export and grid dependence',
              hasIntervalData
                ? 'Consumption analysis with your load curve and heatmap'
                : 'Consumption analysis from your bill totals',
              'Your system performance and energy balance',
              'Detailed performance breakdown',
              'Methodology, assumptions and disclaimer',
            ]
          : [
              'Summary with the key findings',
              hasIntervalData
                ? 'Consumption analysis with your load curve and heatmap'
                : 'Consumption analysis from your bill totals',
              'Solar production modelling',
              'Costs, rebates and 25-year projection',
              'Methodology, assumptions and disclaimer',
            ]
        ).map((item, i) => (
          <li key={item} className="flex gap-2.5 text-sm text-ink-600 dark:text-ink-300">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-sm sm:text-xs font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              {i + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <label htmlFor="report-name" className="label">
          Name for the report <span className="font-normal text-ink-400">(optional)</span>
        </label>
        <input
          id="report-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Property Owner"
          autoComplete="name"
          className="field"
        />
      </div>

      <button
        type="button"
        onClick={download}
        disabled={state === 'working'}
        className="btn-primary mt-4 w-full"
      >
        {state === 'working' ? 'Building your report…' : 'Download detailed PDF report'}
      </button>

      {state === 'done' && (
        <p className="mt-3 text-sm text-solar-700 dark:text-solar-400">
          Report downloaded. Change anything above and download again for an
          updated version.
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          Something went wrong building the PDF. Try again, or reload the page if
          it persists.
        </p>
      )}

      <p className="mt-3 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        Built in your browser. Nothing is sent anywhere.
      </p>
    </section>
  );
}
