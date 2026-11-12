import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Outils image injectés : on vérifie le protocole, pas un codec navigateur réel.
// Aucun réseau, aucune configuration Vite d'application, aucun fichier .env.
const root = fileURLToPath(new URL('../', import.meta.url));
const originalFetch = globalThis.fetch;
let server;
let library;
let networkAttempts = 0;
const lastModified = 1760000000000;

before(async () => {
  globalThis.fetch = async () => { networkAttempts++; throw new Error('Réseau interdit dans les tests de fichiers.'); };
  server = await createServer({
    root, configFile: false, envDir: false, optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  });
  library = await server.ssrLoadModule('/src/lib/upload-files.ts');
});
after(async () => {
  try { await server?.close(); assert.equal(networkAttempts, 0); }
  finally { globalThis.fetch = originalFetch; }
});

const fixture = (name = 'photo.png', size = 4, type = 'image/png') =>
  new File([new Uint8Array(size).fill(7)], name, { type, lastModified });
const forbiddenTools = {
  decode: async () => { assert.fail('Ce fichier ne doit pas être décodé ni compressé.'); },
  encode: async () => { assert.fail('Ce fichier ne doit pas être réencodé.'); },
};
function imageTools(overrides = {}) {
  const calls = [];
  const image = { source: {}, width: 4096, height: 2048, release: () => calls.push(['release']) };
  return {
    calls, image,
    tools: {
      decode: async (file) => { calls.push(['decode', file]); return image; },
      encode: async (decoded, dimensions, quality) => {
        calls.push(['encode', decoded, dimensions, quality]);
        return new Blob(['jpeg-local'], { type: 'image/jpeg' });
      },
      ...overrides,
    },
  };
}

