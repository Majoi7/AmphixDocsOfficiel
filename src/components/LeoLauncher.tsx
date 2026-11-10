import { motion, useReducedMotion } from 'motion/react';
import { Avatar } from './ui/components-primitives-avatar';
import { cn } from '../lib/utils';

export function LeoLauncher({ onClick, expanded = false, className }: {
  onClick: () => void;
  expanded?: boolean;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const animate = reducedMotion === false;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label="Ouvrir Léo AI"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      title="Rechercher avec Léo AI"
      whileHover={animate ? { rotate: -5, scale: 1.05 } : undefined}
      whileTap={animate ? { scale: 0.94 } : undefined}
      transition={animate ? { type: 'spring', stiffness: 400, damping: 22 } : { duration: 0 }}
      className={cn('inline-flex size-12 min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414]', className)}
    >
      <span aria-hidden="true" className="pointer-events-none inline-flex"><Avatar color="orange" size="sm" /></span>
    </motion.button>
  );
}
