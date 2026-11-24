import type { GeneratedPreview, PreviewOptions } from './preview-generation';
import { loadModuleWithNotice } from './module-load-error';
import { checkPreviewSignal, withPreviewDeadline } from './preview-resources';

// Ne charger le moteur qu'après conservation du fichier. Après un échec,
// seul un nouvel appel explicite le réessaie, sans rechargement de la page.
let generator: Promise<typeof import('./preview-generation')> | undefined;
export function loadOptionalDocumentPreview(
  source: Blob, fileType: string | null, options: PreviewOptions = {},
): Promise<GeneratedPreview | null> {
  if (fileType !== 'pdf' && fileType !== 'image') return Promise.resolve(null);
  // Cette borne inclut aussi l'import du générateur, avant sa propre file.
  return withPreviewDeadline(async (signal) => {
    const pending: Promise<typeof import('./preview-generation')> = generator ??= loadModuleWithNotice(() => import('./preview-generation'))
      .catch((error) => {
        if (generator === pending) generator = undefined;
        throw error;
      });
    const { generateDocumentPreview } = await pending;
    checkPreviewSignal(signal);
    return generateDocumentPreview(source, fileType, { ...options, signal });
  }, options.signal);
}
