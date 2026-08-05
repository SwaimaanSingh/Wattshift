/** Results section E — the legal footer. */
export default function Disclaimer({ onStartOver }) {
  return (
    <footer className="animate-fade-up space-y-4 border-t border-ink-200 pt-6 dark:border-ink-800">
      <p className="text-sm sm:text-xs leading-relaxed text-ink-500 dark:text-ink-400">
        These estimates are for guidance only and do not constitute engineering
        advice. Actual performance depends on site conditions, equipment
        selection, and installation quality. Consult a CEC-accredited installer
        for system design.
      </p>

      <p className="text-sm sm:text-xs leading-relaxed text-ink-500 dark:text-ink-400">
        Your bill data was processed in your browser and is not stored on any
        server.
      </p>

      {onStartOver && (
        <button
          type="button"
          onClick={onStartOver}
          className="inline-flex min-h-[44px] items-center text-sm font-medium text-solar-700 underline underline-offset-4 sm:min-h-0 dark:text-solar-400"
        >
          Start over with a different bill
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-1 text-sm sm:text-xs font-medium text-ink-600 dark:border-ink-700 dark:text-ink-300">
          <span aria-hidden="true">🇦🇺</span>
          Built by a solar engineer in Australia
        </span>
        <span className="text-sm sm:text-xs text-ink-400 dark:text-ink-500">WattShift</span>
      </div>
    </footer>
  );
}
