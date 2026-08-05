import { useMemo, useState } from 'react';
import AnimatedNumber from './AnimatedNumber.jsx';
import { calculateProduction } from '../services/calculationEngine.js';
import { kwh, number, percent } from '../utils/formatters.js';

/** Results section B — the system being modelled. */
export default function SolarRecommendation({
  sizing,
  production,
  savings,
  solarData,
  hasExistingSolar = false,
  existingKw,
  systemKw,
  panelCount,
  roofAreaM2,
  modeConfig,
  isAddition = false,
}) {
  const existingSizeKnown = hasExistingSolar && existingKw != null;
  const existingSizeUnknown = hasExistingSolar && existingKw == null;
  const isTopUp =
    isAddition || (existingKw != null && sizing.additionalKwNeeded != null);
  const isCustomSize = Math.abs(systemKw - sizing.recommendedKw) > 0.05;
  const oversized = (savings.offsetPercent ?? 0) > 110;

  const existingProduction = useMemo(() => {
    if (!existingSizeKnown) return null;
    return calculateProduction(existingKw, solarData, sizing.effectiveDerate);
  }, [existingSizeKnown, existingKw, solarData, sizing.effectiveDerate]);

  const title = existingSizeUnknown
    ? 'Your grid purchases'
    : existingSizeKnown
      ? 'Your existing system'
      : isCustomSize
        ? isTopUp
          ? 'Your chosen addition'
          : 'Your chosen system'
        : isAddition && sizing.practicalFloorApplied
          ? 'Smallest practical addition'
          : isTopUp
            ? 'Recommended addition'
            : 'Recommended solar';

  const detailsKw = existingSizeKnown ? existingKw : systemKw;
  const detailsProduction = existingSizeKnown ? existingProduction ?? production : production;

  return (
    <section className="card flex h-full flex-col animate-fade-up" style={{ animationDelay: '60ms' }}>
      <h2 className="text-base font-semibold">{title}</h2>

      {existingSizeKnown ? (
        <ExistingSystemKnown
          existingKw={existingKw}
          annualKwh={existingProduction?.annual ?? 0}
        />
      ) : existingSizeUnknown ? (
        <ExistingSystemUnknown production={production} />
      ) : (
        <NewSystemRecommendation
          sizing={sizing}
          production={production}
          savings={savings}
          solarData={solarData}
          systemKw={systemKw}
          panelCount={panelCount}
          roofAreaM2={roofAreaM2}
          modeConfig={modeConfig}
          isTopUp={isTopUp}
          isAddition={isAddition}
          isCustomSize={isCustomSize}
          oversized={oversized}
          existingKw={existingKw}
        />
      )}

      <div className="mt-auto pt-4">
        <TechnicalDetails
          systemKw={detailsKw}
          sizing={sizing}
          production={detailsProduction}
          solarData={solarData}
          offsetPercent={
            existingSizeKnown
              ? null
              : savings.offsetPercent
          }
        />
      </div>
    </section>
  );
}

/** Bill shows export, but the customer hasn't named their system size. */
function ExistingSystemUnknown({ production }) {
  return (
    <>
      <p className="mt-3 text-ink-700 dark:text-ink-200">
        If you replaced your system:{' '}
        <strong className="tabular-nums">
          <AnimatedNumber value={production.annual} format={(n) => kwh(n)} />
        </strong>{' '}
        generated, covers 100% of grid purchases
      </p>

      <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2.5 text-sm sm:text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">
        This is based on your grid purchases only. Your actual consumption is
        higher because your existing solar isn&apos;t visible on the bill. Upload
        interval data for a true picture.
      </p>
    </>
  );
}

/** Customer picked a size for the system already on the roof. */
function ExistingSystemKnown({ existingKw, annualKwh }) {
  return (
    <>
      <p className="mt-3 text-ink-700 dark:text-ink-200">
        A{' '}
        <strong className="text-2xl font-bold tabular-nums text-solar-700 dark:text-solar-400">
          {number(existingKw, 1)} kW
        </strong>{' '}
        system generates approximately{' '}
        <strong className="tabular-nums">{kwh(annualKwh)}</strong>/year in your
        area.
      </p>
      <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">
        Select your size above to see modelled generation.
      </p>
    </>
  );
}

