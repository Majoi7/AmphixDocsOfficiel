import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import { createLeoTransport } from '../lib/leo-client';
import { createLeoSession, type LeoSession } from '../lib/leo-session';
import { getSupabaseClientState, subscribeSupabaseClient } from '../lib/supabase-config';

export function useLeoSession(open: boolean) {
  const { user } = useAuth();
  const { client, generation, config: { url: projectUrl, key: publicKey } } = useSyncExternalStore(
    subscribeSupabaseClient, getSupabaseClientState, getSupabaseClientState,
  );
  const userId = user?.id ?? '';
  const sessionRef = useRef<LeoSession | null>(null);
  const session = useMemo(() => {
    const isCurrent = () => sessionRef.current === controller && !!client && !!userId
      && getSupabaseClientState().generation === generation && getSupabaseClientState().client === client;
    const request = createLeoTransport({
      projectUrl, publicKey, userId, isCurrent,
      getSession: () => client ? client.auth.getSession() : Promise.resolve({ data: { session: null }, error: null }),
      log: import.meta.env.DEV ? (code) => console.warn(`[Léo] ${code}`) : undefined,
    });
    const controller = createLeoSession({ scope: { userId, projectUrl, generation }, isCurrent, request });
    return controller;
  }, [client, generation, projectUrl, publicKey, userId]);
  // La vue de l'ancien compte est invalidée dès le rendu, pas après une réponse.
  sessionRef.current = session;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useLayoutEffect(() => {
    if (!open) session.cancel();
  }, [open, session]);
  useEffect(() => {
    sessionRef.current = session;
    const subscription = client?.auth.onAuthStateChange((event, authSession) => {
      if (event === 'SIGNED_OUT' || authSession?.user.id !== userId) session.clear();
    }).data.subscription;
    return () => {
      subscription?.unsubscribe();
      if (sessionRef.current === session) sessionRef.current = null;
      session.clear();
    };
  }, [client, session, userId]);
  return { session, snapshot };
}
