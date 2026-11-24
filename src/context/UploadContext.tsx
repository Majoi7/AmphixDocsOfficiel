import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { UploadModal } from '../components/UploadModal';
import { useLibraryNavigation } from '../hooks/useLibraryNavigation';
import type { DocumentItem } from '../lib/supabase';
import type { UploadBatchReport } from '../lib/upload-batch';
import { useAuth } from './AuthContext';

interface DashboardUploadTarget {
  userId: string;
  generation: number;
  documents: DocumentItem[];
  onSuccess: (report: UploadBatchReport) => void;
}
type RegisterUploadTarget = (target: DashboardUploadTarget) => () => void;
const UploadContext = createContext<RegisterUploadTarget | null>(null);
const emptyDocuments: DocumentItem[] = [];

// Sous le routeur (blocker/navigation), mais AU-DESSUS de ProtectedRoute et
// AdminRoute. Le même composant et ses File restent vivants pendant leurs rendus.
export function UploadProvider({ children }: { children: ReactNode }) {
  const { user, userRole, sessionError, roleError, isConfigured } = useAuth();
  const { pathname } = useLocation();
  const navigation = useLibraryNavigation();
  const targetRef = useRef<DashboardUploadTarget | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>(emptyDocuments);
  const register = useCallback<RegisterUploadTarget>((target) => {
    targetRef.current = target;
    setDocuments(target.documents);
    return () => {
      if (targetRef.current !== target) return;
      targetRef.current = null;
      setDocuments(emptyDocuments);
    };
  }, []);
  const reportSuccess = useCallback((report: UploadBatchReport) => {
    const target = targetRef.current;
    if (!target || target.userId !== report.userId || target.generation !== report.generation) {
      throw new Error('Le dépôt est conservé. Rouvrez la bibliothèque pour actualiser les fichiers sans les renvoyer.');
    }
    target.onSuccess(report);
  }, []);
  return <UploadContext.Provider value={register}>
    {children}
    {createPortal(<UploadModal
      isOpen={isConfigured && !!user && userRole !== null && !sessionError && !roleError
        && pathname === '/dashboard' && navigation.panel === 'upload'}
      onClose={navigation.closePanel} documents={documents} onSuccess={reportSuccess}
    />, document.body)}
  </UploadContext.Provider>;
}

// Le dashboard ne possède plus le modal : il ne raccorde que sa bibliothèque
// courante. Son démontage retire cette cible, pas les fichiers du formulaire.
export function useDashboardUpload(target: DashboardUploadTarget): void {
  const register = useContext(UploadContext);
  if (!register) throw new Error('Le dashboard doit être placé dans UploadProvider.');
  const { userId, generation, documents, onSuccess } = target;
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;
  const reportSuccess = useCallback((report: UploadBatchReport) => successRef.current(report), []);
  useEffect(() => register({ userId, generation, documents, onSuccess: reportSuccess }),
    [register, userId, generation, documents, reportSuccess]);
}