/** No existing solar on the bill — original recommendation card. */
function NewSystemRecommendation({
  sizing,
  production,
  savings,
  solarData,
  systemKw,
  panelCount,
  roofAreaM2,
  modeConfig,
  isTopUp,
  isAddition,
  isCustomSize,
  oversized,
  existingKw,
}) {
  // The floor is a minimum viable install, not a measure of remaining need —
  // saying "covers the rest of your consumption" here would overstate it.
  const flooredAddition = isAddition && sizing.practicalFloorApplied && !isCustomSize;

  return (
    <>
      <p className="mt-3 text-ink-700 dark:text-ink-200">
        {isCustomSize ? (
          <>
            A{' '}
            <strong className="text-2xl font-bold tabular-nums text-solar-700 dark:text-solar-400">
              {/* Not animated: this is a value the customer set directly, and
                  an in-flight count-up would disagree with the slider and the
                  comparison table for the length of the animation. */}
              {number(systemKw, 1)} kW
            </strong>{' '}
            {isAddition || isTopUp ? 'addition' : 'system'} — you&apos;ve moved
            this away from the {number(sizing.recommendedKw, 1)} kW we suggest.
          </>
        ) : flooredAddition ? (
          <>
            The smallest addition worth installing is{' '}
            <strong className="text-2xl font-bold tabular-nums text-solar-700 dark:text-solar-400">
              {number(systemKw, 1)} kW
            </strong>
            {existingKw
              ? `, on top of your existing ${number(existingKw, 1)} kW system`
              : ''}
            .
          </>
        ) : isAddition || isTopUp ? (
          <>
            Adding about{' '}
            <strong className="text-2xl font-bold tabular-nums text-solar-700 dark:text-solar-400">
              {number(systemKw, 1)} kW
            </strong>{' '}
            {isAddition
              ? 'would cover the rest of your estimated true consumption'
              : 'would cover the electricity you still buy from the grid'}
            {existingKw
              ? `, on top of your existing ${number(existingKw, 1)} kW system`
              : ''}.
          </>
        ) : (
          <>
            About{' '}
            <strong className="text-2xl font-bold tabular-nums text-solar-700 dark:text-solar-400">
              {number(systemKw, 1)} kW
            </strong>{' '}
            of solar would cover your electricity needs.
          </>
        )}
      </p>

      {/* Explains why the recommendation isn't simply "what your usage needs". */}
      {sizing.practicalFloorApplied && !isCustomSize && (
        <p className="mt-3 rounded-lg bg-solar-50 px-3 py-2.5 text-sm sm:text-xs text-solar-900 dark:bg-solar-900/25 dark:text-solar-200">
          {flooredAddition ? (
            <>
              This is the smallest install worth doing, not a measure of what
              you still need. Your existing system already covers all but about{' '}
              {number(sizing.coverageKw, 1)} kW of your usage — but an addition
              below {number(sizing.recommendedKw, 1)} kW for {modeConfig.site}{' '}
              costs nearly as much to install, so it&apos;s poor value. The extra
              production earns feed-in credits and leaves room for a battery, an
              EV, or usage that grows.
            </>
          ) : (
            <>
              Your usage on its own only needs about{' '}
              {number(sizing.coverageKw, 1)} kW, but the smallest practical
              system for {modeConfig.site} is {number(sizing.recommendedKw, 1)}{' '}
              kW — below that, the fixed costs of an installation make it poor
              value. The extra production earns feed-in credits and leaves room
              for a battery, an EV, or usage that grows.
            </>
          )}
        </p>
      )}

      {isAddition && existingKw != null && !flooredAddition && (
        <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2.5 text-sm sm:text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">
          This is extra capacity on top of your existing{' '}
          {number(existingKw, 1)} kW system — sized to the load your current
          system doesn&apos;t already cover.
        </p>
      )}
      {isTopUp && !isAddition && (
        <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2.5 text-sm sm:text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">
          Your bill only shows what you buy from the grid. Your actual total
          usage is higher, because you also use solar directly and that never
          appears on the bill. This estimate covers your grid purchases, so it&apos;s
          extra capacity on top of what you have — and your real needs may be
          lower.
        </p>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-ink-200 pt-4 dark:border-ink-800">
        <div>
          <dt className="text-sm sm:text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Would generate
          </dt>
          <dd className="mt-0.5 text-xl font-bold tnum">
            <AnimatedNumber value={production.annual} format={(n) => kwh(n)} />
          </dd>
          <p className="tech mt-0.5">per year</p>
        </div>
        <div>
          <dt className="text-sm sm:text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Covers
          </dt>
          <dd className="mt-0.5 text-xl font-bold tnum">
            {/* A system sized well past the load can reach several hundred
                percent. The raw figure reads like a fault, so cap it and say
                where the surplus goes instead. */}
            {oversized ? (
              '100%+'
            ) : (
              <AnimatedNumber
                value={savings.offsetPercent ?? 0}
                format={(n) => percent(Math.round(n))}
              />
            )}
          </dd>
          <p className="tech mt-0.5">
            {oversized
              ? 'the surplus is exported'
              : isAddition
                ? 'of the remaining load'
                : isTopUp
                  ? 'of your grid purchases'
                  : 'of what you use'}
          </p>
        </div>
      </dl>

      <p className="mt-4 text-sm text-ink-600 dark:text-ink-300">
        That&apos;s roughly {panelCount} panels, needing about {number(roofAreaM2)} m² of
        roof — and your area gets {number(solarData.annual, 1)} hours of good sun a
        day on average.
      </p>

      {sizing.cappedByLimit && !isCustomSize && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm sm:text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          Your usage would justify {number(sizing.uncappedKw, 1)} kW. We&apos;ve capped
          the recommendation at {number(sizing.recommendedKw, 1)} kW because
          larger systems need network approval and a different design approach —
          worth a conversation with an engineer.
        </p>
      )}
    </>
  );
}

/** Engineering figures, tucked away so they don't clutter the consumer view. */
function TechnicalDetails({ systemKw, sizing, production, solarData, offsetPercent }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] items-center gap-1 text-sm font-medium text-ink-400 hover:text-ink-600 sm:min-h-0 sm:text-xs dark:hover:text-ink-300"
      >
        Technical details
        <svg
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <dl className="mt-2 space-y-0.5 text-sm sm:text-xs text-ink-400 dark:text-ink-500">
          <Detail label="DC capacity" value={`${number(systemKw, 1)} kW`} />
          <Detail label="Peak sun hours" value={`${number(solarData.annual, 2)} kWh/m²/day`} />
          <Detail
            label="System derate"
            value={`${number(sizing.effectiveDerate * 100, 1)}%`}
          />
          <Detail
            label="Specific yield"
            value={`${number(production.annual / systemKw)} kWh/kW/yr`}
          />
          <Detail
            label="Coverage sizing"
            value={`${number(sizing.coverageKw, 1)} kW at 100% offset`}
          />
          {offsetPercent != null && (
            <Detail label="Offset ratio" value={`${number(offsetPercent)}%`} />
          )}
        </dl>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
