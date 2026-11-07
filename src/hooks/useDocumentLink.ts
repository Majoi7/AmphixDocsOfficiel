import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import { getDocumentSignedUrl, getSupabaseClientState, subscribeSupabaseClient } from '../lib/supabase';
import { errorMessage } from '../lib/errors';

interface PreparedLink {
  url: string;
  expiresAt: number;
  filePath: string;
  downloadName?: string;
  userId: string;
  generation: number;
}

// Le lien reste en mémoire et n'est ouvert que par un vrai clic sur un lien.
// Il est invalidé au changement de compte/projet et avant son expiration.
export function useDocumentLink(filePath: string, downloadName?: string) {
  const { user } = useAuth();
  const { generation } = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const [prepared, setPrepared] = useState<PreparedLink | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const revision = useRef(0);
  const pendingRequest = useRef<number | null>(null);
  const current = useRef({ filePath, downloadName, userId: user?.id, generation });
  current.current = { filePath, downloadName, userId: user?.id, generation };

  useEffect(() => {
    revision.current += 1;
    pendingRequest.current = null;
    setPrepared(null);
    setLinkError(null);
    setIsPreparing(false);
    return () => { revision.current += 1; };
  }, [filePath, downloadName, user?.id, generation]);

  useEffect(() => {
    if (!prepared) return;
    const timeout = window.setTimeout(() => setPrepared(null), Math.max(0, prepared.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [prepared]);

  const prepareLink = async () => {
    if (pendingRequest.current !== null) return;
    const captured = current.current;
    if (!captured.userId) {
      setLinkError('La session n’est plus disponible. Reconnectez-vous pour ouvrir ce fichier.');
      return;
    }
    const request = ++revision.current;
    pendingRequest.current = request;
    const startedAt = Date.now();
    const isCurrent = () => request === revision.current
      && current.current.filePath === captured.filePath
      && current.current.downloadName === captured.downloadName
      && current.current.userId === captured.userId
      && current.current.generation === captured.generation
      && getSupabaseClientState().generation === captured.generation;
    setIsPreparing(true);
    setLinkError(null);
    setPrepared(null);
    try {
      const url = await getDocumentSignedUrl(captured.filePath, captured.downloadName);
      if (!isCurrent()) return;
      // L'API signe pour 60 s : on retire le lien 5 s plus tôt, en tenant
      // aussi compte du temps passé à attendre la réponse.
      const expiresAt = startedAt + 55_000;
      if (expiresAt <= Date.now()) throw new Error('La préparation du lien a pris trop de temps. Réessayez.');
      setPrepared({ url, expiresAt, filePath: captured.filePath, downloadName: captured.downloadName, userId: captured.userId, generation: captured.generation });
    } catch (error) {
      if (isCurrent()) setLinkError(errorMessage(error, 'Impossible de préparer l’ouverture. Réessayez.'));
    } finally {
      if (pendingRequest.current === request) pendingRequest.current = null;
      if (isCurrent()) setIsPreparing(false);
    }
  };

  const url = prepared && prepared.userId === user?.id && prepared.generation === generation
    && prepared.filePath === filePath && prepared.downloadName === downloadName
    && prepared.expiresAt > Date.now() ? prepared.url : null;
  return { url, isPreparing, linkError, prepareLink };
}
