import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../../lib/utils';

export type AvatarColor =
  | 'blue' | 'orange' | 'red' | 'green' | 'purple' | 'yellow'
  | 'cyan' | 'pink' | 'indigo' | 'lime' | 'turquoise' | 'violet';
export type AvatarSize = 'sm' | 'md' | 'lg';
export type AvatarShape = 'circle' | 'square' | 'squircle';

export interface AvatarProps {
  blinking?: boolean;
  color?: AvatarColor;
  size?: AvatarSize;
  shape?: AvatarShape;
  className?: string;
}

const BLINK_KEYFRAMES = `
@keyframes av-blink {
  0%, 88%, 100% { transform: scaleY(1); }
  93%, 97% { transform: scaleY(0.07); }
}
@media (prefers-reduced-motion: reduce) {
  [data-avatar-eye] { animation: none !important; }
}
`;

const SHINE = 'radial-gradient(ellipse at 30% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.1) 50%, transparent 70%)';

function preset(stops: readonly [string, string, string, string], iris: string, shadow: string) {
  return {
    gradient: `radial-gradient(circle at 50% 45%, ${stops[0]} 0%, ${stops[1]} 40%, ${stops[2]} 68%, ${stops[3]} 100%)`,
    boxShadow: `0 0 4px 0px rgba(${shadow},.35), 0 0 16px 6px rgba(${shadow},.18), inset 0 0 0 1px rgba(255,255,255,.05)`,
    iris: `linear-gradient(135deg, #ffffff 0%, ${iris} 100%)`,
    shine: SHINE,
  };
}

const PRESETS = {
  blue: preset(['#0d4d9a', '#3d7dd8', '#6fb3ff', '#e0eeff'], '#d4ecff', '20,102,216'),
  orange: preset(['#a63e10', '#e27a2a', '#ffb46a', '#ffe8cc'], '#ffd9b8', '232,100,0'),
  red: preset(['#a60033', '#e74668', '#ff8aaa', '#ffd6e8'], '#ffcde4', '223,24,92'),
  green: preset(['#0d6632', '#2a9d5f', '#6dd187', '#d1fadd'], '#c5f5d8', '12,168,82'),
  purple: preset(['#4a0080', '#8b3fd1', '#c896ff', '#e8d4ff'], '#e0c9ff', '110,46,224'),
  yellow: preset(['#8a5500', '#d4a000', '#ffc93a', '#fff5cc'], '#fff0a8', '214,142,0'),
  cyan: preset(['#003d66', '#0a8fb5', '#5dd4ff', '#cdf5ff'], '#d0f0ff', '10,143,181'),
  pink: preset(['#7a0055', '#d63384', '#ff6bb3', '#ffe5f5'], '#ffd6ed', '214,51,132'),
  indigo: preset(['#2d157a', '#4f46e5', '#8b7eff', '#ddd6ff'], '#e0d9ff', '79,70,229'),
  lime: preset(['#4a5910', '#84cc16', '#bef264', '#ecfccf'], '#f7fee8', '132,204,22'),
  turquoise: preset(['#1a5555', '#0d9488', '#2dd4bf', '#ccfbf1'], '#c0fdf5', '13,148,136'),
  violet: preset(['#4a2a7a', '#a855f7', '#d8b4fe', '#f3e8ff'], '#ede9fe', '168,85,247'),
} satisfies Record<AvatarColor, ReturnType<typeof preset>>;

const SIZE = {
  sm: { orb: 'size-8', eye: 'w-1 h-1.5', eyeGap: 'gap-1.5', eyeY: '-translate-y-0.5' },
  md: { orb: 'size-12', eye: 'w-1.5 h-2.5', eyeGap: 'gap-2.5', eyeY: '-translate-y-0.5' },
  lg: { orb: 'size-16', eye: 'w-2 h-3', eyeGap: 'gap-3.5', eyeY: '-translate-y-1' },
} satisfies Record<AvatarSize, { orb: string; eye: string; eyeGap: string; eyeY: string }>;

const SHAPE_RADIUS = {
  circle: 'rounded-full',
  square: 'rounded-[0%]',
  squircle: 'rounded-[40%]',
} satisfies Record<AvatarShape, string>;

export function Avatar({ blinking = true, color = 'blue', size = 'md', shape = 'circle', className }: AvatarProps) {
  const uid = useId().replace(/\W/g, '');
  const reducedMotion = useReducedMotion();
  const animate = reducedMotion === false;
  const colors = PRESETS[color];
  const dimensions = SIZE[size];
  const noiseId = `av-noise-${uid}`;
  const grainId = `av-grain-${uid}`;

  return (
    <motion.div
      role="img"
      aria-label="Avatar de Léo AI"
      tabIndex={-1}
      className={cn('relative isolate inline-flex shrink-0 items-center justify-center overflow-hidden select-none', dimensions.orb, SHAPE_RADIUS[shape], className)}
      style={{ background: colors.gradient, boxShadow: colors.boxShadow }}
      whileTap={animate ? { scaleX: 1.15, scaleY: 1.3 } : undefined}
      transition={{ type: 'tween', duration: animate ? 0.8 : 0, ease: [0.34, 1.56, 0.64, 1] }}
    >
      <style>{BLINK_KEYFRAMES}</style>
      <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 h-full w-full opacity-20 mix-blend-overlay saturate-0">
        <defs>
          <filter id={noiseId} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves={4} stitchTiles="stitch" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#${noiseId})`} />
      </svg>
      <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 h-full w-full opacity-20 mix-blend-overlay saturate-0">
        <defs>
          <filter id={grainId} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="3.2" numOctaves={1} stitchTiles="stitch" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#${grainId})`} />
      </svg>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: colors.shine }} />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 blur-xs" style={{ background: 'radial-gradient(circle at 62% 68%, rgba(0,0,0,0.18) 0%, transparent 55%)' }} />
      <span aria-hidden="true" className={cn('relative z-10 flex items-center', dimensions.eyeGap, dimensions.eyeY)}>
        {[0, 60].map((delayMs) => (
          <span
            key={delayMs}
            data-avatar-eye
            className={cn('block origin-center rounded-full', dimensions.eye)}
            style={{ background: colors.iris, animation: blinking && animate ? `av-blink 3.6s ease-in-out ${delayMs}ms infinite` : 'none' }}
          />
        ))}
      </span>
    </motion.div>
  );
}

export default Avatar;
