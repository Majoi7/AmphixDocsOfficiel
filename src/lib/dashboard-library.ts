import type { DocumentItem, DocumentTrashState } from './supabase';
import { mergeUploadReport, type UploadBatchReport } from './upload-batch';
import { userError as errorMessage } from './errors';

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
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
}

type Change = (data: DashboardLibraryData) => DashboardLibraryData;

// État atomique et limité à un compte/projet. Les confirmations reçues pendant
// une lecture sont réappliquées à sa réponse. Une lecture ultérieure reste
// l'autorité sur les droits et les fichiers devenus absents.
export function createDashboardLibraryController(dependencies: {
  scope: DashboardLibraryScope;
  isCurrent: () => boolean;
  read: (offset: number) => Promise<DashboardLibraryData>;
  // Projection des seules confirmations locales ; la requête SQL filtre la liste.
  matches?: (document: DocumentItem) => boolean;
}) {
  const scope = { ...dependencies.scope };
  const listeners = new Set<() => void>();
  let snapshot: DashboardLibrarySnapshot = { documents: [], loading: true, loadingMore: false, hasMore: false, error: null };
  let requestNumber = 0;
  let reading = false;
  let changes: Change[] = [];
  let nextOffset = 0;
  let paginationDirty = false;
  let mutationVersion = 0;
  const pageSize = 20;
  // Un rapport cumulatif ancien ne doit pas annuler une édition, une mise en
  // corbeille, une restauration ou l'absence constatée lors d'une relecture.
  const handledDocumentIds = new Set<string>();

  const publish = (next: DashboardLibrarySnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const project = (data: DashboardLibraryData): DashboardLibraryData => ({
    documents: dependencies.matches ? data.documents.filter(dependencies.matches) : data.documents,
  });
  const confirm = (change: Change): boolean => {
    if (!dependencies.isCurrent()) return false;
    paginationDirty = true;
    mutationVersion++;
    if (reading) changes.push(change);
    publish({ ...snapshot, ...project(change(snapshot)) });
    return true;
  };
  const readPage = async (append: boolean): Promise<void> => {
    if (!dependencies.isCurrent()) return;
    const request = ++requestNumber;
    const offset = append ? nextOffset : 0;
    reading = true;
    changes = [];
    const startedMutationVersion = mutationVersion;
    if (!append) paginationDirty = true;
    publish({ ...snapshot, loading: !append, loadingMore: append, error: null });
    try {
      const data = await dependencies.read(offset);
      if (request !== requestNumber || !dependencies.isCurrent()) return;
      if (data.documents.length > pageSize) throw new Error('La liste est indisponible. Réessayez.');
      const seen = new Set(snapshot.documents.map((document) => document.id));
      const base = append
        ? { documents: [...snapshot.documents, ...data.documents.filter((document) => !seen.has(document.id))] }
        : data;
      const reconciled = project(changes.reduce((current, change) => change(current), base));
      nextOffset = offset + data.documents.length;
      paginationDirty = mutationVersion !== startedMutationVersion;
      reading = false;
      changes = [];
      publish({ ...reconciled, loading: false, loadingMore: false, hasMore: data.documents.length === pageSize, error: null });
    } catch (error) {
      if (request !== requestNumber || !dependencies.isCurrent()) return;
      reading = false;
      changes = [];
      publish({ ...snapshot, loading: false, loadingMore: false, error: errorMessage(error, 'Impossible de charger la bibliothèque. Réessayez.') });
    }
  };

  return {
    isCurrent: dependencies.isCurrent,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: () => readPage(false),
    async loadMore(): Promise<void> {
      if (reading || !snapshot.hasMore || !dependencies.isCurrent()) return;
      // Une mutation peut décaler tous les offsets : repartir de la première
      // page plutôt que sauter silencieusement un fichier.
      await readPage(!paginationDirty);
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
