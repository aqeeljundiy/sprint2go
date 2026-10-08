import { useId } from 'react';
// sprint2go brand marks. The product colour stays sprint2go blue in every workspace.

/** The mark: two forward chevrons in a rounded square ("go"). */
export function Logo({ size = 28 }: { size?: number }) {
  // Each mark has its own gradient id: with a shared one, a hidden copy earlier on the page leaves the visible one unfilled.
  const id = `s2g-g-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="s2g-mark">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4d6bff" />
          <stop offset="1" stopColor="#2448ff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path d="M9 10.5 14.5 16 9 21.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 10.5 22.5 16 17 21.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".6" />
    </svg>
  );
}

/** "sprint2go" set in the brand face, with the 2 in sprint2go blue. */
export function Wordmark({ height = 22 }: { height?: number }) {
  return (
    <span className="s2g-wordmark" style={{ fontSize: height * 1.05 }} aria-label="sprint2go">
      <Logo size={height * 1.15} />
      <span>
        sprint<b>2</b>go
      </span>
    </span>
  );
}
