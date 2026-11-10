import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import { getDocumentThumbnailUrls, type DocumentItem } from '../lib/supabase';
import { getSupabaseClientState, subscribeSupabaseClient } from '../lib/supabase-config';
import { userError } from '../lib/errors';

interface SignedThumbnails {
  scope: string;
  pathsKey: string;
  urls: Record<string, string>;
  expiresAt: number;
}

// Une signature groupée pour les chemins manquants, jamais dans chaque carte. Les URL
// sont éphémères, en mémoire seulement et inutilisables dans un nouveau scope.
export function useDocumentThumbnails(documents: readonly DocumentItem[]) {
  const { user } = useAuth();
  const { generation } = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const scope = `${generation}:${user?.id || ''}`;
  const pathsKey = JSON.stringify([...new Set(documents.flatMap((item) => item.deleted_at === null && item.thumbnail_path ? [item.thumbnail_path] : []))].sort());
  const [signed, setSigned] = useState<SignedThumbnails | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const current = useRef(scope);
  current.current = scope;
  const cache = useRef<SignedThumbnails | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paths: string[] = JSON.parse(pathsKey);
    const isCurrent = () => !cancelled && current.current === scope && getSupabaseClientState().generation === generation;
    setFailure(null);
    if (!user?.id || paths.length === 0) {
      cache.current = null;
      setSigned(null);
      setPending(null);
      return;
    }
    const actorId = user.id;
    setPending(scope);
    const previous = cache.current;
    const reusable = previous?.scope === scope && previous.expiresAt > Date.now() + 15_000 ? previous : null;
    const missing = paths.filter((path) => !reusable?.urls[path]);
    const startedAt = Date.now();
    const run = async () => {
      try {
        const received = missing.length ? await getDocumentThumbnailUrls(missing, actorId) : {};
        if (!isCurrent()) return;
        const expiresAt = Math.min(startedAt + 110_000, reusable?.expiresAt ?? Infinity);
        if (expiresAt <= Date.now()) throw new Error('Le chargement a pris trop de temps.');
        const urls = Object.fromEntries(paths.flatMap((path) => {
          const url = received[path] || reusable?.urls[path];
          return url ? [[path, url]] : [];
        }));
        const next = { scope, pathsKey, urls, expiresAt };
        cache.current = next;
        setSigned(next);
        if (paths.some((path) => !urls[path])) setFailure({ scope, message: 'Certains aperçus sont indisponibles. Réessayez.' });
        timer = setTimeout(() => {
          if (!isCurrent()) return;
          cache.current = null;
          setSigned(null);
          setRevision((value) => value + 1);
        }, Math.max(0, expiresAt - Date.now()));
      } catch (cause) {
        if (isCurrent()) {
          cache.current = null;
          setSigned(null);
          setFailure({ scope, message: userError(cause, 'Aperçus indisponibles. Réessayez.') });
        }
      } finally { if (isCurrent()) setPending(null); }
    };
    void run();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [scope, generation, user?.id, pathsKey, revision]);
  const valid = signed?.scope === scope && signed.expiresAt > Date.now();
  return {
    urls: valid ? Object.fromEntries(Object.entries(signed.urls).filter(([path]) => (JSON.parse(pathsKey) as string[]).includes(path))) : {},
    loading: pending === scope,
    error: failure?.scope === scope ? failure.message : null,
    retry: () => { cache.current = null; setRevision((value) => value + 1); },
  };
}
