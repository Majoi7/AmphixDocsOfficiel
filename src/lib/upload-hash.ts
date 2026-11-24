import { MAX_UPLOAD_FILE_SIZE } from './upload-files';

// SHA-256 incrémental : aucune copie du fichier entier pour préparer l'envoi
// ou vérifier une reprise. Le transport garde toujours le Blob d'origine.
export const UPLOAD_HASH_CHUNK_SIZE = 256 * 1024;
const constants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
export async function hashUploadBlob(file: Blob): Promise<string> {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_UPLOAD_FILE_SIZE) {
    throw new Error('Le fichier dépasse la limite de 20 Mo.');
  }
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const compress = (bytes: Uint8Array, offset: number) => {
    for (let index = 0; index < 16; index++) {
      const position = offset + index * 4;
      words[index] = (bytes[position] << 24) | (bytes[position + 1] << 16)
        | (bytes[position + 2] << 8) | bytes[position + 3];
    }
    for (let index = 16; index < 64; index++) {
      const first = words[index - 15], second = words[index - 2];
      const sigma0 = rotate(first, 7) ^ rotate(first, 18) ^ (first >>> 3);
      const sigma1 = rotate(second, 17) ^ rotate(second, 19) ^ (second >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let a = state[0], b = state[1], c = state[2], d = state[3];
    let e = state[4], f = state[5], g = state[6], h = state[7];
    for (let index = 0; index < 64; index++) {
      const sigma1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sigma1 + choice + constants[index] + words[index]) >>> 0;
      const sigma0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0;
      d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    state[0] += a; state[1] += b; state[2] += c; state[3] += d;
    state[4] += e; state[5] += f; state[6] += g; state[7] += h;
  };
  // Les tranches sont des multiples de 64 : seul le dernier bloc est incomplet.
  let tail = new Uint8Array(0);
  for (let offset = 0; offset < file.size; offset += UPLOAD_HASH_CHUNK_SIZE) {
    const end = Math.min(offset + UPLOAD_HASH_CHUNK_SIZE, file.size);
    const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    if (bytes.length !== end - offset) throw new Error('Le contenu du fichier n’a pas pu être vérifié. Choisissez-le à nouveau.');
    let position = 0;
    for (; position + 64 <= bytes.length; position += 64) compress(bytes, position);
    if (position < bytes.length) tail = bytes.slice(position);
  }
  const padded = new Uint8Array(tail.length < 56 ? 64 : 128);
  padded.set(tail);
  padded[tail.length] = 0x80;
  const length = new DataView(padded.buffer);
  length.setUint32(padded.length - 8, Math.floor(file.size / 0x20000000), false);
  length.setUint32(padded.length - 4, (file.size * 8) >>> 0, false);
  for (let offset = 0; offset < padded.length; offset += 64) compress(padded, offset);
  return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('');
}
