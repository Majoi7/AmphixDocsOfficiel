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
import { OfflinePage } from './components/pwa/OfflinePage';
import { usePWA } from './hooks/usePWA';

function AppContent() {
  const { isConfigModalOpen, setIsConfigModalOpen } = useAuth();
  const { isOnline } = usePWA();

  if (!isOnline) {
    return <OfflinePage onRetry={() => window.location.reload()} />;
  }

  return (
    <>
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
