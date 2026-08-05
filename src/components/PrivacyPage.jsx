const CONTACT = 'enquiry@wattshift.com.au';
const UPDATED = '26 July 2026';

/**
 * Privacy policy.
 *
 * Plain English on purpose. This needs a lawyer's review before launch — it
 * covers the essentials of what the app actually does today, nothing more.
 */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl px-5 py-14 md:px-8">
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Privacy Policy</h1>

      <p className="mt-4 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600 dark:bg-ink-900 dark:text-ink-300">
        Last updated: {UPDATED}. We keep this policy in plain English so you can
        actually read it.
      </p>

      <Section title="What we collect">
        Only what you submit yourself: your name, email, phone number if you
        give one, and the details of your enquiry.
        <strong className="font-semibold">
          {' '}
          Your electricity bill is processed entirely in your browser and is
          never uploaded, stored, or seen by us.
        </strong>{' '}
        When you close the tab, it's gone.
      </Section>

      <Section title="How we use it">
        To connect you with solar installers and to respond to your enquiry.
        That's it. We don't sell your data, and we don't use it for advertising.
      </Section>

      <Section title="Who we share it with">
        Up to three CEC-accredited solar installers selected for your area, and
        only when you've asked us for quotes and ticked the consent box. We
        share your contact details and the estimate summary so you don't have to
        repeat yourself.
      </Section>

      <Section title="How long we keep it">
        Enquiry data is kept for 12 months, then deleted.
      </Section>

      <Section title="Your rights">
        You can ask us to delete your data at any time by emailing{' '}
        <a
          href={`mailto:${CONTACT}`}
          className="text-solar-700 underline underline-offset-4 dark:text-solar-400"
        >
          {CONTACT}
        </a>
        . You can also ask for a copy of what we hold, or ask us to correct it.
      </Section>

      <Section title="Cookies and tracking">
        We use minimal browser storage for basic functionality only — for
        example, remembering how many estimates you've run on this device. No
        tracking cookies, no advertising pixels, and no analytics at this stage.
        If that changes, this page changes first.
      </Section>

      <Section title="Contact">
        <a
          href={`mailto:${CONTACT}`}
          className="text-solar-700 underline underline-offset-4 dark:text-solar-400"
        >
          {CONTACT}
        </a>
      </Section>
    </article>
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
