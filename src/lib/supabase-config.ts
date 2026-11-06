import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export interface ConfigStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface SupabaseConfig {
  url: string;
  key: string;
  status: 'missing' | 'invalid' | 'configured';
  source: 'none' | 'environment' | 'local';
  isConfigured: boolean;
  error: string | null;
  storageWarning: string | null;
}

export interface SupabaseClientState {
  client: SupabaseClient<Database> | null;
  config: SupabaseConfig;
  generation: number;
}

export const SUPABASE_CONFIG_STORAGE_KEY = 'amphix_supabase_config_v1';
const LEGACY_URL_KEY = 'amphix_supabase_url';
const LEGACY_API_KEY = 'amphix_supabase_anon_key';
const STORAGE_WARNING = 'Le stockage du navigateur est indisponible. Une session éventuelle ne sera conservée qu’en mémoire ; elle peut être perdue au rechargement.';

// Validation de FORMAT uniquement : elle ne prouve ni la disponibilité du
// service, ni une session, ni la signature d'une ancienne clé publique JWT.
export function validateSupabaseConfig(urlInput: string, keyInput: string): {
  url: string; key: string; status: SupabaseConfig['status']; error: string | null;
} {
  const url = urlInput.trim();
  const key = keyInput.trim();
  if (!url && !key) return { url, key, status: 'missing', error: null };
  if (!url || !key) {
    return { url, key, status: 'invalid', error: 'Renseignez ensemble l’URL du projet et sa clé API publique. Les sources ne sont jamais mélangées.' };
  }
  const invalid = (error: string) => ({ url, key, status: 'invalid' as const, error });
  if (/votre[-_]?projet|your[-_]?project|placeholder|dummy|xyzcompany|example/i.test(url)
    || /votre[-_]?cl[eé]|your[-_]?(?:anon|public)[-_]?key|placeholder|\.\.\./i.test(key)) {
    return invalid('Remplacez les valeurs d’exemple par l’URL et la clé publique de votre projet.');
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { return invalid('L’URL Supabase est invalide.'); }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHost)) {
    return invalid('Utilisez une URL HTTPS (HTTP est réservé à Supabase local sur localhost).');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    return invalid('Renseignez l’origine du projet, sans identifiants, chemin, paramètres ni fragment.');
  }
  if (key.startsWith('sb_secret_')) {
    return invalid('Une clé privée ne doit jamais être utilisée dans le navigateur. Utilisez la clé publique anon ou publishable.');
  }
  let isPublicKey = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key);
  if (!isPublicKey && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    try {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const decoded: unknown = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
      isPublicKey = typeof decoded === 'object' && decoded !== null && 'role' in decoded && decoded.role === 'anon';
    } catch { /* Une clé malformée reste invalide. */ }
  }
  if (!isPublicKey) {
    return invalid('La clé doit être une clé publique Supabase publishable ou un JWT dont le rôle est anon. Aucun jeton de session ni clé service_role n’est accepté.');
  }
  return { url: parsed.origin, key, status: 'configured', error: null };
}

function fromPair(url: string, key: string, source: SupabaseConfig['source'], storageWarning: string | null = null): SupabaseConfig {
  const checked = validateSupabaseConfig(url, key);
  return { ...checked, source, isConfigured: checked.status === 'configured', storageWarning };
}

// Une paire locale complète prime sur la paire d'environnement. Une paire
// locale invalide n'est pas complétée silencieusement depuis un autre projet.
export function resolveSupabaseConfig(environment: { url: string; key: string }, storage: ConfigStorage | null): SupabaseConfig {
  if (storage) {
    try {
      const stored = storage.getItem(SUPABASE_CONFIG_STORAGE_KEY);
      if (stored !== null) {
        try {
          const pair: unknown = JSON.parse(stored);
          if (typeof pair === 'object' && pair !== null && 'url' in pair && 'key' in pair
            && typeof pair.url === 'string' && typeof pair.key === 'string') {
            return fromPair(pair.url, pair.key, 'local');
          }
        } catch { /* Afficher l'erreur, sans reprendre une ancienne paire. */ }
        return { ...fromPair('', '', 'local'), status: 'invalid', error: 'La configuration locale est illisible. Rétablissez la configuration d’environnement ou enregistrez une paire valide.' };
      }
      const localUrl = storage.getItem(LEGACY_URL_KEY) || '';
      const localKey = storage.getItem(LEGACY_API_KEY) || '';
      if (localUrl || localKey) return fromPair(localUrl, localKey, 'local');
    } catch {
      return fromPair(environment.url, environment.key, environment.url || environment.key ? 'environment' : 'none', STORAGE_WARNING);
    }
  }
  return fromPair(environment.url, environment.key, environment.url || environment.key ? 'environment' : 'none');
}

const environment = {
  url: import.meta.env.VITE_SUPABASE_URL || '',
  key: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
};

function browserStorage(): ConfigStorage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function getStoredSupabaseConfig(): SupabaseConfig {
  try { return resolveSupabaseConfig(environment, browserStorage()); }
  catch { return fromPair(environment.url, environment.key, environment.url || environment.key ? 'environment' : 'none', STORAGE_WARNING); }
}

