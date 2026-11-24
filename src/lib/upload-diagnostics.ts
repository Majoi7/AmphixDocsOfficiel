import type { AuthChangeEvent } from '@supabase/supabase-js';

// Identité du chargement du document, pas d'un montage React ou d'une session.
export const UPLOAD_PAGE_LOAD_ID = globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
// Diagnostic local et borné : jamais de nom de fichier, saisie, compte, URL,
// octet de document, jeton ou message technique. Aucun affichage dans l'interface.
export const UPLOAD_DIAGNOSTICS_KEY = 'amphixdocs-upload-diagnostics-v1';
export type UploadDiagnosticEvent = 'app-started' | 'upload-mounted' | 'upload-unmounted'
  | 'auth-event' | 'selector-opened' | 'selector-returned' | 'selector-restored'
  | 'file-received' | 'file-saved' | 'preview-started' | 'preview-finished' | 'preview-failed';
type NavigationType = 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown';
interface DiagnosticDetails {
  picker?: 'files' | 'gallery' | 'camera';
  count?: number;
  bytes?: number;
  authEvent?: AuthChangeEvent;
  previousPageLoadId?: string;
}
interface DiagnosticEntry extends DiagnosticDetails {
  event: UploadDiagnosticEvent;
  at: number;
  pageLoadId?: string;
  navigationType?: NavigationType;
  wasDiscarded?: boolean;
}
const events: UploadDiagnosticEvent[] = ['app-started', 'upload-mounted', 'upload-unmounted',
  'auth-event', 'selector-opened', 'selector-returned', 'selector-restored', 'file-received', 'file-saved',
  'preview-started', 'preview-finished', 'preview-failed'];
const authEvents: AuthChangeEvent[] = ['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED',
  'USER_UPDATED', 'PASSWORD_RECOVERY', 'MFA_CHALLENGE_VERIFIED'];
const navigationTypes: NavigationType[] = ['navigate', 'reload', 'back_forward', 'prerender', 'unknown'];
const validPageId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
let started = false;
const pageWasDiscarded = () => typeof document !== 'undefined'
  && 'wasDiscarded' in document && document.wasDiscarded === true;

export function wasUploadPickerReloaded(
  marker: { pageLoadId?: string } | null | undefined,
  currentPageLoadId = UPLOAD_PAGE_LOAD_ID,
  wasDiscarded = pageWasDiscarded(),
): boolean {
  // Un ancien marqueur sans identifiant ne prouve pas un rechargement.
  return !!marker && (wasDiscarded || !!marker.pageLoadId && marker.pageLoadId !== currentPageLoadId);
}
function navigationType(): NavigationType {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry && navigationTypes.includes(entry.type) ? entry.type : 'unknown';
  } catch { return 'unknown'; }
}
function safeDetails(value: Record<string, unknown>): DiagnosticDetails {
  return {
    ...(['files', 'gallery', 'camera'].includes(String(value.picker))
      ? { picker: value.picker as DiagnosticDetails['picker'] } : {}),
    ...(typeof value.count === 'number' && Number.isSafeInteger(value.count) && value.count >= 0 ? { count: value.count } : {}),
    ...(typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0 ? { bytes: value.bytes } : {}),
    ...(authEvents.includes(value.authEvent as AuthChangeEvent) ? { authEvent: value.authEvent as AuthChangeEvent } : {}),
    ...(validPageId(value.previousPageLoadId) ? { previousPageLoadId: value.previousPageLoadId } : {}),
  };
}
function readEntries(storage: Storage): DiagnosticEntry[] {
  const raw = storage.getItem(UPLOAD_DIAGNOSTICS_KEY);
  const parsed: unknown = raw && raw.length < 30000 ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) return [];
  // Relire uniquement la liste blanche, même si les données locales ont changé.
  return parsed.slice(-60).flatMap((value: unknown): DiagnosticEntry[] => {
    if (!value || typeof value !== 'object') return [];
    const entry = value as Record<string, unknown>;
    if (!events.includes(entry.event as UploadDiagnosticEvent) || typeof entry.at !== 'number'
      || !Number.isFinite(entry.at) || entry.at <= 0) return [];
    return [{
      event: entry.event as UploadDiagnosticEvent, at: entry.at, ...safeDetails(entry),
      ...(validPageId(entry.pageLoadId) ? { pageLoadId: entry.pageLoadId } : {}),
      ...(navigationTypes.includes(entry.navigationType as NavigationType) ? { navigationType: entry.navigationType as NavigationType } : {}),
      ...(typeof entry.wasDiscarded === 'boolean' ? { wasDiscarded: entry.wasDiscarded } : {}),
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
      event, at: Date.now(), pageLoadId: UPLOAD_PAGE_LOAD_ID,
      navigationType: navigationType(), wasDiscarded: pageWasDiscarded(),
      ...safeDetails({ ...details }),
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
