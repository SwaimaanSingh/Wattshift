import { Logo } from './Logo.jsx';

/** Dark site footer, shared by every view. */
export default function SiteFooter({ onNavigate }) {
  const columns = [
    {
      title: 'Product',
      links: [
        { label: 'How it works', key: 'how' },
        { label: 'Check a quote', key: 'quote' },
        { label: 'Upload a bill', key: 'home' },
      ],
    },
    {
      title: 'Company',
      links: [{ label: 'About', key: 'about' }],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Privacy Policy', key: 'privacy' },
        { label: 'Terms of Use', key: null, note: 'coming soon' },
      ],
    },
  ];

  return (
    <footer className="mt-16 bg-ink-900 text-ink-300">
      <div className="mx-auto max-w-6xl px-5 py-12 md:px-8">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="text-white">
              <Logo className="h-7 w-auto" />
            </div>
            <p className="mt-3 max-w-xs text-sm text-ink-400">
              Free, independent solar estimates from your actual electricity
              bill.
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm font-semibold text-white">{column.title}</h2>
              {/* The 44px tap targets below already separate the rows on
                  mobile; the extra gap would only pad out the footer. */}
              <ul className="mt-3 space-y-0 sm:space-y-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.key ? (
                      <button
                        type="button"
                        onClick={() => onNavigate(link.key)}
                        className="inline-flex min-h-[44px] items-center text-sm text-ink-400 underline-offset-4 hover:text-white hover:underline sm:min-h-0"
                      >
                        {link.label}
                      </button>
                    ) : (
                      <span className="text-sm text-ink-500">
                        {link.label}{' '}
                        <span className="text-sm sm:text-xs">({link.note})</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-ink-800 pt-6 text-sm text-ink-400">
          <p>© {new Date().getFullYear()} WattShift. Built by Australian engineers.</p>
          <p className="mt-1">
            Your bill data stays in your browser. We never store it.
          </p>
        </div>
      </div>
    </footer>
  );
}
