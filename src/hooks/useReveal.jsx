import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Reveal-on-scroll via IntersectionObserver — no animation library.
 *
 * Starts revealed when the observer is unavailable or motion is reduced, so
 * content is never hidden by a feature that didn't load.
 *
 * @returns {[React.RefObject, boolean]} ref to attach, and whether to show
 */
export function useReveal({ threshold = 0.15, once = true } = {}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(
    () => prefersReducedMotion() || typeof IntersectionObserver === 'undefined'
  );

  useEffect(() => {
    if (shown || !ref.current) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          if (once) observer.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -40px 0px' }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [shown, threshold, once]);

  return [ref, shown];
}

/** Wrapper applying the reveal transition. */
export function Reveal({ children, delay = 0, className = '' }) {
  const [ref, shown] = useReveal();

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
      } ${className}`}
      style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}
