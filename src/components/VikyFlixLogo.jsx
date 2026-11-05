import React from 'react';

/**
 * MovieFlix logo — the Clap M.
 *
 * Exact replica of the reference pin design: a solid white geometric M
 * (rounded slate with a V notch cut from the top and two thin wedge slots
 * flanking a center fang at the bottom) and a three-tile striped stick
 * stepping up-right above it, about to clap onto the M. Rendered white on
 * black everywhere (navbar, icon, splash, launch intro).
 *
 * Variants:
 * - 'mark': the emblem only (navbar, badges, favicon)
 * - 'wordmark': MOVIEFLIX typography only
 * - 'full' (default): emblem + wordmark lockup
 */

const RED = '#e50914';
const WHITE = '#ffffff';

// Pin-exact geometry, viewBox 0 0 200 250 (derived from the reference image).
const M_BODY =
  'M21.3 132.6 Q21.3 125.6 28.3 125.6 L90.4 125.6 L109.4 149.5 Q110.6 151.1 111.8 149.5 ' +
  'L130.9 125.6 L193.0 125.6 Q200 125.6 200 132.6 L200 243 Q200 250 193 250 L136.9 250 ' +
  'Q133.9 250 134.2 247 L137.9 212.7 Q138.1 210.7 136.9 212.3 L112.2 244.1 Q111 245.7 109.7 244.1 ' +
  'L84.1 212.3 Q82.8 210.7 83.1 212.7 L88.7 247 Q89.2 250 86.2 250 L28.3 250 Q21.3 250 21.3 243 Z';
const TILE_1 =
  'M36.7 53.5 Q41.5 50 43.6 55.6 L51.1 76.3 Q53.2 81.9 48.4 85.4 L18.6 107.1 Q13.8 110.6 11.7 105 L4.2 84.3 Q2.1 78.7 6.9 75.2 Z';
const TILE_2 =
  'M101.7 28.2 Q106.4 24.5 108.5 30.1 L118.1 55 Q120.2 60.6 115.5 64.4 L82.4 90.9 Q77.7 94.7 75.5 89.1 L66 64.1 Q63.8 58.5 68.5 54.8 Z';
const TILE_3 =
  'M159.7 4 Q164.9 1.1 167.6 6.5 L181.4 34 Q184.1 39.4 178.9 42.3 L143.5 62 Q138.3 64.9 135.6 59.5 L121.8 32 Q119.1 26.6 124.3 23.7 Z';

function ClapperMark({ size }) {
  const w = Math.round(size * 0.8);
  return (
    <svg
      viewBox="0 0 200 250"
      width={w}
      height={size}
      className="mf-logo-svg"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* the M slate */}
      <path d={M_BODY} fill={WHITE} />
      {/* the three-tile clapper stick, hinged at the M's top-left corner */}
      <g className="mf-clap-stick">
        <path d={TILE_1} fill={WHITE} />
        <path d={TILE_2} fill={WHITE} />
        <path d={TILE_3} fill={WHITE} />
      </g>
    </svg>
  );
}

export default function VikyFlixLogo({
  size = 32,
  variant = 'full',
  className = '',
  animated = false,
  glow = true,
  onClick = undefined
}) {
  const wordmark = (
    <span className={`vf-brand-wordmark ${className}`} onClick={onClick}>
      <span className="vf-word-viky">MOVIE</span>
      <span className="vf-word-flix">FLIX</span>
      <span className="vf-word-pop" role="img" aria-label="popcorn">🍿</span>
    </span>
  );

  if (variant === 'mark') {
    return (
      <span
        className={`vf-brand-mark-wrap ${className}`}
        onClick={onClick}
        style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <ClapperMark size={size} />
      </span>
    );
  }

  if (variant === 'wordmark') {
    return wordmark;
  }

  return (
    <div
      className={`vf-brand-lockup ${className} ${onClick ? 'is-clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="vf-brand-mark-wrap" style={{ width: size * 0.8, height: size }}>
        <ClapperMark size={size} />
      </span>
      {wordmark}
    </div>
  );
}
