import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface NavItemProps {
  id: string;
  label: string;
  icon: ReactNode;
  isActive: boolean;
  onClick: () => void;
  isCenterPlus?: boolean;
}

export function NavItem({ id, label, icon, isActive, onClick, isCenterPlus = false }: NavItemProps) {
  const reducedMotion = useReducedMotion();
  if (isCenterPlus) return <div className="relative -top-3 flex min-w-0 items-center justify-center">
    <motion.button type="button" data-nav={id} aria-label={label} onClick={onClick}
      whileTap={reducedMotion ? undefined : { scale: 1.08, rotate: 20 }} whileHover={reducedMotion ? undefined : { scale: 1.05 }}
      className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full border-4 border-[#141414] bg-[#ff6a2b] text-[#141414] shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffd23f] min-[360px]:h-14 min-[360px]:w-14">{icon}</motion.button>
  </div>;

  return <motion.button type="button" data-nav={id} aria-label={label} aria-current={isActive ? 'page' : undefined} onClick={onClick}
    whileTap={reducedMotion ? undefined : { scale: 0.95 }}
    className={`relative flex min-h-12 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full px-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#ffd23f] ${isActive ? 'text-[#141414]' : 'text-[#f1ece4]/85 hover:text-white'}`}>
    {isActive && <motion.span aria-hidden="true" layoutId={reducedMotion ? undefined : 'mobileNavActiveIndicator'}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 350 }} className="absolute inset-0 rounded-full bg-[#f1ece4]" />}
    <span className="relative z-10">{icon}</span>
    <span className="relative z-10 max-w-full truncate text-[9px] font-bold min-[360px]:text-[10px]">{label}</span>
  </motion.button>;
}
