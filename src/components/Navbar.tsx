import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleIcon } from './GoogleIcon';
import { Loader2 } from 'lucide-react';

export const Navbar: React.FC = () => {
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

  const goToDashboard = () => {
    startPageTransition(() => {
      navigate('/dashboard');
    });
  };

  return (
    <header className="safe-top sticky top-0 z-40 w-full bg-[#f1ece4]/90 backdrop-blur border-b border-[#141414]/10">
      <div className="w-full min-w-0 max-w-6xl mx-auto px-4 sm:px-8 min-h-16 flex items-center justify-between gap-2">
        <Link
          to="/"
          className="text-xl font-extrabold tracking-[-0.02em] select-none rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ff6a2b]"
          aria-label="AmphixDocs, retour à l'accueil"
        >
          <span className="text-[#141414]">Amphix</span>
          <span className="text-[#ff6a2b]">Docs</span>
        </Link>

        {user ? (
          <button
            type="button"
            onClick={goToDashboard}
            className="inline-flex min-w-0 items-center justify-center min-h-10 px-3 sm:px-5 py-2 rounded-full bg-[#4a6cf0] text-[#f1ece4] text-sm font-semibold hover:bg-[#3d5ed8] hover:-rotate-2 active:scale-95 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]"
          >
            <span className="sm:hidden">Bibliothèque</span>
            <span className="hidden sm:inline">Ouvrir le dashboard</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={connecting}
            onClick={handleAuth}
            className="inline-flex items-center gap-2.5 h-10 px-4 rounded-full bg-white text-[#141414] text-sm font-semibold hover:-rotate-2 active:scale-95 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]"
          >
            {connecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#141414]/55" />
                <span>Connexion…</span>
              </>
            ) : (
              <>
                <GoogleIcon className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Se connecter avec Google</span>
                <span className="sm:hidden">Connexion</span>
              </>
            )}
          </button>
        )}
      </div>
    </header>
  );
};