test('le sélecteur annonce explicitement PDF, images, Word, PowerPoint, texte et HEIC/HEIF', () => {
  const accepted = library.UPLOAD_FILE_ACCEPT.split(',');
  for (const value of ['.pdf', 'application/pdf', 'image/*', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.heic', '.heif']) {
    assert.ok(accepted.includes(value), `Format annoncé : ${value}`);
  }
  assert.equal(library.UPLOAD_IMAGE_ACCEPT, 'image/*,.heic,.heif');
  assert.equal(library.MAX_UPLOAD_FILE_SIZE, 20 * 1024 * 1024);
});

test('un MIME Android vide ou générique est inféré depuis une extension insensible à la casse', () => {
  for (const mime of ['', 'application/octet-stream', 'BINARY/OCTET-STREAM']) {
    assert.equal(library.inferUploadMimeType('Cours.PDF', mime), 'application/pdf');
    assert.equal(library.inferUploadMimeType('Photo.HEIC', mime), 'image/heic');
    assert.equal(library.inferUploadMimeType('Sujet.PPTX', mime), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  }
  assert.equal(library.inferUploadMimeType('sans-extension', ''), 'application/octet-stream');
  assert.equal(library.inferUploadMimeType('document', ' APPLICATION/PDF; charset=utf-8 '), 'application/pdf');
});

test('les propriétés héritées ne sont pas des extensions autorisées', () => {
  for (const extension of ['toString', 'constructor', '__proto__', 'valueOf']) {
    assert.equal(library.inferUploadMimeType(`fichier.${extension}`), 'application/octet-stream');
    assert.equal(library.isSupportedUploadFile({ name: `fichier.${extension}`, type: '' }), false);
  }
  assert.equal(library.isSupportedUploadFile({ name: 'programme.exe', type: '' }), false);
});

test('normaliser le MIME conserve les octets, le nom et la date du fichier', async () => {
  const original = fixture('Cours.PDF', 32, '');
  const normalized = library.normalizeUploadFile(original);
  assert.equal(normalized.type, 'application/pdf');
  assert.equal(normalized.name, original.name);
  assert.equal(normalized.lastModified, lastModified);
  assert.deepEqual(await normalized.arrayBuffer(), await original.arrayBuffer());
  const typed = fixture('cours.pdf', 4, 'application/pdf');
  assert.equal(library.normalizeUploadFile(typed), typed);
});

test('les fichiers inconnus et les originaux de plus de 20 Mo sont refusés avant décodage', async () => {
  await assert.rejects(library.prepareMobileUploadFile(fixture('programme.exe', 4, ''), forbiddenTools), /Choisissez un PDF/);
  await assert.rejects(library.prepareMobileUploadFile(fixture('photo.png', library.MAX_UPLOAD_FILE_SIZE + 1), forbiddenTools), /limité à 20 Mo/);
  assert.equal(library.normalizeUploadFile(fixture('cours.pdf', library.MAX_UPLOAD_FILE_SIZE, 'application/pdf')).size, library.MAX_UPLOAD_FILE_SIZE);
});

test('les PDF restent inchangés même au-dessus du seuil image', async () => {
  const original = fixture('cours.pdf', 2 * 1024 * 1024, 'application/pdf');
  const prepared = await library.prepareMobileUploadFile(original, forbiddenTools);
  assert.equal(prepared, original);
  assert.deepEqual(await prepared.arrayBuffer(), await original.arrayBuffer());
});

test('HEIC et HEIF restent acceptés si le codec natif est indisponible', async () => {
  for (const [name, type] of [['photo.HEIC', ''], ['photo.heif', 'application/octet-stream'], ['photo.bin', 'image/heic-sequence']]) {
    const original = fixture(name, 2 * 1024 * 1024, type);
    const calls = [];
    const tools = {
      decode: async (file) => { calls.push(file); throw new Error('Codec HEIC indisponible dans ce navigateur.'); },
      encode: async () => { assert.fail('Un fichier non décodé ne doit pas être réencodé.'); },
    };
    const prepared = await library.prepareMobileUploadFile(original, tools);
    assert.equal(calls.length, 1);
    assert.equal(prepared.name, original.name);
    assert.equal(prepared.lastModified, lastModified);
    assert.ok(library.isHeicOrHeif(prepared));
    assert.deepEqual(await prepared.arrayBuffer(), await original.arrayBuffer());
  }
});

test('un HEIC décodable est compressé, sinon son original est conservé sans fuite de ressources', async () => {
  const original = fixture('photo.HEIC', 2 * 1024 * 1024, '');
  const available = imageTools();
  const compressed = await library.prepareMobileUploadFile(original, available.tools);
  assert.equal(compressed.name, 'photo.jpg');
  assert.equal(compressed.type, 'image/jpeg');
  assert.equal(compressed.lastModified, lastModified);
  assert.ok(compressed.size < original.size);
  assert.deepEqual(available.calls.map(([name]) => name), ['decode', 'encode', 'release']);
  const unavailable = imageTools({ encode: async () => { throw new Error('Encodage HEIC indisponible.'); } });
  const unchanged = await library.prepareMobileUploadFile(original, unavailable.tools);
  assert.deepEqual(await unchanged.arrayBuffer(), await original.arrayBuffer());
  assert.equal(unchanged.name, original.name);
  assert.equal(unavailable.calls.filter(([name]) => name === 'release').length, 1);
});

test('une conversion de taille égale ou supérieure ne remplace pas l’image originale', async () => {
  const original = fixture('photo.png', library.IMAGE_COMPRESSION_THRESHOLD + 1);
  for (const size of [original.size, original.size + 1]) {
    const { tools, calls } = imageTools({ encode: async () => new Blob([new Uint8Array(size)], { type: 'image/jpeg' }) });
    const prepared = await library.prepareMobileUploadFile(original, tools);
    assert.equal(prepared, original);
    assert.equal(calls.filter(([name]) => name === 'release').length, 1);
  }
});

test('le seuil de compression est strictement supérieur à 1,5 Mo', async () => {
  assert.equal(library.IMAGE_COMPRESSION_THRESHOLD, 1.5 * 1024 * 1024);
  for (const size of [library.IMAGE_COMPRESSION_THRESHOLD - 1, library.IMAGE_COMPRESSION_THRESHOLD]) {
    const original = fixture('photo.png', size);
    assert.equal(await library.prepareMobileUploadFile(original, forbiddenTools), original);
  }
  const { tools, calls } = imageTools();
  await library.prepareMobileUploadFile(fixture('photo.png', library.IMAGE_COMPRESSION_THRESHOLD + 1), tools);
  assert.deepEqual(calls.map(([name]) => name), ['decode', 'encode', 'release']);
});

test('le JPEG préparé utilise 2048 px, qualité 0,82 et garde la date avant toute identité de dépôt', async () => {
  const { tools, calls, image } = imageTools();
  const result = await library.prepareMobileUploadFile(fixture('été.photo.PNG', 2 * 1024 * 1024, ''), tools);
  assert.equal(calls[0][1].type, 'image/png');
  assert.deepEqual(calls[1], ['encode', image, { width: 2048, height: 1024 }, 0.82]);
  assert.equal(result.name, 'été.photo.jpg');
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.lastModified, lastModified);
  assert.equal(await result.text(), 'jpeg-local');
  assert.equal(calls.filter(([name]) => name === 'release').length, 1);
});

test('les dimensions portrait, paysage et petites images gardent leur ratio sans agrandissement', () => {
  for (const [width, height, expected] of [
    [4096, 2048, { width: 2048, height: 1024 }],
    [2048, 4096, { width: 1024, height: 2048 }],
    [800, 600, { width: 800, height: 600 }],
    [1, 4096, { width: 1, height: 2048 }],
  ]) assert.deepEqual(library.imageOutputDimensions(width, height), expected);
  for (const dimensions of [[0, 1], [1, -1], [NaN, 2], [2, Infinity]]) {
    assert.throws(() => library.imageOutputDimensions(...dimensions), /image ne peut pas être lue/);
  }
});

test('une erreur de décodage ne produit pas un fichier présenté comme préparé', async () => {
  const { tools, calls } = imageTools({ decode: async () => { throw new Error('Décodage simulé refusé.'); } });
  await assert.rejects(library.prepareMobileUploadFile(fixture('photo.png', 2 * 1024 * 1024), tools), /Décodage simulé refusé/);
  assert.deepEqual(calls, []);
});

test('une erreur d’encodage libère quand même l’image décodée', async () => {
  const { tools, calls } = imageTools({ encode: async () => { throw new Error('Encodage simulé refusé.'); } });
  await assert.rejects(library.prepareMobileUploadFile(fixture('photo.png', 2 * 1024 * 1024), tools), /Encodage simulé refusé/);
  assert.deepEqual(calls.map(([name]) => name), ['decode', 'release']);
});

test('des dimensions invalides libèrent l’image sans encoder', async () => {
  const { tools, calls, image } = imageTools();
  image.width = 0;
  await assert.rejects(library.prepareMobileUploadFile(fixture('photo.png', 2 * 1024 * 1024), tools), /image ne peut pas être lue/);
  assert.deepEqual(calls.map(([name]) => name), ['decode', 'release']);
});

test('un résultat vide, non JPEG ou trop grand est rejeté avec libération des ressources', async () => {
  for (const blob of [
    new Blob([], { type: 'image/jpeg' }),
    new Blob(['png'], { type: 'image/png' }),
    new Blob([new Uint8Array(library.MAX_UPLOAD_FILE_SIZE + 1)], { type: 'image/jpeg' }),
  ]) {
    const { tools, calls } = imageTools({ encode: async () => blob });
    await assert.rejects(library.prepareMobileUploadFile(fixture('photo.png', 2 * 1024 * 1024), tools), /image ne peut pas être préparée/);
    assert.equal(calls.filter(([name]) => name === 'release').length, 1);
  }
});
