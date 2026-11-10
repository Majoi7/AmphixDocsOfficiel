// Contrat public de Léo, partagé avec le navigateur : aucun secret ni SDK serveur.
export const LEO_MESSAGES = {
  unavailable: 'Léo est indisponible, voici une recherche classique.',
  error: "Léo n'a pas pu répondre. Réessaie dans un instant.",
  quota: 'Tu as fait beaucoup de demandes, réessaie dans quelques minutes.',
  outOfScope: "Je peux seulement t'aider à retrouver des fichiers.",
  invalid: 'Décris le fichier que tu cherches en 500 caractères maximum.',
  auth: 'Reconnecte-toi pour utiliser Léo.',
} as const;

export const LEO_LIMITS = { prompt: 500, candidates: 30, results: 10, keywords: 8 } as const;
export type LeoSort = 'relevance' | 'newest' | 'oldest';
export type LeoFileType = 'examen' | 'cours' | 'exercice' | 'corrige' | 'pdf' | 'image' | 'doc' | 'autre';
export interface LeoPlan {
  keywords: string[];
  school: string | null;
  subject: string | null;
  type: LeoFileType | null;
  period: { from: string | null; to: string | null };
  sort: LeoSort;
  reformulation: string;
}

// Forme affichable dans la grille existante. Jamais envoyée telle quelle au modèle.
export interface LeoDocument {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string | null;
  school_name: string | null;
  subject_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  thumbnail_path: string | null;
  page_count: number | null;
}
export interface LeoExplanation { id: string; text: string }
export interface LeoPlanResponse {
  action: 'plan';
  requestId: string;
  inScope: boolean;
  plan: LeoPlan | null;
  fallback: boolean;
  message?: string;
}
export interface LeoSearchResponse {
  action: 'search';
  requestId: string;
  documents: LeoDocument[];
  fallback: boolean;
  message?: string;
}
export interface LeoRankResponse {
  action: 'rank';
  requestId: string;
  documents: LeoDocument[];
  explanations: LeoExplanation[];
  fallback: boolean;
  message?: string;
}
export type LeoResponse = LeoPlanResponse | LeoSearchResponse | LeoRankResponse;
export type LeoRequest = { action: 'plan'; prompt: string } | {
  action: 'search' | 'rank';
  prompt: string;
  requestId: string;
  plan: LeoPlan;
  fallback: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export const isUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isText = (value: unknown, max: number): value is string => typeof value === 'string'
  && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
function isDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2100-12-31') return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function isLeoPlan(value: unknown): value is LeoPlan {
  if (!isRecord(value) || !hasOnlyKeys(value, ['keywords', 'school', 'subject', 'type', 'period', 'sort', 'reformulation'])) return false;
  return Array.isArray(value.keywords) && value.keywords.length <= LEO_LIMITS.keywords
    && value.keywords.every((word) => isText(word, 60))
    && (value.school === null || isText(value.school, 120))
    && (value.subject === null || isText(value.subject, 120))
    && (value.type === null || ['examen', 'cours', 'exercice', 'corrige', 'pdf', 'image', 'doc', 'autre'].includes(String(value.type)))
    && isRecord(value.period) && hasOnlyKeys(value.period, ['from', 'to'])
    && isDate(value.period.from) && isDate(value.period.to)
    && !(value.period.from && value.period.to && value.period.from > value.period.to)
    && ['relevance', 'newest', 'oldest'].includes(String(value.sort))
    && isText(value.reformulation, 240);
}
export function normalizeLeoPrompt(prompt: string) {
  return prompt.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
}
export function isLeoRequest(value: unknown): value is LeoRequest {
  if (!isRecord(value) || !isText(value.prompt, LEO_LIMITS.prompt)) return false;
  if (value.action === 'plan') return hasOnlyKeys(value, ['action', 'prompt']);
  return (value.action === 'search' || value.action === 'rank')
    && hasOnlyKeys(value, ['action', 'prompt', 'requestId', 'plan', 'fallback'])
    && isUuid(value.requestId) && isLeoPlan(value.plan) && typeof value.fallback === 'boolean';
}

// Ne jamais fabriquer les colonnes d'une base ancienne : échec propre si V6 manque.
export function isLeoDocument(value: unknown): value is LeoDocument {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.user_id) || !isText(value.title, 10000)) return false;
  if (!isText(value.file_name, 10000) || !isText(value.file_path, 10000)
    || !['pending', 'approved', 'rejected'].includes(String(value.status))) return false;
  const nullableStrings = ['description', 'file_type', 'created_at', 'school_name', 'subject_name',
    'rejection_reason', 'reviewed_by', 'reviewed_at', 'deleted_at', 'deleted_by', 'thumbnail_path'];
  if (!nullableStrings.every((key) => value[key] === null || typeof value[key] === 'string')) return false;
  return (value.file_size === null || (typeof value.file_size === 'number' && Number.isFinite(value.file_size) && value.file_size >= 0))
    && (value.page_count === null || (typeof value.page_count === 'number' && Number.isInteger(value.page_count) && value.page_count > 0));
}

// Les seuls champs autorisés vers Gemini. Les valeurs sont des données non fiables.
export function toLeoMetadata(document: LeoDocument) {
  return {
    id: document.id,
    title: document.title.slice(0, 240),
    description: document.description?.slice(0, 200) ?? null,
    school: document.school_name?.slice(0, 120) ?? null,
    subject: document.subject_name?.slice(0, 120) ?? null,
    type: document.file_type?.slice(0, 32) ?? null,
    date: document.created_at?.slice(0, 32) ?? null,
  };
}
