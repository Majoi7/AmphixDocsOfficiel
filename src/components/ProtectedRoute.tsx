import React from 'react';
import { Navigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, sessionLoading, sessionError, isConfigured, retrySession, setIsConfigModalOpen } = useAuth();

  // Une session déjà ouverte garde sa page et son formulaire, même si une
  // lecture de profil échoue. Les droits restent contrôlés par les RLS des API.
  if (isConfigured && user) return <>{children}</>;
  // Première restauration uniquement, sans écran « Vérification de connexion ».
  if (sessionLoading) return null;

  if (!isConfigured || sessionError) {
    return (
      <main className="min-h-dvh bg-[#f1ece4] flex flex-col items-center justify-center p-6 text-center gap-4">
        <AlertCircle className="w-8 h-8 text-[#ff6a2b]" aria-hidden="true" />
        <h1 className="font-extrabold text-xl text-[#141414]">Connexion indisponible</h1>
        <p role="alert" className="text-sm text-[#141414]/80 max-w-lg break-words">
          {!isConfigured ? 'Le service est momentanément indisponible. Réessayez plus tard.' : 'Votre session n’a pas pu être ouverte. Réessayez.'}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {isConfigured && <button type="button" onClick={() => { void retrySession().catch(() => undefined); }}
            className="px-5 py-3 rounded-full bg-[#ff6a2b] text-white text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]">
            Réessayer
          </button>}
          <button type="button" onClick={() => setIsConfigModalOpen(true)}
            className="px-5 py-3 rounded-full border-2 border-[#141414]/30 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]">
            Aide à la connexion
          </button>
        </div>
      </main>
    );
  }

  return <Navigate to="/" replace />;
};