const subscribers = new Set<() => void>();
let state: SupabaseClientState = { client: null, config: getStoredSupabaseConfig(), generation: 0 };
// Export nullable : aucune instance factice n'est créée pour masquer l'absence
// de configuration. Les opérations utilisent toujours getSupabaseClient().
export let supabase: SupabaseClient<Database> | null = null;

function notify() {
  for (const subscriber of subscribers) subscriber();
}

function noteStorageFailure() {
  if (state.config.storageWarning) return;
  state = { ...state, config: { ...state.config, storageWarning: STORAGE_WARNING } };
  notify();
}

function makeClient(config: SupabaseConfig): SupabaseClient<Database> | null {
  if (!config.isConfigured) return null;
  const memory = new Map<string, string>();
  const safeAuthStorage: ConfigStorage = {
    getItem(key) {
      try { return browserStorage()?.getItem(key) ?? memory.get(key) ?? null; }
      catch { noteStorageFailure(); return memory.get(key) ?? null; }
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        const storage = browserStorage();
        if (storage) storage.setItem(key, value);
      } catch { noteStorageFailure(); }
    },
    removeItem(key) {
      memory.delete(key);
      try { browserStorage()?.removeItem(key); } catch { noteStorageFailure(); }
    },
  };
  return createClient<Database>(config.url, config.key, {
    auth: {
      storage: safeAuthStorage,
      // Une origine distincte ne restaure pas la session d'un autre projet.
      storageKey: `amphixdocs-auth-${new URL(config.url).host}`,
      persistSession: typeof window !== 'undefined',
      autoRefreshToken: typeof window !== 'undefined',
      detectSessionInUrl: typeof window !== 'undefined',
      flowType: 'pkce',
    },
  });
}

function replaceClient(config: SupabaseConfig, nextClient = makeClient(config)) {
  const previous = supabase;
  supabase = nextClient;
  state = { client: nextClient, config, generation: state.generation + 1 };
  // Les contrôleurs d'auth vérifient également cette génération : une réponse
  // de l'ancien client ne peut pas rétablir un compte ou un rôle.
  if (previous) void previous.auth.stopAutoRefresh().catch(() => undefined);
  notify();
  return state;
}

replaceClient(state.config);

export const getSupabaseClientState = () => state;
export function subscribeSupabaseClient(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}
export const isSupabaseConfigured = () => state.config.isConfigured;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!state.client) throw new Error(state.config.error || 'Supabase n’est pas configuré. Renseignez les paramètres publics du projet avant de continuer.');
  return state.client;
}

export function reinitializeSupabase(url: string, key: string): SupabaseClientState {
  const config = fromPair(url, key, 'local');
  if (!config.isConfigured) throw new Error(config.error || 'La configuration Supabase est incomplète.');
  // Enregistrer une paire atomique. Si l'écriture est bloquée, le client et
  // la session actuels restent en place, sans annoncer une sauvegarde réussie.
  const nextClient = makeClient(config);
  try {
    const storage = browserStorage();
    if (!storage) throw new Error('Stockage indisponible');
    storage.setItem(SUPABASE_CONFIG_STORAGE_KEY, JSON.stringify({ url: config.url, key: config.key }));
  } catch {
    if (nextClient) void nextClient.auth.stopAutoRefresh().catch(() => undefined);
    noteStorageFailure();
    throw new Error('Impossible d’enregistrer la configuration dans ce navigateur. Autorisez son stockage ou utilisez les variables d’environnement publiques. Aucun changement de client n’a été effectué.');
  }
  return replaceClient(config, nextClient);
}

export function resetSupabaseConfig(): SupabaseClientState {
  let storage: ConfigStorage | null = null;
  const saved = new Map<string, string | null>();
  try {
    storage = browserStorage();
    if (!storage) throw new Error('Stockage indisponible');
    for (const key of [SUPABASE_CONFIG_STORAGE_KEY, LEGACY_URL_KEY, LEGACY_API_KEY]) {
      saved.set(key, storage.getItem(key));
    }
    for (const key of saved.keys()) storage.removeItem(key);
  } catch {
    // Restauration au mieux si l'accès a été interrompu au milieu de l'action.
    for (const [key, value] of saved) {
      try { if (value !== null) storage?.setItem(key, value); } catch { /* Message explicite ci-dessous. */ }
    }
    noteStorageFailure();
    throw new Error('La configuration locale n’a pas pu être réinitialisée. Vérifiez les autorisations de stockage du navigateur.');
  }
  return replaceClient(fromPair(environment.url, environment.key, environment.url || environment.key ? 'environment' : 'none'));
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && ![SUPABASE_CONFIG_STORAGE_KEY, LEGACY_URL_KEY, LEGACY_API_KEY].includes(event.key)) return;
    const config = getStoredSupabaseConfig();
    if (config.url !== state.config.url || config.key !== state.config.key || config.status !== state.config.status) replaceClient(config);
  });
}
