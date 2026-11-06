import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { GoogleIcon } from './GoogleIcon';
import PixelBackground from './ui/hero-with-pixelbackground-utils/pixel-background';
import { Timeline, TimelineText } from './ui/hero-with-pixelbackground-utils/timeline';

const FONT =
  "'DM Sans', 'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const EASE = [0.22, 1, 0.36, 1] as const;

export const Hero: React.FC = () => {
  const { user, signInWithGoogle, startPageTransition } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

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

  const showHowItWorks = () => {
    const target = document.getElementById('comment-ca-marche');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
  };

  const fade = (delay: number, y = 16) => ({
    initial: { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : y },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reducedMotion ? 0 : 0.6, delay: reducedMotion ? 0 : delay, ease: EASE },
  });

  return (
    <section
      style={{ fontFamily: FONT }}
      className="relative w-full overflow-clip bg-[#f1ece4] text-[#141414]"
    >
      {/* Fond de pixels qui s'estompe vers le bas */}
      <div
        className="absolute inset-x-0 top-0 h-72 pointer-events-none"
        style={{
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
        }}
      >
        <PixelBackground
          gap={6}
          speed={60}
          colors="#4a6cf0,#9ab8ff,#c9d4fb,#ff6a2b"
          opacity={0.45}
          direction="top"
          className="w-full h-full"
        />
      </div>

      <div className="relative flex min-h-[calc(100svh-4rem)] min-w-0 flex-col items-center justify-center px-4 sm:px-6 py-14">
        <motion.p
          {...fade(0, -12)}
          className="mb-8 flex items-center gap-3 text-sm font-semibold text-[#141414]/55"
        >
          <span>Cours</span>
          <span className="h-px w-8 bg-[#141414]/25" />
          <span>Épreuves</span>
        </motion.p>

        <motion.h1
          {...fade(0.15, 20)}
          className="flex min-w-0 max-w-full flex-col items-center gap-1 text-center text-[clamp(2.25rem,10.5vw,3rem)] md:text-7xl lg:text-8xl font-extrabold tracking-[-0.04em] leading-[1.02]"
        >
          <span>Vos cours</span>
          <span>et vos épreuves,</span>
          <span className="mt-2">
            <Timeline
              rotation={-1.2}
              initialLeft={0}
              introFrom={70}
              minWidth={30}
              className="border-y-2 border-[#ff6a2b]/50"
              containerClassName="bg-[#f1ece4]"
              handleClassName="bg-[#f1ece4] border-[#ff6a2b]"
              handleIndicatorClassName="bg-[#ff6a2b]"
            >
              <TimelineText className="px-5 py-1 text-[#4a6cf0]">par matière.</TimelineText>
            </Timeline>
          </span>
        </motion.h1>

        <motion.p
          {...fade(0.4, 12)}
          className="mt-12 max-w-lg text-center text-base sm:text-lg leading-relaxed text-[#141414]/65"
        >
          Retrouvez les supports de cours et les anciennes épreuves de votre filière,
          et partagez les vôtres avec les autres étudiants.
        </motion.p>

        <motion.div
          {...fade(0.55, 12)}
          className="mt-10 flex w-full max-w-full flex-col sm:w-auto sm:flex-row items-stretch sm:items-center gap-3"
        >
          {user ? (
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="inline-flex items-center justify-center min-h-12 min-w-0 px-4 sm:px-7 py-3 rounded-full bg-[#4a6cf0] text-[#f1ece4] text-base font-semibold hover:bg-[#3d5ed8] hover:-rotate-2 active:scale-95 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#ff6a2b]"
            >
              Ouvrir mes documents
            </button>
          ) : (
            <button
              type="button"
              disabled={connecting}
              onClick={handleAuth}
              className="inline-flex items-center justify-center gap-3 min-h-12 min-w-0 px-4 sm:px-7 py-3 rounded-full bg-[#4a6cf0] text-[#f1ece4] text-base font-semibold hover:bg-[#3d5ed8] hover:-rotate-2 active:scale-95 transition cursor-pointer disabled:opacity-70 disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#ff6a2b]"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Connexion…</span>
                </>
              ) : (
                <>
                  <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center shrink-0">
                    <GoogleIcon className="w-4 h-4" />
                  </span>
                  <span>Continuer avec Google</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={showHowItWorks}
            className="inline-flex items-center justify-center min-h-12 min-w-0 px-4 sm:px-7 py-3 rounded-full bg-white text-[#141414] text-base font-semibold hover:-rotate-2 active:scale-95 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#ff6a2b]"
          >
            Voir comment ça marche
          </button>
        </motion.div>

        <motion.p
          {...fade(0.7, 8)}
          className="mt-6 flex max-w-full items-center gap-2 text-sm text-[#141414]/55"
        >
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span>Connexion sécurisée, sans mot de passe</span>
        </motion.p>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-[#141414]/15 to-transparent" />
    </section>
  );
};
