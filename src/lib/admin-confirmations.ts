import type { DocumentItem, UserProfile } from './supabase';
import type { UserRole } from './database.types';

export interface ModerationIntent {
  documentIds: readonly string[];
  status: 'approved' | 'rejected';
  rejectionReason?: string;
}

// Une relecture décrit l'état présent, pas la personne à l'origine de la mutation.
// Les éléments absents, en corbeille ou modérés autrement ne sont jamais un succès.
export function inspectModerationResult(intent: ModerationIntent, documents: readonly DocumentItem[]) {
  const ids = [...new Set(intent.documentIds)];
  const byId = new Map(documents.map((document) => [document.id, document]));
  const confirmedIds: string[] = [];
  const pendingIds: string[] = [];
  const differentIds: string[] = [];
  const unavailableIds: string[] = [];
  for (const id of ids) {
    const document = byId.get(id);
    if (!document || document.deleted_at !== null) {
      unavailableIds.push(id);
    } else if (document.status === intent.status && (intent.status !== 'rejected'
      || document.rejection_reason === (intent.rejectionReason?.trim() || null))) {
      confirmedIds.push(id);
    } else if (document.status === 'pending') {
      pendingIds.push(id);
    } else {
      differentIds.push(id);
    }
  }
  return {
    complete: ids.length > 0 && confirmedIds.length === ids.length,
    confirmedIds, pendingIds, differentIds, unavailableIds,
  };
}

export function inspectRoleResult(profileId: string, expectedRole: UserRole, users: readonly UserProfile[]) {
  const profile = users.find((item) => item.id === profileId);
  if (!profile) return 'unavailable' as const;
  return profile.role === expectedRole ? 'confirmed' as const : 'different' as const;
}
