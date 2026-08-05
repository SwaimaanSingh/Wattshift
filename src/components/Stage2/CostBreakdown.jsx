import { EQUIPMENT_TIERS } from '../../config/defaults.js';
import { costRows } from '../../services/costEstimator.js';
import { currency0, formatPaybackYears } from '../../utils/formatters.js';

/**
 * What it costs, what comes off, and how long it takes to pay back.
 *
 * Every figure is a range. Quoting a single price would invite the customer to
 * treat a legitimate quote as wrong — the same system genuinely varies by
 * thousands between installers depending on equipment, roof access and how
 * busy the installer is that month.
 */
export default function CostBreakdown({ costs, tier, onTierChange, annualSavings }) {
  const rows = costRows(costs);
  const tierInfo = EQUIPMENT_TIERS.find((t) => t.key === tier) ?? EQUIPMENT_TIERS[1];

  return (
    <section className="card animate-fade-up" style={{ animationDelay: '360ms' }}>
      <h2 className="text-base font-semibold">What it costs</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">
        Installed prices for {costs.isCommercial ? 'commercial' : 'residential'}{' '}
        systems in {costs.state}, with rebates shown separately so you can see
        where the discount comes from.
      </p>

      {!costs.isCommercial && (
        <>
          <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Equipment tier">
            {EQUIPMENT_TIERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onTierChange(option.key)}
                aria-pressed={tier === option.key}
                className={`chip ${tier === option.key ? 'chip-active' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm sm:text-xs text-ink-500 dark:text-ink-400">{tierInfo.detail}</p>
        </>
      )}

      <table className="mt-5 w-full text-sm">
        <caption className="sr-only">System cost breakdown</caption>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.key}
              className={i % 2 === 1 ? 'bg-ink-50/70 dark:bg-ink-800/40' : undefined}
            >
              <th scope="row" className="rounded-l-md py-2 pl-2 pr-3 text-left font-normal text-ink-600 dark:text-ink-300">
                {row.label}
              </th>
              <td
                className={`tnum rounded-r-md py-2 pr-2 text-right font-medium ${
                  row.credit ? 'text-solar-700 dark:text-solar-400' : ''
                }`}
              >
                {row.credit
                  ? `−${currency0(Math.abs(row.low))}`
                  : row.low === row.high
                    ? currency0(row.low)
                    : `${currency0(row.low)} – ${currency0(row.high)}`}
              </td>
            </tr>
          ))}

          <tr className="border-t-2 border-ink-200 dark:border-ink-700">
            <th scope="row" className="py-3 pl-2 pr-3 text-left font-semibold">
              Estimated net cost
            </th>
            <td className="tnum py-3 pr-2 text-right text-base font-bold">
              {currency0(costs.netTotal.low)} – {currency0(costs.netTotal.high)}
            </td>
          </tr>
          <tr>
            <td colSpan={2} className="pb-3 pl-2 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
              including GST
            </td>
          </tr>

          {annualSavings && (
            <>
              <tr className="border-t border-ink-200 dark:border-ink-700">
                <th scope="row" className="py-2 pl-2 pr-3 text-left font-normal text-ink-600 dark:text-ink-300">
                  Annual savings
                </th>
                <td className="tnum py-2 pr-2 text-right font-medium">
                  {currency0(annualSavings.low)} – {currency0(annualSavings.high)}
                </td>
              </tr>
              <tr className="bg-ink-50/70 dark:bg-ink-800/40">
                <th scope="row" className="rounded-l-md py-2 pl-2 pr-3 text-left font-normal text-ink-600 dark:text-ink-300">
                  Payback period
                </th>
                <td className="tnum rounded-r-md py-2 pr-2 text-right font-medium">
                  {formatPaybackYears(costs.paybackYears)}
                </td>
              </tr>
              <tr>
                <th scope="row" className="py-2 pl-2 pr-3 text-left font-normal text-ink-600 dark:text-ink-300">
                  25-year net benefit
                </th>
                <td className="tnum py-2 pr-2 text-right font-medium text-solar-700 dark:text-solar-400">
                  {currency0(costs.netBenefit25Year?.low)} – {currency0(costs.netBenefit25Year?.high)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {costs.stc.cappedBySchemeLimit && (
        <p className="mt-3 text-sm sm:text-xs text-amber-700 dark:text-amber-400">
          STCs are capped at 100 kW. Above that, systems earn large-scale
          certificates annually instead — income rather than an upfront discount,
          and not counted here.
        </p>
      )}

      {costs.batteryRebate?.cappedByLimit && (
        <p className="mt-3 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
          The federal battery rebate is capped at{' '}
          {number(costs.batteryRebate.kwhClaimed)} kWh, so the capacity above
          that attracts no rebate.
        </p>
      )}

      <p className="mt-4 border-t border-ink-200 pt-3 text-sm sm:text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
        Costs are indicative and vary by installer, equipment selection and site
        complexity. The STC price of ${costs.stc.pricePerStc} reflects current
        market rates. Get quotes for accurate pricing. Pricing data updated{' '}
        {costs.pricingUpdated}.
      </p>
    </section>
  );
}
