import ShareResults from './ShareResults.jsx';

/** Results section D — where this goes next. */
export default function NextSteps({
  summary,
  chartRef,
  onGetQuotes,
  onStartStage2,
  onTalkToEngineer,
}) {
  return (
    <section className="card flex h-full flex-col animate-fade-up" style={{ animationDelay: '300ms' }}>
      <h2 className="text-base font-semibold">What next?</h2>

      <button type="button" onClick={onGetQuotes} className="btn-primary mt-4 w-full">
        Get quotes from local installers
      </button>
      <p className="mt-2 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        Up to 3 CEC-accredited installers. No spam, no pressure.
      </p>

      <div className="mt-6 border-t border-ink-200 pt-5 dark:border-ink-800">
        <ShareResults summary={summary} chartRef={chartRef} />
      </div>

      <div className="mt-6 space-y-3 border-t border-ink-200 pt-5 dark:border-ink-800">
        {onStartStage2 ? (
          <ActionCard
            title="Get a detailed analysis"
            description="Half-hourly modelling from your smart meter data, panel layout, and a payback calculation."
            onClick={onStartStage2}
          />
        ) : (
          <Placeholder
            title="Get a detailed analysis"
            description="Half-hourly modelling from your smart meter data, panel layout, and a payback calculation."
          />
        )}

        {onTalkToEngineer ? (
          <ActionCard
            title="Talk to a solar engineer"
            description="Independent advice on system design and quotes — no installer commissions."
            onClick={onTalkToEngineer}
          />
        ) : (
          <Placeholder
            title="Talk to a solar engineer"
            description="Independent advice on system design and quotes — no installer commissions."
          />
        )}
      </div>
    </section>
  );
}

function ActionCard({ title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start justify-between gap-3 rounded-xl border border-ink-200 px-4 py-3.5 text-left hover:border-solar-400 hover:bg-solar-50/60 dark:border-ink-700 dark:hover:border-solar-700 dark:hover:bg-solar-900/10"
    >
      <div>
        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">{title}</p>
        <p className="mt-0.5 text-sm sm:text-xs text-ink-500 dark:text-ink-400">{description}</p>
      </div>
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-ink-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

function Placeholder({ title, description }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-dashed border-ink-300 px-4 py-3.5 dark:border-ink-700">
      <div>
        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">{title}</p>
        <p className="mt-0.5 text-sm sm:text-xs text-ink-500 dark:text-ink-400">{description}</p>
      </div>
      <span className="shrink-0 rounded-full bg-ink-100 px-2.5 py-1 text-sm sm:text-xs font-medium text-ink-500 dark:bg-ink-800 dark:text-ink-400">
        Soon
      </span>
    </div>
  );
}
