import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Hero } from '../components/Hero';
import { Features } from '../components/Features';
import { HowItWorks } from '../components/HowItWorks';
import { CtaBanner } from '../components/CtaBanner';
import StickerSlapFooter from '../components/ui/sticker-slap-footer';
import { useAuth } from '../context/AuthContext';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, signInWithGoogle } = useAuth();

  // Adapter l'info-bulle d'accessibilité en français pour le bouton copier email sans modifier le composant
  useEffect(() => {
    const updateEmailTooltip = () => {
      const copyBtn = document.querySelector<HTMLButtonElement>('.ssf-copy');
      if (copyBtn && copyBtn.getAttribute('title') !== "Copier l'adresse e-mail") {
        copyBtn.setAttribute('title', "Copier l'adresse e-mail");
      }
    };
    updateEmailTooltip();
    const observer = new MutationObserver(updateEmailTooltip);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Interception des clics pour naviguer via React Router sans rechargement ou déclencher Google Auth
  const handleFooterClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (href === '/dashboard') {
      e.preventDefault();
      e.stopPropagation();
      const linkText = anchor.textContent?.trim().toLowerCase() || '';
      const isUploadLink = linkText.includes('déposer');
      if (user) {
        navigate('/dashboard', { state: isUploadLink ? { openUpload: true } : undefined });
      } else {
        signInWithGoogle();
      }
    } else if (href === '/') {
      e.preventDefault();
      e.stopPropagation();
      navigate('/');
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
            { title: "mes documents", href: "/dashboard" },
            { title: "déposer un document", href: "/dashboard" },
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
