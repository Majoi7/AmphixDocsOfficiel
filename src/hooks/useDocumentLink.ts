import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import { getDocumentSignedUrl, getSupabaseClientState, subscribeSupabaseClient } from '../lib/supabase';
import { userError } from '../lib/errors';

// Chaque clic prépare une signature courte et déclenche le téléchargement.
// Aucune URL n'est conservée ; une réponse d'un ancien compte/projet est ignorée.
export function useDocumentLink(filePath: string, downloadName?: string) {
  const { user } = useAuth();
  const { generation } = useSyncExternalStore(subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState);
  const [isPreparing, setIsPreparing] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const revision = useRef(0);
  const pendingRequest = useRef<number | null>(null);
  const current = useRef({ filePath, downloadName, userId: user?.id, generation });
  current.current = { filePath, downloadName, userId: user?.id, generation };

  useEffect(() => {
    revision.current += 1;
    pendingRequest.current = null;
    setLinkError(null);
    setIsPreparing(false);
    return () => { revision.current += 1; };
  }, [filePath, downloadName, user?.id, generation]);

  const download = async () => {
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
    try {
      const url = await getDocumentSignedUrl(captured.filePath, captured.downloadName);
      if (!isCurrent()) return;
      // L'API signe pour 60 s : ne pas déclencher une URL déjà presque expirée.
      if (startedAt + 55_000 <= Date.now()) throw new Error('La préparation du lien a pris trop de temps. Réessayez.');
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = captured.downloadName ?? '';
      anchor.referrerPolicy = 'no-referrer';
      anchor.hidden = true;
      document.body.appendChild(anchor);
      try {
        // Pas de window.open après await : les bloqueurs de fenêtres mobiles
        // l'empêcheraient. Le paramètre download signé impose aussi l'attachment
        // côté Storage, y compris lorsque le lien est sur une autre origine.
        anchor.click();
      } finally { anchor.remove(); }
    } catch (error) {
      if (isCurrent()) setLinkError(userError(error, 'Impossible de préparer le téléchargement. Réessayez.'));
    } finally {
      if (pendingRequest.current === request) pendingRequest.current = null;
      if (isCurrent()) setIsPreparing(false);
    }
  };

  return { isPreparing, linkError, download };
}
