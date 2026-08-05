import { ACCURACY_COPY } from '../services/calculationEngine.js';
import { currency0, kwh, number, shortDate } from '../utils/formatters.js';

/** Results section A — what the bill says you use. */
export default function ConsumptionSummary({ billData, sizing, savings }) {
  const accuracy = billData.profile?.accuracy ?? 'basic';
  const billCount = billData.billCount ?? 1;

  return (
    <section className="card flex h-full flex-col animate-fade-up">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">
          {/* With solar already installed, the bill only shows grid imports. */}
          {billData.hasSolar ? 'What you buy from the grid' : 'Your electricity use'}
        </h2>
        {billData.retailer && (
          <span className="text-sm sm:text-xs text-ink-500 dark:text-ink-400">
            {billData.retailer}
          </span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4">
        <Stat
          label="Every day"
          value={`${number(sizing.dailyConsumption, 1)} kWh`}
          detail="average across your bill"
        />
        <Stat
          label="Every year"
          value={kwh(Math.round(sizing.annualConsumption))}
          detail="estimated from that"
        />
        <Stat
          label="Costing you"
          value={`${currency0(savings.currentAnnualBill)}/yr`}
          detail="at your current rates"
        />
        <Stat
          label="Your rate"
          value={`${number(savings.rates.tariffCents, 1)}c`}
          detail={
            savings.rates.tariffAssumed
              ? 'typical SA rate (not found on bill)'
              : billData.tariffType === 'tou'
                ? 'average across time-of-use'
                : 'per kWh'
          }
        />
      </dl>

      {billData.billingPeriodStart && billData.billingPeriodEnd && (
        <p className="tech mt-4">
          {billCount > 1 ? `${billCount} bills covering ` : 'Bill period: '}
          {shortDate(billData.billingPeriodStart)} – {shortDate(billData.billingPeriodEnd)}
          {billData.billingDays ? ` · ${billData.billingDays} days` : ''}
          {billData.dailySupplyChargeCents
            ? ` · supply charge ${number(billData.dailySupplyChargeCents, 1)}c/day`
            : ''}
        </p>
      )}

      <div className="mt-auto flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-2.5 pt-2.5 dark:bg-ink-800/60">
        <AccuracyDot level={accuracy} />
        <p className="text-sm sm:text-xs text-ink-600 dark:text-ink-300">
          {ACCURACY_COPY[accuracy]}
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, detail }) {
  return (
    <div>
      <dt className="text-sm sm:text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-xl font-bold tnum">{value}</dd>
      {detail && <p className="tech mt-0.5">{detail}</p>}
    </div>
  );
}

function AccuracyDot({ level }) {
  const colours = {
    basic: 'bg-amber-400',
    fair: 'bg-amber-500',
    good: 'bg-solar-500',
    high: 'bg-solar-600',
  };
  return (
    <span
      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${colours[level] || 'bg-ink-400'}`}
      aria-hidden="true"
    />
  );
}
