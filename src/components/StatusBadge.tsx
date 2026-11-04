import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ItemStatus, STATUS_CONFIG } from '../lib/supabase';
import { Clock, Check, AlertCircle, Info } from 'lucide-react';

interface StatusBadgeProps {
  status: ItemStatus;
  rejectionReason?: string | null;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  rejectionReason,
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  return (
    <div className="relative inline-block">
      <span
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => {
          e.stopPropagation();
          setShowTooltip((prev) => !prev);
        }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border cursor-default select-none ${cfg.bg} ${cfg.text} ${cfg.border} ${className}`}
      >
        {status === 'pending' && (
          <motion.span
            animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            className="w-1.5 h-1.5 rounded-full bg-[#ffd23f]"
          />
        )}

        {status === 'approved' && (
          <svg
            className="w-3 h-3 text-emerald-600 stroke-[3]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <motion.polyline
              points="20 6 9 17 4 12"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.3 }}
            />
          </svg>
        )}

        {status === 'rejected' && (
          <AlertCircle className="w-3 h-3 text-[#b0245e]" />
        )}

        <span>{cfg.label}</span>

        {status === 'rejected' && rejectionReason && (
          <Info className="w-3 h-3 opacity-70 ml-0.5" />
        )}
      </span>

      {/* Tooltip pour le motif de refus */}
      <AnimatePresence>
        {status === 'rejected' && rejectionReason && showTooltip && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 bottom-full mb-1.5 z-40 w-56 p-2.5 rounded-xl bg-[#141414] text-[#f1ece4] text-[11px] font-medium shadow-xl pointer-events-none"
          >
            <p className="font-bold text-[#ffb6e1] mb-0.5">Motif du refus :</p>
            <p className="line-clamp-3 leading-tight">{rejectionReason}</p>
            <div className="absolute left-3 top-full w-2 h-2 bg-[#141414] rotate-45 -mt-1" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
