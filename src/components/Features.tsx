import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { UploadCloud, Search, FolderTree } from 'lucide-react';

const FEATURES = [
  {
    icon: UploadCloud,
    title: 'Déposer',
    description:
      'Glissez vos fichiers et suivez l’envoi en temps réel. Chaque fichier peut peser jusqu’à 20 Mo.',
  },
  {
    icon: Search,
    title: 'Retrouver',
    description:
      'Recherchez par titre, description ou nom de fichier. Les résultats s’affichent au fil de la frappe.',
  },
  {
    icon: FolderTree,
    title: 'Organiser',
    description:
      'Classez vos documents par dossier et par catégorie. Chaque type de fichier a son étiquette.',
  },
];

export const Features: React.FC = () => {
  const reduceMotion = useReducedMotion();

  return (
    <section className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="max-w-xl mb-10 sm:mb-12">
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.1] text-[#141414] mb-4">
            Trois gestes, et c’est rangé.
          </h2>
          <p className="text-base sm:text-lg text-[#141414]/65 leading-relaxed">
            Une interface qui va à l’essentiel : déposer un fichier, le retrouver, le classer.
          </p>
        </div>

        <ul className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {FEATURES.map((item) => {
            const Icon = item.icon;
            return (
              <li
                key={item.title}
                className="bg-white rounded-[24px] p-7 sm:p-8 flex flex-col"
              >
                <div className="w-11 h-11 rounded-full bg-[#4a6cf0] text-[#f1ece4] flex items-center justify-center mb-6">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-2xl font-extrabold tracking-[-0.02em] text-[#141414] mb-2">
                  {item.title}
                </h3>
                <p className="text-base text-[#141414]/65 leading-relaxed">
                  {item.description}
                </p>
              </li>
            );
          })}
        </ul>
      </motion.div>
    </section>
  );
};
