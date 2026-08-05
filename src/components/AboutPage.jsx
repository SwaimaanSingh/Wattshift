/** Static About view. */
export default function AboutPage({ onUpload }) {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-solar-50 to-white dark:from-solar-950/30 dark:to-ink-950"
      />

      <article className="relative mx-auto max-w-2xl px-5 py-14 md:px-8">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">About WattShift</h1>

        <p className="mt-5 text-lg text-ink-700 dark:text-ink-200">
          WattShift is a free, independent solar estimation tool built by
          Australian engineers.
        </p>

        <p className="mt-4 text-ink-600 dark:text-ink-300">
          We built WattShift because we were tired of seeing people overpay for
          solar, undersized systems that don't deliver, and misleading savings
          claims from sales-driven calculators.
        </p>

        <Section title="How it works">
          Your electricity bill contains everything needed to estimate the right
          solar system for your property. WattShift reads your bill, extracts
          your usage and tariff data, and runs engineering-grade calculations
          using Bureau of Meteorology solar data and real derate factors. No
          shortcuts, no inflated promises.
        </Section>

        <Section title="Your privacy">
          Your bill is processed entirely in your browser. We never upload,
          store, or see your bill data. The only data we keep is what you
          voluntarily submit through our enquiry form. See our Privacy Policy
          for full details.
        </Section>

        <Section title="Independence">
          WattShift doesn't sell solar systems and doesn't earn commissions from
          installers. When you request quotes through us, we connect you with
          qualified installers — but the tool itself is completely independent.
          The numbers are the numbers.
        </Section>

        <Section title="Accuracy">
          Our calculations use CEC-standard derate factors, real BOM solar
          irradiance data, and actual tariff rates from your bill. We show
          ranges rather than false precision, and we'll always tell you when an
          estimate needs professional verification.
        </Section>

        <p className="mt-8 text-ink-600 dark:text-ink-300">
          Built in Adelaide, South Australia. <span aria-hidden="true">🇦🇺</span>
        </p>

        <div className="mt-10">
          <button type="button" onClick={onUpload} className="btn-primary">
            Upload a bill
          </button>
        </div>
      </article>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-ink-600 dark:text-ink-300">{children}</p>
    </section>
  );
}
