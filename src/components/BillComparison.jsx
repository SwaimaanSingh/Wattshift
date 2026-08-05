import AnimatedNumber from './AnimatedNumber.jsx';
import SavingsBreakdown from './SavingsBreakdown.jsx';
import { DEFAULTS } from '../config/defaults.js';
import { centsPerDayAsMonthly, currency0, number } from '../utils/formatters.js';

/** Results section B (cont.) — before and after, as a visual comparison. */
export default function BillComparison({ savings, batteryKwh = 0 }) {
  const current = savings.currentAnnualBill;
  // Already floored at the supply charge by the calculation engine.
  const afterMid = savings.newAnnualBillMid;
  const scale = Math.max(current, 1);
  const afterLabel =
    batteryKwh > 0
      ? `With solar + ${DEFAULTS.batteryLabel(batteryKwh)}`
      : 'With solar';

  return (
    <section className="card flex h-full flex-col animate-fade-up" style={{ animationDelay: '120ms' }}>
      <h2 className="text-base font-semibold">Your bill, before and after</h2>

      <div className="mt-5 space-y-4">
        <Bar
          label="Now"
          amount={currency0(current)}
          widthPercent={100}
          tone="current"
        />
        <Bar
          label={afterLabel}
          amount={`${currency0(savings.newAnnualBillLow)} – ${currency0(savings.newAnnualBillHigh)}`}
          widthPercent={Math.max(3, (afterMid / scale) * 100)}
          tone="after"
        />
      </div>

      <div className="mt-6 rounded-xl bg-gradient-to-b from-solar-50 to-solar-100/60 p-4 text-center dark:from-solar-900/30 dark:to-solar-900/10">
        <p className="text-sm font-medium text-solar-800 dark:text-solar-200">
          You'd save around
        </p>
        <p className="mt-1 text-3xl font-bold text-solar-700 dark:text-solar-300">
          <AnimatedNumber
            value={savings.annualSavingsLow}
            format={(n) => currency0(n)}
            countUp
          />
          {' – '}
          <AnimatedNumber
            value={savings.annualSavingsHigh}
            format={(n) => currency0(n)}
            countUp
          />
        </p>
        <p className="mt-1 text-sm text-solar-700 dark:text-solar-300">a year</p>
      </div>

      <p className="mt-4 text-sm sm:text-xs text-ink-500 dark:text-ink-400">
        The range reflects real-world variation — weather, how much power you use
        during daylight, and how your system is installed.
      </p>

      <SavingsBreakdown savings={savings} />

      <p className="tech mt-3">
        supply charge {number(savings.rates.supplyChargeCents, 1)}c/day (~
        {centsPerDayAsMonthly(savings.rates.supplyChargeCents)}) · connection fee ~{' '}
        {currency0(savings.supplyChargeAnnual ?? 0)}/yr
      </p>
    </section>
  );
}

function Bar({ label, amount, widthPercent, tone }) {
  const fill =
    tone === 'current'
      ? 'bg-ink-300 dark:bg-ink-700'
      : 'bg-solar-500 dark:bg-solar-600';

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tnum">{amount}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${fill}`}
          style={{ width: `${Math.min(100, widthPercent)}%` }}
        />
      </div>
    </div>
  );
}
