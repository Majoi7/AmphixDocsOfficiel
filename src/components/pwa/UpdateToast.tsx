import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { RefreshCw } from 'lucide-react';
import { MODULE_LOAD_ERROR_EVENT, manuallyRefreshApp } from '../../lib/module-load-error';

// Le SW est retiré : cette notice concerne uniquement un module indisponible.
// Aucun effet, événement de visibilité ou changement de contrôleur ne recharge.
export const UpdateToast: React.FC = () => {
  const reducedMotion = useReducedMotion();
  const [failed, setFailed] = useState(() => document.documentElement.dataset.moduleLoadError === 'true');

  useEffect(() => {
    const show = () => setFailed(true);
    window.addEventListener(MODULE_LOAD_ERROR_EVENT, show);
    if (document.documentElement.dataset.moduleLoadError === 'true') show();
    document.documentElement.dataset.appMounted = 'true';
    window.dispatchEvent(new Event('amphixdocs:app-mounted'));
    return () => window.removeEventListener(MODULE_LOAD_ERROR_EVENT, show);
  }, []);

  return <AnimatePresence>
    {failed && <motion.aside
      role="status"
      initial={reducedMotion ? false : { y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { y: -16, opacity: 0 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', damping: 24, stiffness: 300 }}
      className="fixed left-4 right-4 top-[max(1rem,env(safe-area-inset-top))] z-[80] mx-auto flex max-w-sm flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/20 bg-[#4a6cf0] p-4 text-white shadow-xl"
    >
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        <p className="font-bold">Une partie de l’application n’a pas pu être chargée.</p>
        <p className="mt-1 text-white/80">Le brouillon déjà enregistré reste sur cet appareil.</p>
      </div>
      <button type="button" onClick={manuallyRefreshApp}
        className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-white px-4 text-xs font-extrabold text-[#4a6cf0] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
        <RefreshCw size={16} aria-hidden="true" />Actualiser
      </button>
    </motion.aside>}
  </AnimatePresence>;
};
