import type { DocumentItem } from './supabase';

export interface UploadClassification { schoolName: string; subjectName: string }
interface PreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}
const preferenceKey = (userId: string, projectUrl: string) =>
  `amphixdocs-last-classification:${encodeURIComponent(projectUrl)}:${userId}`;
const validLabel = (value: unknown): value is string => typeof value === 'string'
  && value === value.trim() && [...value].length > 0 && [...value].length <= 120;

export function documentTitleFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  const title = dot > 0 && dot < name.length - 1 ? name.slice(0, dot) : name;
  return title.trim() || name;
}
// Préférence facultative, limitée au compte et au projet : son indisponibilité
// ne bloque pas le dépôt. Le journal de reprise a un contrat distinct et strict.
export function readUploadPreference(storage: PreferenceStorage, userId: string, projectUrl: string): UploadClassification | null {
  try {
    const raw = storage.getItem(preferenceKey(userId, projectUrl));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('schoolName' in value) || !('subjectName' in value)
      || !validLabel(value.schoolName) || !validLabel(value.subjectName)) return null;
    return { schoolName: value.schoolName, subjectName: value.subjectName };
  } catch { return null; }
}
export function saveUploadPreference(storage: PreferenceStorage, userId: string, projectUrl: string, value: UploadClassification): boolean {
  if (!validLabel(value.schoolName) || !validLabel(value.subjectName)) return false;
  try {
    storage.setItem(preferenceKey(userId, projectUrl), JSON.stringify({ schoolName: value.schoolName, subjectName: value.subjectName }));
    return true;
  } catch { return false; }
}
export function uploadSuggestions(documents: DocumentItem[], schoolName: string, preference: UploadClassification | null) {
  const active = documents.filter((document) => document.deleted_at === null);
  const schools = new Set(active.flatMap((document) => validLabel(document.school_name) ? [document.school_name] : []));
  const subjects = new Set(active.flatMap((document) => document.school_name === schoolName.trim()
    && validLabel(document.subject_name) ? [document.subject_name] : []));
  if (preference) {
    schools.add(preference.schoolName);
    if (preference.schoolName === schoolName.trim()) subjects.add(preference.subjectName);
  }
  return {
    schools: [...schools].sort((a, b) => a.localeCompare(b, 'fr')),
    subjects: [...subjects].sort((a, b) => a.localeCompare(b, 'fr')),
  };
}
