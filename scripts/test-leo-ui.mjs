import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Vrai composant rendu côté serveur : aucun Supabase, aucune configuration .env.
let vite, chain;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false,
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  chain = await vite.ssrLoadModule('/src/components/ui/chain-of-thought.tsx');
});
after(async () => { await vite?.close(); });

function header(props) {
  return renderToStaticMarkup(createElement(chain.AiChainOfThought, {}, createElement(chain.AiChainOfThoughtHeader, props)));
}
function text(markup) { return markup.replace(/<[^>]*>/g, ''); }

test('compteur terminé : un seul texte visible et accessible « 3/3 étapes »', () => {
  const markup = header({ stepCount: 3, completedCount: 3 });
  assert.equal(text(markup), 'Réflexion de Léo3/3 étapes');
  assert.doesNotMatch(markup, /sr-only|terminées sur|3\/33/);
  assert.match(markup, /<span[^>]*tabular-nums[^>]*>3\/3 étapes<\/span>/);
  assert.match(markup, /<button[^>]*aria-expanded="true"/);
});
test('compteur : progression, bornes, singulier et total absent', () => {
  for (const [props, expected] of [
    [{ stepCount: 3, completedCount: 0 }, '0/3 étapes'],
    [{ stepCount: 3, completedCount: 2 }, '2/3 étapes'],
    [{ stepCount: 3, completedCount: 99 }, '3/3 étapes'],
    [{ stepCount: 3.8, completedCount: -1 }, '0/3 étapes'],
    [{ stepCount: 1, completedCount: 1 }, '1/1 étape'],
    [{ stepCount: 3 }, '3 étapes'],
    [{ stepCount: 3, completedCount: NaN }, '3 étapes'],
    [{ completedCount: 3 }, ''],
    [{ stepCount: Infinity, completedCount: 3 }, ''],
  ]) assert.equal(text(header(props)), `Réflexion de Léo${expected}`);
});
