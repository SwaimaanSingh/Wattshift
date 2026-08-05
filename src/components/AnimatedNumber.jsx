import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Count-up for headline figures. Re-animates whenever `value` changes, so the
 * battery toggle visibly moves the numbers.
 *
 * Correctness beats motion: requestAnimationFrame is paused whenever the page
 * isn't compositing (backgrounded tab, hidden window), which would otherwise
 * leave a stale figure on screen indefinitely. A timeout backstop snaps to the
 * final value if the animation hasn't delivered it.
 *
 * @param {number} value
 * @param {(n: number) => string} format
 * @param {number} duration ms
 */
export default function AnimatedNumber({
  value,
  format,
  duration = 700,
  className = '',
  countUp = false,
}) {
  // `countUp` holds the figure at zero until it scrolls into view, then counts
  // to the real value once. Later changes (a slider move) animate normally.
  const [armed, setArmed] = useState(!countUp);
  const holderRef = useRef(null);
  const prevValueRef = useRef(value);

  const target = armed ? value : 0;
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);

  // A battery or slider change while count-up is still waiting must show the
  // new figure immediately — not sit at $0 until scroll-in.
  useEffect(() => {
    if (!countUp || armed) {
      prevValueRef.current = value;
      return;
    }
    if (value !== prevValueRef.current) {
      prevValueRef.current = value;
      setArmed(true);
    }
  }, [value, countUp, armed]);

  useEffect(() => {
    if (armed || !holderRef.current) return undefined;

    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setArmed(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(holderRef.current);

    /**
     * Backstop. If the observer never reports — a tab that isn't compositing,
     * an element the browser never considers visible — the figure would sit at
     * zero forever. Showing "$0" where the saving belongs is far worse than
     * skipping an animation, so arm it regardless after a moment.
     */
    const failsafe = setTimeout(() => {
      setArmed(true);
      observer.disconnect();
    }, 1200);

    return () => {
      observer.disconnect();
      clearTimeout(failsafe);
    };
  }, [armed]);

  useEffect(() => {
    const from = fromRef.current;
    const to = armed ? value : 0;
    if (from === to) return undefined;

    const settle = () => {
      fromRef.current = to;
      setDisplay(to);
    };

    if (prefersReducedMotion() || document.hidden) {
      settle();
      return undefined;
    }

    let frame = null;
    const start = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — fast start, gentle settle
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);

      if (t < 1) frame = requestAnimationFrame(step);
      else fromRef.current = to;
    };

    frame = requestAnimationFrame(step);
    const backstop = setTimeout(settle, duration + 150);

    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      clearTimeout(backstop);
    };
  }, [value, duration, armed]);

  return (
    <span ref={holderRef} className={`tnum ${className}`}>
      {format(display)}
    </span>
  );
}
