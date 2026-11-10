import { isRecord } from '../_shared/leo-contract.ts';
import { withLeoSignal } from '../_shared/leo-abort.ts';

export interface GeminiOptions {
  apiKey: string | undefined;
  model: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createGemini(options: GeminiOptions) {
  return async (instruction: string, schema: unknown, data: unknown, signal: AbortSignal): Promise<unknown> => {
    // Le modèle est exclusivement un secret configurable, jamais une valeur codée en dur.
    const { apiKey, model } = options;
    if (!apiKey || !model || !/^[a-z0-9][a-z0-9.-]{0,99}$/i.test(model)) throw new Error('gemini_not_configured');
    const combined = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 8500)]);
    return withLeoSignal(combined, async () => {
      const response = await (options.fetch ?? fetch)(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          signal: combined,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instruction }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(data) }] }],
            generationConfig: {
              responseMimeType: 'application/json', responseJsonSchema: schema,
              temperature: 0, candidateCount: 1, maxOutputTokens: 3072,
            },
          }),
        },
      );
      combined.throwIfAborted();
      // Aucun corps d'erreur Gemini (potentiellement sensible) n'est renvoyé ni logué.
      if (!response.ok) throw new Error(response.status === 429 ? 'gemini_quota' : 'gemini_unavailable');
      const text = await response.text();
      combined.throwIfAborted();
      if (text.length > 80000) throw new Error('gemini_response_too_large');
      const body: unknown = JSON.parse(text);
      if (!isRecord(body) || !Array.isArray(body.candidates) || body.candidates.length !== 1) throw new Error('gemini_response_invalid');
      const candidate = body.candidates[0];
      if (!isRecord(candidate) || candidate.finishReason !== 'STOP' || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) throw new Error('gemini_response_incomplete');
      const parts = candidate.content.parts.filter((part) => isRecord(part) && part.thought !== true);
      if (!parts.length || parts.some((part) => !isRecord(part) || typeof part.text !== 'string')) throw new Error('gemini_response_invalid');
      return JSON.parse(parts.map((part) => (part as { text: string }).text).join(''));
    });
  };
}
