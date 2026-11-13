import type { GeneratedPreview, PreviewOptions } from './preview-generation';
import { loadModuleWithNotice } from './module-load-error';
import { checkPreviewSignal, withPreviewDeadline } from './preview-resources';

// Ne charger le moteur qu'après conservation du fichier. Un module manquant
// reste en échec jusqu'à « Actualiser », sans boucle de nouveaux imports.
let generator: Promise<typeof import('./preview-generation')> | undefined;
export function loadOptionalDocumentPreview(
  source: Blob, fileType: string | null, options: PreviewOptions = {},
): Promise<GeneratedPreview | null> {
  if (fileType !== 'pdf' && fileType !== 'image') return Promise.resolve(null);
  // Cette borne inclut aussi l'import du générateur, avant sa propre file.
  return withPreviewDeadline(async (signal) => {
    generator ??= loadModuleWithNotice(() => import('./preview-generation'));
    const { generateDocumentPreview } = await generator;
    checkPreviewSignal(signal);
    return generateDocumentPreview(source, fileType, { ...options, signal });
  }, options.signal);
}
