import { createClient } from '@supabase/supabase-js';
import { createGemini } from './gemini.ts';
import { createLeoHandler, databaseError, LeoHttpError, type LeoBackend } from './handler.ts';

// Ce module est déployé dans Deno, jamais importé par src/. Le contrat et le
// moteur pur sont contrôlés aussi par TypeScript/Node ; deno check contrôle ici.
const url = Deno.env.get('SUPABASE_URL');
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
const handler = createLeoHandler({
  generate: createGemini({ apiKey: Deno.env.get('GEMINI_API_KEY'), model: Deno.env.get('GEMINI_MODEL') }),
  log: Deno.env.get('LEO_DEBUG') === 'true' ? (event) => console.warn(event) : undefined,
  async authenticate(token, signal): Promise<LeoBackend> {
    if (!url || !publicKey) throw new LeoHttpError(503, 'error');
    // Pas de client privilégié. Toutes les lectures PostgreSQL portent le JWT
    // de la personne, même l'ultime relecture après le classement par Gemini.
    const client = createClient(url, publicKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) => fetch(input, { ...init, signal: init?.signal
          ? AbortSignal.any([signal, init.signal]) : signal }),
      },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) throw new LeoHttpError(401, 'auth');
    const userId = data.user.id;
    const columns = 'id,user_id,title,description,file_name,file_path,file_type,file_size,created_at,school_name,subject_name,status,rejection_reason,reviewed_by,reviewed_at,deleted_at,deleted_by,thumbnail_path,page_count';
    return {
      userId,
      async begin() {
        const { data, error } = await client.rpc('leo_begin_request');
        if (error) databaseError(error);
        return data;
      },
      async advance(id, action, fingerprint, candidates) {
        const { data, error } = await client.rpc('leo_advance_request', {
          p_request_id: id, p_action: action, p_fingerprint: fingerprint ?? null, p_candidate_ids: candidates ?? null,
        });
        if (error) databaseError(error);
        return data;
      },
      async search(plan) {
        const { data, error } = await client.rpc('leo_search_documents', {
          p_keywords: plan.keywords, p_school: plan.school, p_subject: plan.subject, p_type: plan.type,
          p_from: plan.period.from, p_to: plan.period.to, p_sort: plan.sort,
        }).select(columns);
        if (error) databaseError(error);
        return data;
      },
      async read(ids) {
        const { data, error } = await client.from('documents').select(columns).in('id', ids)
          .is('deleted_at', null).or(`status.eq.approved,user_id.eq.${userId}`).limit(30);
        if (error) databaseError(error);
        return data;
      },
    };
  },
});
Deno.serve(handler);
