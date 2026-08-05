import { useEffect, useState } from 'react';
import { LogoMark } from './Logo.jsx';
import { currency0, number } from '../utils/formatters.js';

/**
 * Slim context bar that appears once the headline figures scroll out of view.
 *
 * The results page is long; without this, someone reading the battery table
 * has lost sight of which system size the numbers belong to.
 */
export default function StickyResultsBar({ systemKw, savingsLow, savingsHigh, onUpload }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show after roughly the first card's worth of scrolling.
    const onScroll = () => setVisible(window.scrollY > 260);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur
                  transition-all duration-300 dark:border-ink-800 dark:bg-ink-950/95
                  ${visible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0'}`}
    >
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-3 px-5 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <LogoMark className="h-6 w-6 shrink-0" />
          {/* Hidden on phones — the savings figure earns the space instead. */}
          <span className="hidden text-sm font-medium text-ink-700 sm:inline dark:text-ink-200">
            {number(systemKw, 1)} kW solar
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="truncate text-sm font-semibold tabular-nums text-solar-700 dark:text-solar-400">
            ~{currency0(savingsLow)}–{currency0(savingsHigh)}/yr
          </span>
          <button
            type="button"
            onClick={onUpload}
            className="hidden shrink-0 rounded-lg border border-ink-300 px-3 py-1.5 text-sm sm:text-xs font-semibold
                       text-ink-700 hover:bg-ink-50 sm:block dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
          >
            Upload a bill
          </button>
        </div>
      </div>
    </div>
  );
}
