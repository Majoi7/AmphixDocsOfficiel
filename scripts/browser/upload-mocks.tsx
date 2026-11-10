import { useSyncExternalStore } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import type { SupabaseClientState, SupabaseConfig } from '../../src/lib/supabase-config';
import type { DocumentItem, UploadDocumentRequest, UploadStage } from '../../src/lib/supabase';

// Ce module n'est résolu que par le build de test, jamais par celui de l'application.
// Aucun .env, compte réel, jeton réel ou serveur Supabase n'est utilisé.
export const TEST_PROJECT_URL = 'https://upload-browser.invalid';
export const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const requestedUser = new URLSearchParams(location.search).get('account');
let user = { id: requestedUser && /^[0-9a-f-]{36}$/i.test(requestedUser) ? requestedUser : TEST_USER_ID };
const authListeners = new Set<() => void>();
const clientListeners = new Set<() => void>();
let forbiddenSdkCalls = 0;
const makeClient = (url: string) => createClient<Database>(url, 'sb_publishable_browser_tests_only_00000000000000000000', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async () => { forbiddenSdkCalls++; throw new Error('Réseau interdit dans ce test local.'); } },
});
const makeConfig = (url: string): SupabaseConfig => ({
  url, key: '', status: 'configured', source: 'local', isConfigured: true, error: null, storageWarning: null,
});
let state: SupabaseClientState = {
  client: makeClient(TEST_PROJECT_URL), generation: 1,
  config: makeConfig(TEST_PROJECT_URL),
};
export let supabase = state.client;
export const getSupabaseClientState = () => state;
export const getStoredSupabaseConfig = () => state.config;
export const isSupabaseConfigured = () => true;
export const getSupabaseClient = () => {
  if (!state.client) throw new Error('Client de test indisponible.');
  return state.client;
};
export const subscribeSupabaseClient = (listener: () => void) => {
  clientListeners.add(listener);
  return () => { clientListeners.delete(listener); };
};
export function setFixtureProject(url: string) {
  if (!/^https:\/\/[a-z-]+\.invalid$/.test(url)) throw new Error('Seules les origines fictives sont autorisées.');
  state = { client: makeClient(url), config: makeConfig(url), generation: state.generation + 1 };
  supabase = state.client;
  clientListeners.forEach((listener) => listener());
}
export const reinitializeSupabase = () => { throw new Error('Configuration réelle interdite dans ce test.'); };
export const resetSupabaseConfig = () => { throw new Error('Configuration réelle interdite dans ce test.'); };
export function setFixtureUser(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Identifiant de test invalide.');
  user = { id };
  authListeners.forEach((listener) => listener());
}
export function useAuth() {
  const current = useSyncExternalStore((listener) => {
    authListeners.add(listener);
    return () => { authListeners.delete(listener); };
  }, () => user, () => user);
  return { user: current };
}
export const fixtureUser = () => user.id;
export const fixtureNetworkAttempts = () => forbiddenSdkCalls;

export const transportCalls: { request: UploadDocumentRequest; mode: string; hasFile: boolean }[] = [];
let failNextTransfer = false;
let transportGate: Promise<void> | null = null;
let releaseTransfer: (() => void) | null = null;
export function failFixtureTransfer() { failNextTransfer = true; }
export function holdFixtureTransfer() {
  transportGate = new Promise<void>((resolve) => { releaseTransfer = resolve; });
}
export function releaseFixtureTransfer() {
  releaseTransfer?.();
  releaseTransfer = null;
  transportGate = null;
}
export async function fixtureUpload(
  request: UploadDocumentRequest, file: File | undefined, onStage: (stage: UploadStage) => void,
  projectUrl: string, mode: 'initial' | 'resume',
): Promise<DocumentItem> {
  transportCalls.push({ request: structuredClone(request), mode, hasFile: !!file });
  const generation = state.generation;
  onStage('verification');
  if (failNextTransfer) {
    failNextTransfer = false;
    throw new Error('Échec de transfert fictif, sans réseau.');
  }
  if (transportGate) await transportGate;
  if (user.id !== request.userId || state.generation !== generation || state.config.url !== projectUrl) {
    throw Object.assign(new Error('Le compte de test a changé.'), { kind: 'scope' });
  }
  if (!file) throw new Error('Pièce jointe de test absente.');
  onStage('transfert');
  onStage('enregistrement');
  const document: DocumentItem = {
    id: request.identity.id, user_id: request.userId, title: request.title, description: request.description,
    file_name: request.fileName, file_path: request.identity.filePath, file_type: request.fileType, file_size: request.fileSize,
    school_name: request.schoolName, subject_name: request.subjectName, status: 'pending',
    created_at: '2026-01-01T00:00:00.000Z', rejection_reason: null, reviewed_by: null, reviewed_at: null,
    deleted_at: null, deleted_by: null, thumbnail_path: null, page_count: null,
  };
  onStage('termine');
  return document;
}
