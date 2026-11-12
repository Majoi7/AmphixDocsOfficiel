// Les formats annoncés par le sélecteur et les types envoyés à Storage restent
// explicites. Android/Drive peuvent fournir une extension sans File.type.
export const MAX_UPLOAD_FILE_SIZE = 20 * 1024 * 1024;
export const IMAGE_COMPRESSION_THRESHOLD = 1.5 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 2048;
export const IMAGE_JPEG_QUALITY = 0.82;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
  tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', rtf: 'application/rtf',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pages: 'application/vnd.apple.pages',
};
export const UPLOAD_FILE_ACCEPT = [
  '.pdf', 'application/pdf', 'image/*', '.heic', '.heif',
  '.doc', '.docx', '.odt', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt', '.pptx', '.odp', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt', '.md', '.csv', '.rtf', 'text/plain', 'text/markdown', 'text/csv', 'application/rtf',
  '.xls', '.xlsx', '.pages',
].join(',');
export const UPLOAD_IMAGE_ACCEPT = 'image/*,.heic,.heif';

export function inferUploadMimeType(fileName: string, mimeType = ''): string {
  const provided = mimeType.trim().toLowerCase().split(';')[0];
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  if (provided && provided !== 'application/octet-stream' && provided !== 'binary/octet-stream') return provided;
  return Object.hasOwn(MIME_BY_EXTENSION, extension) ? MIME_BY_EXTENSION[extension] : 'application/octet-stream';
}
export function isHeicOrHeif(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /^image\/(heic|heif)(?:-sequence)?$/i.test(file.type);
}
export function isSupportedUploadFile(file: Pick<File, 'name' | 'type'>): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = inferUploadMimeType(file.name, file.type);
  return Object.hasOwn(MIME_BY_EXTENSION, extension) || mime.startsWith('image/')
    || Object.values(MIME_BY_EXTENSION).includes(mime);
}
export function normalizeUploadFile(file: File): File {
  if (!file.name || !isSupportedUploadFile(file)) throw new Error('Choisissez un PDF, une image, un document Word, PowerPoint ou texte.');
  if (file.size > MAX_UPLOAD_FILE_SIZE) throw new Error('Chaque fichier est limité à 20 Mo. Choisissez un fichier plus léger.');
  const type = inferUploadMimeType(file.name, file.type);
  return type === file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
}
export function imageOutputDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Cette image ne peut pas être lue. Choisissez une autre image.');
  const ratio = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}
export interface ImagePreparationTools {
  decode: (file: File) => Promise<DecodedImage>;
  encode: (image: DecodedImage, dimensions: { width: number; height: number }, quality: number) => Promise<Blob>;
}
const browserImageTools: ImagePreparationTools = {
  decode: async (file) => {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      } catch { /* Safari et certains formats nécessitent Image. */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Cette image ne peut pas être préparée. Choisissez un JPEG ou un PNG.'));
        image.src = url;
      });
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  },
  encode: async (image, dimensions, quality) => {
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    try {
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('La préparation des images est indisponible. Choisissez un JPEG plus léger.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Cette image ne peut pas être préparée. Choisissez une autre image.')),
        'image/jpeg', quality
      ));
    } finally { canvas.width = 0; canvas.height = 0; }
  },
};

// À appeler uniquement pour une NOUVELLE sélection, avant l'UUID et le SHA-256.
// Une reprise réutilise exactement les octets du brouillon : pas de recompression.
export async function prepareMobileUploadFile(file: File, tools: ImagePreparationTools = browserImageTools): Promise<File> {
  const normalized = normalizeUploadFile(file);
  if (!normalized.type.startsWith('image/') || normalized.size <= IMAGE_COMPRESSION_THRESHOLD) return normalized;
  let image: DecodedImage | undefined;
  try {
    image = await tools.decode(normalized);
    const blob = await tools.encode(image, imageOutputDimensions(image.width, image.height), IMAGE_JPEG_QUALITY);
    if (blob.type !== 'image/jpeg' || blob.size === 0 || blob.size > MAX_UPLOAD_FILE_SIZE) throw new Error('Cette image ne peut pas être préparée. Choisissez un JPEG plus léger.');
    // Ne jamais remplacer un original par une conversion plus lourde.
    if (blob.size >= normalized.size) return normalized;
    const stem = normalized.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${stem}.jpg`, { type: 'image/jpeg', lastModified: normalized.lastModified });
  } catch (error) {
    // HEIC/HEIF : tenter le codec natif sans rendre son absence bloquante.
    // L'original reste accepté ; aucune conversion universelle n'est promise.
    if (isHeicOrHeif(normalized)) return normalized;
    throw error;
  } finally { image?.release(); }
}
