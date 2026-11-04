import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { GoogleIcon } from './GoogleIcon';
import { Loader2, ArrowRight } from 'lucide-react';

export const CtaBanner: React.FC = () => {
  const { user, signInWithGoogle, startPageTransition } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const navigate = useNavigate();

  const handleAuth = async () => {
    try {
      setConnecting(true);
      await signInWithGoogle();
      startPageTransition(() => {
        navigate('/dashboard');
      });
    } catch (err) {
      console.error(err);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <section className="w-full max-w-7xl mx-auto px-6 sm:px-10 py-12 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="w-full rounded-[28px] sm:rounded-[36px] bg-[#4a6cf0] text-[#f1ece4] p-8 sm:p-14 md:p-16 relative overflow-hidden shadow-xl"
      >
        {/* Stickers & formes géométriques décoratives */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-[#ffd23f]/20 rounded-full blur-xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl flex flex-col items-start">
          <span className="inline-block px-3 py-1 rounded-full bg-white/20 text-[#f1ece4] text-xs font-bold mb-4 backdrop-blur-xs">
            Simple. Rapide. Sans distraction.
          </span>

          <h2 className="font-[800] text-3xl sm:text-5xl md:text-6xl tracking-[-0.03em] leading-[1.1] mb-6">
            Prêt à ranger tes documents pour de bon ?
          </h2>

          <p className="text-base sm:text-xl text-[#f1ece4]/85 font-medium mb-10 leading-relaxed">
            Rejoins AmphixDocs et profite d’un espace de stockage minimaliste pensé pour aller vite.
          </p>

          {user ? (
            <motion.div
              whileHover={{ scale: 1.04, rotate: -2 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            >
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-[#ff6a2b] text-white font-extrabold text-lg shadow-[0_8px_24px_rgba(255,106,43,0.45)] hover:bg-[#ff8a4c] transition-colors cursor-pointer"
              >
                <span>Ouvrir mon dashboard</span>
                <ArrowRight className="w-5 h-5 text-white" />
              </button>
            </motion.div>
          ) : (
            <motion.button
              type="button"
              disabled={connecting}
              onClick={handleAuth}
              whileHover={{ scale: 1.04, rotate: -2 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-[#ff6a2b] text-white font-extrabold text-lg shadow-[0_8px_24px_rgba(255,106,43,0.45)] hover:bg-[#ff8a4c] transition-colors cursor-pointer disabled:opacity-75"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-white" />
                  <span>Connexion…</span>
                </>
              ) : (
                <>
                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center p-1">
                    <GoogleIcon className="w-4 h-4" />
                  </div>
                  <span>Commencer avec Google</span>
                </>
              )}
            </motion.button>
          )}
        </div>
      </motion.div>
    </section>
  );
};
