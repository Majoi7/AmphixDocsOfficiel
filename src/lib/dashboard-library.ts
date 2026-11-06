import type { DocumentItem, DocumentTrashState } from './supabase';
import { mergeUploadReport, type UploadBatchReport } from './upload-batch';
import { errorMessage } from './errors';

export interface DashboardLibraryData {
  documents: DocumentItem[];
}
export interface DashboardLibraryScope {
  userId: string;
  projectUrl: string;
  generation: number;
}
export interface DashboardLibrarySnapshot extends DashboardLibraryData {
  loading: boolean;
  error: string | null;
}

type Change = (data: DashboardLibraryData) => DashboardLibraryData;

// État atomique et limité à un compte/projet. Les confirmations reçues pendant
// une lecture sont réappliquées à sa réponse. Une lecture ultérieure reste
// l'autorité sur les droits et les fichiers devenus absents.
export function createDashboardLibraryController(dependencies: {
  scope: DashboardLibraryScope;
  isCurrent: () => boolean;
  read: () => Promise<DashboardLibraryData>;
}) {
  const scope = { ...dependencies.scope };
  const listeners = new Set<() => void>();
  let snapshot: DashboardLibrarySnapshot = { documents: [], loading: true, error: null };
  let requestNumber = 0;
  let reading = false;
  let changes: Change[] = [];
  // Un rapport cumulatif ancien ne doit pas annuler une édition, une mise en
  // corbeille, une restauration ou l'absence constatée lors d'une relecture.
  const handledDocumentIds = new Set<string>();

  const publish = (next: DashboardLibrarySnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const confirm = (change: Change): boolean => {
    if (!dependencies.isCurrent()) return false;
    if (reading) changes.push(change);
    publish({ ...snapshot, ...change(snapshot) });
    return true;
  };

  return {
    isCurrent: dependencies.isCurrent,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refresh(): Promise<void> {
      if (!dependencies.isCurrent()) return;
      const request = ++requestNumber;
      reading = true;
      changes = [];
      publish({ ...snapshot, loading: true, error: null });
      try {
        const data = await dependencies.read();
        if (request !== requestNumber || !dependencies.isCurrent()) return;
        const reconciled = changes.reduce((current, change) => change(current), data);
        reading = false;
        changes = [];
        publish({ ...reconciled, loading: false, error: null });
      } catch (error) {
        if (request !== requestNumber || !dependencies.isCurrent()) return;
        reading = false;
        changes = [];
        publish({ ...snapshot, loading: false, error: errorMessage(error, 'Impossible de charger la bibliothèque. Réessayez.') });
      }
    },
    cancelPending() {
      requestNumber++;
      reading = false;
      changes = [];
    },
    applyUploadReport(report: UploadBatchReport): boolean {
      if (!dependencies.isCurrent() || report.userId !== scope.userId || report.projectUrl !== scope.projectUrl
        || report.generation !== scope.generation
        || report.documents.some((document) => document.user_id !== scope.userId)) return false;
      const documents = report.documents.filter((document) => !handledDocumentIds.has(document.id));
      report.documents.forEach((document) => handledDocumentIds.add(document.id));
      if (documents.length === 0) return true;
      return confirm((data) => mergeUploadReport(data, { ...report, documents }));
    },
    updateDocumentMetadata(id: string, title: string, description: string): boolean {
      if (!dependencies.isCurrent()) return false;
      handledDocumentIds.add(id);
      return confirm((data) => ({
        documents: data.documents.map((existing) => existing.id === id
          ? { ...existing, title: title.trim(), description: description.trim() || null }
          : existing),
      }));
    },
    // À appeler seulement avec l'état retourné par la RPC, jamais à la place de
    // sa confirmation. Les octets et le statut de modération restent inchangés.
    setDocumentTrash(state: DocumentTrashState): boolean {
      if (!dependencies.isCurrent()) return false;
      handledDocumentIds.add(state.id);
      return confirm((data) => ({
        documents: data.documents.map((existing) => existing.id === state.id
          ? { ...existing, deleted_at: state.deleted_at, deleted_by: state.deleted_by }
          : existing),
      }));
    },
    removeDocument(id: string): boolean {
      // Retrait d'une vue après perte d'accès confirmée ; aucune suppression SQL
      // ou Storage. Conservé pour la réconciliation et les tests du contrôleur.
      if (!dependencies.isCurrent()) return false;
      handledDocumentIds.add(id);
      return confirm((data) => ({ documents: data.documents.filter((document) => document.id !== id) }));
    },
  };
}
