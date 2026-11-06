import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { Navbar } from '../components/Navbar';
import { Hero } from '../components/Hero';
import { Features } from '../components/Features';
import { HowItWorks } from '../components/HowItWorks';
import { CtaBanner } from '../components/CtaBanner';
import StickerSlapFooter from '../components/ui/sticker-slap-footer';
import { useAuth } from '../context/AuthContext';
import { dashboardUrl } from '../lib/library-navigation';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, signInWithGoogle } = useAuth();
  const reducedMotion = useReducedMotion();

  // Les destinations viennent des props du footer, jamais du texte des liens.
  const handleFooterClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const anchor = e.target instanceof Element ? e.target.closest('a') : null;
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

    const href = anchor.getAttribute('href');
    if (href === '/dashboard' || href?.startsWith('/dashboard?')) {
      e.preventDefault();
      if (user) {
        void navigate(href);
      } else {
        void signInWithGoogle().catch(() => undefined); // L’erreur est affichée par AuthContext.
      }
    } else if (href === '/') {
      e.preventDefault();
      void navigate('/');
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#f1ece4] flex flex-col selection:bg-[#ff6a2b] selection:text-white">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Features />
        <HowItWorks />
        <CtaBanner />
      </main>
      <div onClickCapture={handleFooterClick}>
        <StickerSlapFooter
          wordmark="amphix"
          homeHref="/"
          navLabel=""
          jobsLabel="explorer"
          jobs={[
            { title: "explorer les documents", href: dashboardUrl('explore') },
            { title: "déposer un document", href: dashboardUrl('home', { panel: 'upload' }) },
          ]}
          officeLabel="amphixdocs"
          address={["tes documents,", "enfin bien rangés."]}
          mapLabel=""
          contactLabel="contact"
          email="contact@amphix.site"
          copiedLabel="copié, à bientôt !"
          chatHref="mailto:contact@amphix.site"
          chatLabel="écris-nous un message"
          note="*on préfère les messages aux appels : on te répond vite, par écrit."
          socials={[]}
          credits={[]}
          paper="#f1ece4"
          panel="#4a6cf0"
          ink="#141414"
          accent="#ff6a2b"
        />
      </div>
    </div>
  );
};
