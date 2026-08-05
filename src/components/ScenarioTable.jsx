import { currency0, number, percent } from '../utils/formatters.js';

/**
 * Every battery option side by side at the currently selected solar size.
 *
 * A table on desktop; stacked cards on phones, because a four-column financial
 * table squeezed into 375px is unreadable and horizontal scrolling hides the
 * column that matters.
 */
export default function ScenarioTable({ scenarios, batteryKwh, systemKw }) {
  if (!scenarios?.length) return null;

  const isActive = (s) => Math.abs(s.batteryKwh - batteryKwh) < 0.01;

  /**
   * Rows share an identical bill once savings have fully offset it, even when
   * self-consumption ratios still differ. Saying so explains why a bigger
   * battery stops changing the money.
   */
  const atFloor = (s) => s.savings.newAnnualBillLow <= s.savings.minAnnualBill;

  return (
    <section
      className="card animate-fade-up bg-slate-50/80 dark:bg-ink-900"
      style={{ animationDelay: '210ms' }}
    >
      <h2 className="text-base font-semibold">Compare your options</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        All based on a {number(systemKw, 1)} kW system. Change the size above and
        these update.
      </p>

      {/* Desktop table */}
      <div className="mt-5 hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-left dark:border-ink-800">
              <Th>Scenario</Th>
              <Th align="right">Annual savings</Th>
              <Th align="right">Bill goes from</Th>
              <Th align="right">Self-consumption</Th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr
                key={s.label}
                className={`border-b border-ink-100 last:border-0 dark:border-ink-800/60 ${
                  isActive(s) ? 'bg-solar-50 dark:bg-solar-900/20' : ''
                } ${s.isCustom ? 'border-l-2 border-l-solar-400' : ''}`}
              >
                <td className="py-3 pl-2 pr-3 font-medium">
                  {s.label}
                  {s.isCustom && (
                    <span className="ml-2 rounded bg-ink-100 px-1.5 py-0.5 text-sm font-semibold uppercase tracking-wide sm:text-[10px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                      Your size
                    </span>
                  )}
                  {isActive(s) && (
                    <span className="ml-2 rounded bg-solar-600 px-1.5 py-0.5 text-sm font-semibold uppercase tracking-wide sm:text-[10px] text-white">
                      Selected
                    </span>
                  )}
                </td>
                <td className="py-3 text-right tabular-nums font-semibold text-solar-700 dark:text-solar-400">
                  {currency0(s.savings.annualSavingsLow)} –{' '}
                  {currency0(s.savings.annualSavingsHigh)}
                </td>
                <td className="py-3 text-right tabular-nums">
                  {currency0(s.savings.currentAnnualBill)}{' '}
                  <span className="text-ink-400">→</span>{' '}
                  {currency0(s.savings.newAnnualBillLow)}–
                  {currency0(s.savings.newAnnualBillHigh)}
                  {atFloor(s) && (
                    <span className="block text-sm sm:text-xs font-normal text-ink-500 dark:text-ink-400">
                      Bill fully offset
                    </span>
                  )}
                </td>
                <td className="py-3 text-right tabular-nums">
                  {percent(s.savings.selfConsumptionPercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="mt-5 space-y-3 md:hidden">
        {scenarios.map((s) => (
          <div
            key={s.label}
            className={`rounded-xl border p-4 ${
              isActive(s)
                ? 'border-solar-500 bg-solar-50 dark:border-solar-600 dark:bg-solar-900/20'
                : s.isCustom
                  ? 'border-solar-300 dark:border-solar-800'
                  : 'border-ink-200 dark:border-ink-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{s.label}</p>
              <div className="flex shrink-0 gap-1.5">
                {s.isCustom && (
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 text-sm font-semibold uppercase tracking-wide sm:text-[10px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                    Your size
                  </span>
                )}
                {isActive(s) && (
                  <span className="rounded bg-solar-600 px-1.5 py-0.5 text-sm font-semibold uppercase tracking-wide sm:text-[10px] text-white">
                    Selected
                  </span>
                )}
              </div>
            </div>

            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label="Annual savings">
                <span className="font-semibold text-solar-700 dark:text-solar-400">
                  {currency0(s.savings.annualSavingsLow)} –{' '}
                  {currency0(s.savings.annualSavingsHigh)}
                </span>
              </Row>
              <Row label="Bill goes from">
                {currency0(s.savings.currentAnnualBill)} →{' '}
                {currency0(s.savings.newAnnualBillLow)}–
                {currency0(s.savings.newAnnualBillHigh)}
                {atFloor(s) && (
                  <span className="block text-sm sm:text-xs text-ink-500 dark:text-ink-400">
                    Bill fully offset
                  </span>
                )}
              </Row>
              <Row label="Self-consumption">
                {percent(s.savings.selfConsumptionPercent)}
              </Row>
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th
      scope="col"
      className={`pb-2 text-sm sm:text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400 ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}
