import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router-dom';
import { UploadModal } from '../../src/components/UploadModal';
import { readUploadDraft, saveUploadDraft, type UploadDraftInput, type UploadDraftScope } from '../../src/lib/upload-draft';
import { readUploadJournal, serializeUploadBatch, type UploadBatchReport } from '../../src/lib/upload-batch';
import { startUploadDiagnostics, UPLOAD_DIAGNOSTICS_KEY } from '../../src/lib/upload-diagnostics';
import {
  failFixtureTransfer, fixtureNetworkAttempts, fixtureUser, getSupabaseClientState,
  holdFixtureTransfer, releaseFixtureTransfer, setFixtureProject, setFixtureUser, transportCalls,
} from './upload-mocks';
import '../../src/index.css';

// Entrée exclusive du banc local. Le build de production ne l'importe jamais.
// Les méthodes de test ne remplacent ni React, ni les hooks, ni IndexedDB.
const metrics = { opens: 0, puts: 0, deletes: 0, commits: 0, aborts: 0 };
const violations: { directive: string; blockedURI: string }[] = [];
const reports: UploadBatchReport[] = [];
let rejectReports = false;
let failPut = false;
let failDelete = false;
let delayOpen = false;
let releaseOpen: (() => void) | null = null;
let controls: { open: () => void; close: () => void; navigateAway: () => void } | null = null;
const observedTransactions = new WeakSet<IDBTransaction>();
const nativeOpen = IDBFactory.prototype.open;
const nativePut = IDBObjectStore.prototype.put;
const nativeDelete = IDBObjectStore.prototype.delete;
function observe(transaction: IDBTransaction) {
  if (observedTransactions.has(transaction)) return;
  observedTransactions.add(transaction);
  transaction.addEventListener('complete', () => { metrics.commits++; }, { once: true });
  transaction.addEventListener('abort', () => { metrics.aborts++; }, { once: true });
}
IDBFactory.prototype.open = function (...args: Parameters<IDBFactory['open']>) {
  metrics.opens++;
  const request = Reflect.apply(nativeOpen, this, args) as IDBOpenDBRequest;
  if (delayOpen) {
    delayOpen = false;
    // On retarde une notification native, pas la transaction. La base, les
    // requêtes, les commits et les conflits restent ceux du vrai navigateur.
    request.addEventListener('success', (event) => {
      event.stopImmediatePropagation();
      releaseOpen = () => {
        releaseOpen = null;
        request.onsuccess?.call(request, event);
      };
    }, { once: true });
  }
  return request;
};
IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
  metrics.puts++;
  observe(this.transaction);
  if (failPut) {
    failPut = false;
    throw new DOMException('Quota fictif pour ce test local.', 'QuotaExceededError');
  }
  return Reflect.apply(nativePut, this, args) as IDBRequest<IDBValidKey>;
};
IDBObjectStore.prototype.delete = function (...args: Parameters<IDBObjectStore['delete']>) {
  metrics.deletes++;
  observe(this.transaction);
  if (failDelete) {
    failDelete = false;
    throw new DOMException('Retrait fictivement indisponible.', 'UnknownError');
  }
  return Reflect.apply(nativeDelete, this, args) as IDBRequest<undefined>;
};
window.addEventListener('securitypolicyviolation', (event) => {
  violations.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
});
const scope = (): UploadDraftScope => ({ userId: fixtureUser(), projectUrl: getSupabaseClientState().config.url });
const draftInput = (draft: UploadDraftInput): UploadDraftInput => ({
  files: draft.files, titles: draft.titles, description: draft.description,
  schoolName: draft.schoolName, subjectName: draft.subjectName, batch: draft.batch,
  picker: draft.picker, filesPrepared: draft.filesPrepared,
});
interface FixtureFile {
  name: string;
  text?: string;
  type?: string;
  size?: number;
  lastModified?: number;
  base64?: string;
}
function chooseFiles(specifications: FixtureFile[], picker = 'files') {
  const input = document.querySelector<HTMLInputElement>(`input[type="file"][id$="-${picker}"]`);
  if (!input || input.disabled) throw new Error('Le sélecteur réel n’est pas disponible.');
  const data = new DataTransfer();
  specifications.forEach((specification) => {
    const bytes = specification.base64 ? Uint8Array.from(atob(specification.base64), (character) => character.charCodeAt(0))
      : specification.size === undefined ? specification.text ?? '%PDF-test-local' : new Uint8Array(specification.size);
    data.items.add(new File([bytes], specification.name, {
      type: specification.type ?? '', lastModified: specification.lastModified ?? 1760000000000,
    }));
  });
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function Harness() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    controls = { open: () => setIsOpen(true), close: () => setIsOpen(false), navigateAway: () => navigate('/away') };
    return () => { controls = null; };
  }, [navigate]);
  return (
    <main className="min-h-dvh p-4">
      <h1 className="text-lg font-bold">Banc local du dépôt</h1>
      <p className="my-2 text-sm">Compte et transfert fictifs · aucune connexion à Supabase.</p>
      <button id="open-upload-test" type="button" className="min-h-11 rounded-full bg-[#ff6a2b] px-4"
        onClick={() => setIsOpen(true)}>Ouvrir le dépôt de test</button>
      <UploadModal isOpen={isOpen} onClose={() => setIsOpen(false)} documents={[]} onSuccess={(report) => {
        reports.push(report);
        if (rejectReports) throw new Error('Actualisation fictivement indisponible.');
      }} />
    </main>
  );
}
const router = createMemoryRouter([
  { path: '/', element: <Harness /> },
  { path: '/away', element: <p id="away-test">Navigation locale terminée.</p> },
]);
const api = {
  ready: () => !!controls,
  open: () => controls?.open(),
  close: () => controls?.close(),
  navigateAway: () => controls?.navigateAway(),
  setUser: setFixtureUser,
  setProject: setFixtureProject,
  chooseFiles,
  holdTransfer: holdFixtureTransfer,
  releaseTransfer: releaseFixtureTransfer,
  failNextTransfer: failFixtureTransfer,
  rejectReports: (reject: boolean) => { rejectReports = reject; },
  failNextPut: () => { failPut = true; },
  failNextDelete: () => { failDelete = true; },
  holdNextOpen: () => { if (delayOpen || releaseOpen) throw new Error('Une ouverture est déjà retenue.'); delayOpen = true; },
  releaseOpen: () => releaseOpen?.(),
  hasHeldOpen: () => !!releaseOpen,
  metrics: () => ({ ...metrics }),
  diagnostics: () => JSON.parse(sessionStorage.getItem(UPLOAD_DIAGNOSTICS_KEY) || '[]') as unknown[],
  networkAttempts: fixtureNetworkAttempts,
  violations: () => [...violations],
  calls: () => structuredClone(transportCalls),
  reports: () => reports.map((report) => ({
    userId: report.userId, projectUrl: report.projectUrl, generation: report.generation, complete: report.complete,
    documents: report.documents.map((document) => ({ id: document.id, user_id: document.user_id, title: document.title })),
  })),
  async readDraft(target: UploadDraftScope = scope()) {
    const draft = await readUploadDraft(target);
    if (!draft) return null;
    const files = await Promise.all(draft.files.map(async (file) => ({
      name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, text: await file.text(),
    })));
    return {
      userId: draft.userId, projectUrl: draft.projectUrl, revision: draft.revision, files,
      titles: draft.titles, description: draft.description, schoolName: draft.schoolName, subjectName: draft.subjectName,
      batch: draft.batch ? serializeUploadBatch(draft.batch) : null,
      picker: draft.picker, filesPrepared: draft.filesPrepared,
      attachments: draft.batch?.entries.map((entry) => ({
        id: entry.request.identity.id, name: entry.file?.name, size: entry.file?.size, type: entry.file?.type,
        status: entry.status, document: entry.document, sha256: entry.request.sha256,
      })) ?? [],
    };
  },
  async rewriteDraft(patch: Partial<Pick<UploadDraftInput, 'titles' | 'description' | 'schoolName' | 'subjectName'>> = {}) {
    const target = scope();
    const current = await readUploadDraft(target);
    if (!current) throw new Error('Le brouillon réel doit exister avant la concurrence de test.');
    const saved = await saveUploadDraft(target, { ...draftInput(current), ...patch }, current.revision);
    return saved.revision;
  },
  readJournal: () => {
    const target = scope();
    const journal = readUploadJournal(localStorage, target.userId, target.projectUrl);
    return journal ? serializeUploadBatch(journal) : null;
  },
};
declare global {
  interface Window { __uploadHarness: typeof api }
}
window.__uploadHarness = api;
startUploadDiagnostics();
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
