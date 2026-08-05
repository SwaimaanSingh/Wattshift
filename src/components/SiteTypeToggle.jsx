import { DEFAULTS } from '../config/defaults.js';
import { number } from '../utils/formatters.js';

/**
 * Home or business. Changes the sizes on offer, the network warnings and the
 * wording — never the extracted bill data, so switching costs nothing and
 * needs no re-upload.
 */
export default function SiteTypeToggle({ mode, onChange, dailyAverageKwh, suggested }) {
  const showSuggestion = suggested === 'business' && mode === 'home';

  return (
    <section className="card animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Is this for a home or a business?</h2>

        <div className="flex gap-2" role="group" aria-label="Site type">
          {Object.values(DEFAULTS.modes).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onChange(m.key)}
              aria-pressed={mode === m.key}
              className={`chip px-4 py-2 ${mode === m.key ? 'chip-active' : ''}`}
            >
              <span aria-hidden="true" className="mr-1.5">
                {m.icon}
              </span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {showSuggestion && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          This site uses {number(dailyAverageKwh, 1)} kWh a day — high for a
          house. If it's a business, switch above and we'll offer sizes that
          suit commercial sites.
        </p>
      )}
    </section>
  );
}
