import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

// Edge/Chromium sur Windows ne publient pas toujours l'adresse CDP sur stderr.
// Lire aussi le fichier créé dans le profil TEMPORAIRE de ce banc uniquement.
// Aucun port fixe, profil habituel, réseau externe ou contournement de policy.
export function parseDevToolsActivePort(content) {
  if (typeof content !== 'string' || content.length > 4096) return null;
  const lines = content.replace(/^﻿/, '').trim().split(/\r?\n/);
  if (lines.length !== 2 || !/^[1-9]\d{0,4}$/.test(lines[0])) return null;
  const port = Number(lines[0]);
  if (port > 65535 || !/^\/devtools\/browser\/[A-Za-z0-9_-]{1,128}$/.test(lines[1])) return null;
  return `ws://127.0.0.1:${port}${lines[1]}`;
}

export async function waitForDevToolsEndpoint(child, profile, {
  timeoutMs = 20000, read = readFile, wait = pause, now = Date.now,
} = {}) {
  const portFile = path.join(profile, 'DevToolsActivePort');
  let stderr = '';
  let fromLog = null;
  let startError = null;
  let exitCode = child.exitCode;
  let exitSignal = child.signalCode;
  let readError = null;
  const onData = (chunk) => {
    stderr = (stderr + String(chunk)).slice(-5000);
    const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\/(devtools\/browser\/[A-Za-z0-9_-]+)/.exec(stderr);
    if (match) fromLog = parseDevToolsActivePort(`${match[1]}\n/${match[2]}`);
  };
  const onError = (error) => { startError = error; };
  const onExit = (code, signal) => { exitCode = code; exitSignal = signal; };
  child.stderr?.on('data', onData);
  child.on('error', onError);
  child.on('exit', onExit);
  const deadline = now() + timeoutMs;
  try {
    while (true) {
      if (startError) throw new Error(`Le navigateur n’a pas pu démarrer : ${startError.message}`);
      if (fromLog) return fromLog;
      try {
        const endpoint = parseDevToolsActivePort(await read(portFile, 'utf8'));
        if (endpoint) return endpoint;
      } catch (error) {
        // Le fichier peut être absent ou encore incomplet au démarrage.
        if (error.code !== 'ENOENT') readError = error.code || 'lecture indisponible';
      }
      if (exitSignal || (exitCode !== null && exitCode !== undefined && exitCode !== 0)) {
        throw new Error(`Le navigateur s’est arrêté avant DevTools (${exitSignal || `code ${exitCode}`}). ${stderr.slice(-1200)}`);
      }
      // Sous Windows, le lanceur peut quitter avec code 0 avant que son processus
      // navigateur termine le démarrage : continuer à lire son profil isolé.
      const remaining = deadline - now();
      if (remaining <= 0) {
        const detail = readError ? ` Lecture du fichier : ${readError}.` : '';
        throw new Error(`Aucun endpoint DevTools reçu sur stderr ou dans ${portFile}.${detail} `
          + `Le navigateur est peut-être bloqué par une stratégie locale ou n’a pas démarré ; aucun scénario UI n’a été exécuté. ${stderr.slice(-1200)}`);
      }
      await wait(Math.min(100, remaining));
    }
  } finally {
    child.stderr?.off('data', onData);
    child.off('error', onError);
    child.off('exit', onExit);
  }
}
