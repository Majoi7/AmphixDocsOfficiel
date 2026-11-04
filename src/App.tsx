/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
    <BrowserRouter>
      <PageTransitionOverlay />
      <SupabaseConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
      />
      <UpdateToast />
      <InstallPrompt />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminPage />
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
