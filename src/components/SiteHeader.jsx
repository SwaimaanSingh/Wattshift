import { useState } from 'react';
import { Logo } from './Logo.jsx';

const LINKS = [
  { key: 'how', label: 'How it works' },
  { key: 'quote', label: 'Check a quote' },
  { key: 'enquire', label: 'Get expert advice' },
  { key: 'about', label: 'About' },
];

/**
 * Site header. Navigation is state-driven rather than routed — the app is a
 * single page and the "pages" are views, so there is no router to add.
 */
export default function SiteHeader({ onNavigate, onUpload, active }) {
  const [open, setOpen] = useState(false);

  const go = (key) => {
    setOpen(false);
    onNavigate(key);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-white/85 backdrop-blur dark:border-ink-800 dark:bg-ink-950/85">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 md:px-8">
        <button
          type="button"
          onClick={() => go('home')}
          aria-label="WattShift home"
          className="inline-flex min-h-[44px] shrink-0 items-center text-ink-900 sm:min-h-0 dark:text-ink-50"
        >
          <Logo className="h-7 w-auto" />
        </button>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((link) => (
            <button
              key={link.key}
              type="button"
              onClick={() => go(link.key)}
              aria-current={active === link.key ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors
                ${
                  active === link.key
                    ? 'text-solar-700 dark:text-solar-400'
                    : 'text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-50'
                }`}
            >
              {link.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onUpload}
            className="btn-primary ml-2 px-4 py-2 text-sm"
          >
            Upload a bill
          </button>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Menu"
          className="rounded-lg p-2.5 text-ink-700 md:hidden dark:text-ink-200"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            {open ? (
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="border-t border-ink-200 bg-white px-5 py-3 md:hidden dark:border-ink-800 dark:bg-ink-950"
        >
          <ul className="space-y-1">
            {LINKS.map((link) => (
              <li key={link.key}>
                <button
                  type="button"
                  onClick={() => go(link.key)}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-base font-medium text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-900"
                >
                  {link.label}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onUpload();
            }}
            className="btn-primary mt-3 w-full"
          >
            Upload a bill
          </button>
        </nav>
      )}
    </header>
  );
}
