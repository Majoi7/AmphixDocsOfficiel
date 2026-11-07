/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { createBrowserRouter, RouterProvider, Outlet, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PageTransitionOverlay } from './components/PageTransitionOverlay';
import { SupabaseConfigModal } from './components/SupabaseConfigModal';
import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';

import { AdminRoute } from './components/AdminRoute';
import { AdminPage } from './pages/AdminPage';
import { InstallPrompt } from './components/pwa/InstallPrompt';
import { UpdateToast } from './components/pwa/UpdateToast';
import { usePWA } from './hooks/usePWA';

function AppContent() {
  const { isConfigModalOpen, setIsConfigModalOpen } = useAuth();
  const { isOnline } = usePWA();

  // Une coupure réseau ne démonte ni le dashboard ni son formulaire. Le
  // brouillon et les fichiers restent disponibles pour un nouvel essai.
  return (
    <>
      {!isOnline && <p role="status" className="fixed inset-x-4 top-4 z-[45] mx-auto max-w-md rounded-2xl bg-[#141414] p-3 text-center text-sm text-[#f1ece4]">
        Vous êtes hors ligne. Retrouvez une connexion pour envoyer vos fichiers.
      </p>}
      <PageTransitionOverlay />
      <SupabaseConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
      />
      <UpdateToast />
      <InstallPrompt />
      <Outlet />
    </>
  );
}

// Le routeur de données permet de bloquer aussi le retour navigateur pendant
// une écriture, sans bricoler l’historique ni perdre le composant de dépôt.
const router = createBrowserRouter([{
  element: <AppContent />,
  children: [
    { path: '/', element: <LandingPage /> },
    { path: '/dashboard', element: <ProtectedRoute><DashboardPage /></ProtectedRoute> },
    { path: '/admin', element: <AdminRoute><AdminPage /></AdminRoute> },
    { path: '*', element: <Navigate to="/" replace /> },
  ],
}]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
