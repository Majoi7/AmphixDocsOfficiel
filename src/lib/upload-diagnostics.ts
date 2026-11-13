// Diagnostic local et borné : jamais de nom de fichier, saisie, compte, URL,
// octet de document, jeton ou message technique. Aucun affichage dans l'interface.
export const UPLOAD_DIAGNOSTICS_KEY = 'amphixdocs-upload-diagnostics-v1';
export type UploadDiagnosticEvent = 'app-started' | 'selector-opened' | 'file-received' | 'file-saved'
  | 'preview-started' | 'preview-finished' | 'preview-failed';
interface DiagnosticDetails {
  picker?: 'files' | 'gallery' | 'camera';
  count?: number;
  bytes?: number;
}
interface DiagnosticEntry extends DiagnosticDetails {
  event: UploadDiagnosticEvent;
  at: number;
}
const events: UploadDiagnosticEvent[] = ['app-started', 'selector-opened', 'file-received', 'file-saved',
  'preview-started', 'preview-finished', 'preview-failed'];
let started = false;

function readEntries(storage: Storage): DiagnosticEntry[] {
  const raw = storage.getItem(UPLOAD_DIAGNOSTICS_KEY);
  const parsed: unknown = raw && raw.length < 20000 ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) return [];
  // Relire uniquement la liste blanche, même si les données locales ont changé.
  return parsed.slice(-60).flatMap((value: unknown): DiagnosticEntry[] => {
    if (!value || typeof value !== 'object') return [];
    const entry = value as Record<string, unknown>;
    if (!events.includes(entry.event as UploadDiagnosticEvent) || typeof entry.at !== 'number'
      || !Number.isFinite(entry.at) || entry.at <= 0) return [];
    return [{
      event: entry.event as UploadDiagnosticEvent, at: entry.at,
      ...(['files', 'gallery', 'camera'].includes(String(entry.picker))
        ? { picker: entry.picker as DiagnosticDetails['picker'] } : {}),
      ...(typeof entry.count === 'number' && Number.isSafeInteger(entry.count) && entry.count >= 0 ? { count: entry.count } : {}),
      ...(typeof entry.bytes === 'number' && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 ? { bytes: entry.bytes } : {}),
    }];
  });
}

export function logUploadDiagnostic(event: UploadDiagnosticEvent, details: DiagnosticDetails = {}): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.sessionStorage;
    let previous: DiagnosticEntry[] = [];
    try { previous = readEntries(storage); } catch { /* Un ancien journal illisible ne bloque pas le nouveau. */ }
    storage.setItem(UPLOAD_DIAGNOSTICS_KEY, JSON.stringify([...previous.slice(-59), {
      event, at: Date.now(),
      ...(['files', 'gallery', 'camera'].includes(String(details.picker)) ? { picker: details.picker } : {}),
      ...(typeof details.count === 'number' && Number.isSafeInteger(details.count) && details.count >= 0 ? { count: details.count } : {}),
      ...(typeof details.bytes === 'number' && Number.isSafeInteger(details.bytes) && details.bytes >= 0 ? { bytes: details.bytes } : {}),
    }]));
  } catch { /* Le diagnostic ne doit jamais empêcher le démarrage ou le dépôt. */ }
}

export function startUploadDiagnostics(): void {
  if (typeof window === 'undefined' || started) return;
  started = true;
  try {
    const previous = readEntries(window.sessionStorage);
    if (previous.length) console.info('[Dépôt] Journal du démarrage précédent :', previous);
  } catch { /* La console et le stockage ne sont pas nécessaires au démarrage. */ }
  logUploadDiagnostic('app-started');
}
