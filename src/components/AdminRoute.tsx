import React from 'react';
import { Navigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAdmin, sessionLoading, roleLoading, sessionError, roleError, isConfigured,
    retrySession, refreshUserRole, setIsConfigModalOpen } = useAuth();

  // L'accès déjà chargé reste monté pendant une lecture temporairement indisponible.
  // Un vrai changement de rôle est appliqué ; aucune autorisation n'est inventée.
  if (isConfigured && user && isAdmin) return <>{children}</>;
  if (sessionLoading || (user && roleLoading)) return null;

  if (!isConfigured || sessionError || roleError) {
    return (
      <main className="min-h-dvh bg-[#f1ece4] flex flex-col items-center justify-center p-6 gap-4 text-center">
        <AlertCircle className="w-8 h-8 text-[#ff6a2b]" aria-hidden="true" />
        <h1 className="font-extrabold text-xl text-[#141414]">Administration indisponible</h1>
        <p role="alert" className="text-sm text-[#141414]/80 max-w-lg break-words">
          {!isConfigured ? 'Le service est momentanément indisponible. Réessayez plus tard.' : 'L’administration n’a pas pu être ouverte. Réessayez.'}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {isConfigured && <button type="button" onClick={() => { void (sessionError ? retrySession() : refreshUserRole()).catch(() => undefined); }}
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

  if (!user) return <Navigate to="/" replace />;
  return <Navigate to="/dashboard" replace />;
};
