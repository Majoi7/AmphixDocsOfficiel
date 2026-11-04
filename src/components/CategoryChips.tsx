import React from 'react';
import { motion } from 'motion/react';
import { CategoryItem } from '../lib/supabase';

interface CategoryChipsProps {
  categories: CategoryItem[];
  selectedCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  counts: Record<string, number>;
  totalCount: number;
}

export const CategoryChips: React.FC<CategoryChipsProps> = ({
  categories,
  selectedCategoryId,
  onSelectCategory,
  counts,
  totalCount,
}) => {
  return (
    <div className="w-full flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar snap-x snap-mandatory select-none px-0.5">
      {/* Puce "Toutes" */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.95 }}
        onClick={() => onSelectCategory(null)}
        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold transition-all shrink-0 cursor-pointer ${
          selectedCategoryId === null
            ? 'bg-[#ff6a2b] text-white shadow-sm'
            : 'bg-white border border-[#141414]/15 text-[#141414]/75 hover:border-[#141414]/30 hover:text-[#141414]'
        }`}
      >
        <span>Tous</span>
        <span
          className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
            selectedCategoryId === null ? 'bg-white/25 text-white' : 'bg-[#f1ece4] text-[#141414]/70'
          }`}
        >
          {totalCount}
        </span>
      </motion.button>

      {/* Puces de chaque catégorie */}
      {categories.map((cat) => {
        const isSelected = selectedCategoryId === cat.id;
        const count = counts[cat.id] || 0;

        return (
          <motion.button
            key={cat.id}
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelectCategory(isSelected ? null : cat.id)}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold transition-all shrink-0 cursor-pointer ${
              isSelected
                ? 'bg-[#ff6a2b] text-white shadow-sm'
                : 'bg-white border border-[#141414]/15 text-[#141414]/75 hover:border-[#141414]/30 hover:text-[#141414]'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: isSelected ? '#ffffff' : cat.color || '#ff6a2b' }}
            />
            <span>{cat.name}</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                isSelected ? 'bg-white/25 text-white' : 'bg-[#f1ece4] text-[#141414]/70'
              }`}
            >
              {count}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
};
