import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

const STEPS = [
  {
    title: 'Connectez-vous avec Google',
    description: 'Utilisez votre compte Google existant. Aucun mot de passe à créer.',
  },
  {
    title: 'Déposez vos fichiers',
    description:
      'Glissez vos documents (20 Mo maximum chacun), ajoutez un titre et, si vous le souhaitez, une courte note.',
  },
  {
    title: 'Consultez et téléchargez',
    description:
      'Une fois validé par l’équipe, ouvrez ou téléchargez chaque document en un clic, via un lien sécurisé à durée limitée.',
  },
];

export const HowItWorks: React.FC = () => {
  const reduceMotion = useReducedMotion();

  return (
    <section className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-10 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-[24px] bg-[#4a6cf0] text-[#f1ece4] px-6 sm:px-12 py-12 sm:py-16"
      >
        <div className="max-w-xl mb-10 sm:mb-14">
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.1] mb-4">
            Comment ça marche
          </h2>
          <p className="text-base sm:text-lg text-[#f1ece4]/85 leading-relaxed">
            De la connexion à la consultation, en trois étapes.
          </p>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-3 gap-8 sm:gap-10">
          {STEPS.map((step, idx) => (
            <li key={step.title} className="flex flex-col items-start">
              <span
                className="w-10 h-10 rounded-full bg-[#f1ece4] text-[#141414] flex items-center justify-center text-base font-extrabold mb-5"
                aria-hidden="true"
              >
                {idx + 1}
              </span>
              <h3 className="text-xl font-extrabold tracking-[-0.02em] mb-2">
                {step.title}
              </h3>
              <p className="text-base text-[#f1ece4]/85 leading-relaxed">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </motion.div>
    </section>
  );
};
