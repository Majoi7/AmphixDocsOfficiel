import type { DocumentItem } from './supabase';
import type { GeneratedPreview, PreviewOptions } from './preview-generation';
import { checkPreviewSignal } from './preview-resources';

export function needsDocumentPreview(document: DocumentItem): boolean {
  return document.deleted_at === null && (document.file_type === 'pdf' || document.file_type === 'image')
    && (!document.thumbnail_path || (document.file_type === 'pdf' && !document.page_count));
}
export function assertPreviewIdentity(expected: DocumentItem, actual: DocumentItem): void {
  if (expected.id !== actual.id || expected.user_id !== actual.user_id || expected.file_path !== actual.file_path
    || expected.file_type !== actual.file_type || actual.deleted_at !== null) {
    throw new Error('Le fichier n’est plus disponible pour cet aperçu.');
  }
}
// Appliquer une confirmation sans rétablir un ancien titre, statut ou fichier
// mis en corbeille pendant la génération. Les aperçus V6/V9 sont immuables.
export function mergeDocumentPreview(existing: DocumentItem, confirmed: DocumentItem): DocumentItem {
  if (existing.deleted_at !== null || confirmed.deleted_at !== null
    || existing.id !== confirmed.id || existing.user_id !== confirmed.user_id
    || existing.file_path !== confirmed.file_path || existing.file_type !== confirmed.file_type
    || (confirmed.file_type !== 'pdf' && confirmed.file_type !== 'image')
    || needsDocumentPreview(confirmed)
    || (confirmed.page_count !== null && (!Number.isSafeInteger(confirmed.page_count) || confirmed.page_count < 1))
    || (confirmed.file_type === 'image' && confirmed.page_count !== null && confirmed.page_count !== 1)
    || (existing.thumbnail_path !== null && existing.thumbnail_path !== confirmed.thumbnail_path)
    || (existing.page_count !== null && existing.page_count !== confirmed.page_count)) return existing;
  if (existing.thumbnail_path === confirmed.thumbnail_path && existing.page_count === confirmed.page_count) return existing;
  return { ...existing, thumbnail_path: confirmed.thumbnail_path, page_count: confirmed.page_count };
}

export interface PreviewCompletionDependencies {
  check: () => void;
  read: () => Promise<DocumentItem>;
  source: (document: DocumentItem) => Promise<Blob>;
  generate: (source: Blob, type: string | null, options: PreviewOptions) => Promise<GeneratedPreview | null>;
  save: (document: DocumentItem, preview: GeneratedPreview) => Promise<DocumentItem>;
}

// L'identité est relue avant le travail ; save relit encore avant l'association.
// Aucun succès n'est synthétisé à partir du seul transfert Storage.
export async function finishDocumentPreview(
  expected: DocumentItem, dependencies: PreviewCompletionDependencies, source?: Blob, signal?: AbortSignal
): Promise<DocumentItem> {
  const check = () => { checkPreviewSignal(signal); dependencies.check(); };
  check();
  const document = await dependencies.read();
  check();
  assertPreviewIdentity(expected, document);
  if (!needsDocumentPreview(document)) return document;
  const blob = source ?? await dependencies.source(document);
  check();
  if (blob.size < 1 || blob.size > 20 * 1024 * 1024 || (document.file_size !== null && blob.size !== document.file_size)) {
    throw new Error('Le contenu du fichier ne correspond pas à celui attendu.');
  }
  const preview = await dependencies.generate(blob, document.file_type, { signal, thumbnail: !document.thumbnail_path });
  check();
  if (!preview || !Number.isSafeInteger(preview.pageCount) || preview.pageCount < 1
    || (document.file_type === 'image' && preview.pageCount !== 1)) throw new Error('Aperçu incomplet.');
  const confirmed = await dependencies.save(document, preview);
  check();
  assertPreviewIdentity(document, confirmed);
  if (needsDocumentPreview(confirmed)) throw new Error('L’aperçu n’a pas été confirmé.');
  return confirmed;
}
