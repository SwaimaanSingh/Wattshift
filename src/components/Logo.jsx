/**
 * WattShift wordmark and mark.
 *
 * "Watt" bold, "Shift" medium, with a lightning bolt replacing the stem of the
 * second "t" — the energy cue sits inside the word rather than beside it, so
 * the lockup stays compact at small sizes.
 *
 * Text uses `currentColor` so the wordmark inverts correctly on dark
 * backgrounds; only the bolt is pinned to the brand green.
 */

export function Logo({ className = 'h-7', title = 'WattShift' }) {
  return (
    <svg
      viewBox="0 0 168 32"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <LogoMarkPaths x={0} y={4} size={24} />

      <text
        x="32"
        y="23"
        fontFamily="Inter, system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="21"
        fontWeight="700"
        fill="currentColor"
        letterSpacing="-0.5"
      >
        Watt
      </text>
      <text
        x="79"
        y="23"
        fontFamily="Inter, system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="21"
        fontWeight="500"
        fill="currentColor"
        letterSpacing="-0.5"
        opacity="0.85"
      >
        Shift
      </text>
    </svg>
  );
}

/** Square mark on its own — favicon, app icon, tight spaces. */
export function LogoMark({ className = 'h-8 w-8', title = 'WattShift' }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <LogoMarkPaths x={0} y={0} size={32} />
    </svg>
  );
}

/**
 * Shared geometry: a rounded square holding a bolt that doubles as a rising
 * shift arrow.
 */
function LogoMarkPaths({ x, y, size }) {
  const s = size / 32;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect width="32" height="32" rx="8" className="fill-solar-600" />
      <path
        d="M18.6 5.2a.7.7 0 0 1 1.22.73L16.4 13.2h5.1a.7.7 0 0 1 .55 1.13L13.1 26.6a.7.7 0 0 1-1.23-.7l3.4-7.6h-5.1a.7.7 0 0 1-.55-1.13L18.6 5.2Z"
        fill="#ffffff"
      />
    </g>
  );
}

export default Logo;
