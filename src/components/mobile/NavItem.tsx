import React from 'react';
import { motion } from 'motion/react';

interface NavItemProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  isCenterPlus?: boolean;
}

export const NavItem: React.FC<NavItemProps> = ({
  id,
  label,
  icon,
  isActive,
  onClick,
  isCenterPlus = false,
}) => {
  if (isCenterPlus) {
    return (
      <div className="relative -top-5 flex flex-col items-center justify-center">
        <motion.button
          type="button"
          onClick={onClick}
          whileTap={{ scale: 1.15, rotate: 90 }}
          whileHover={{ scale: 1.06 }}
          className="w-14 h-14 rounded-full bg-[#ff6a2b] text-white flex items-center justify-center shadow-lg shadow-[#ff6a2b]/35 border-4 border-[#141414] focus:outline-none focus:ring-4 focus:ring-[#ff6a2b]/40 cursor-pointer"
          aria-label={label}
        >
          {icon}
        </motion.button>
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      className="relative flex items-center justify-center h-12 min-w-[48px] px-3 rounded-full cursor-pointer select-none transition-colors group"
    >
      {/* Pastille crème glissante avec layoutId */}
      {isActive && (
        <motion.div
          layoutId="mobileNavActiveIndicator"
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="absolute inset-0 bg-[#f1ece4] rounded-full shadow-sm"
        />
      )}

      {/* Contenu : Icône & Label optionnel */}
      <div className="relative z-10 flex items-center gap-1.5">
        <motion.span
          animate={isActive ? { scale: [0.8, 1.15, 1] } : { scale: 1 }}
          transition={{ duration: 0.3 }}
          className={`transition-colors ${
            isActive ? 'text-[#141414]' : 'text-[#f1ece4]/70 group-hover:text-[#f1ece4]'
          }`}
        >
          {icon}
        </motion.span>

        {isActive && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="text-xs font-bold text-[#141414] overflow-hidden whitespace-nowrap pr-1 hidden xs:inline-block"
          >
            {label}
          </motion.span>
        )}
      </div>
    </motion.button>
  );
};
