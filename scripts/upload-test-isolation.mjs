// Frontière exclusive des bancs locaux : elle permet de charger les fonctions
// de transport avec des outils injectés, sans installer ni simuler silencieusement
// la bibliothèque de production. Tout usage du chargeur TUS par défaut échoue.
// Ces tests ne valident ni tus-js-client, ni ses types, ni un serveur Supabase.
export function forbidDefaultTusInTests() {
  const id = '\0amphixdocs-forbidden-default-tus-in-tests';
  return {
    name: 'forbid-default-tus-in-tests',
    enforce: 'pre',
    resolveId(source) { if (source === 'tus-js-client') return id; },
    load(moduleId) {
      if (moduleId !== id) return;
      return 'export class Upload { constructor() { throw new Error("Le client TUS réel est interdit dans ce banc local. Injectez un transport fictif explicite."); } }';
    },
  };
}

// Double de XHR réservé aux tests. Aucun appel réseau ni minuteur implicite :
// le scénario décide explicitement des octets, de la réponse et des pannes.
// Les assertions du faux serveur sont rapportées même si le transport les
// transforme ensuite en erreurs récupérables.
export function localXhrClass(perform, reportException = () => {}) {
  return class LocalXMLHttpRequest {
    upload = { onprogress: null };
    onload = null;
    onerror = null;
    ontimeout = null;
    onabort = null;
    status = 0;
    responseText = '';
    responseHeaders = new Headers();
    headers = new Headers();
    timeout = 0;
    withCredentials = false;
    readyState = 0;
    sent = false;
    completed = false;
    aborted = false;
    abortCount = 0;
    method = '';
    url = '';
    body = null;

    open(method, url, asynchronous = true) {
      if (!asynchronous) throw new Error('Les XHR synchrones sont interdits dans ce banc local.');
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader(name, value) { this.headers.set(name, value); }
    getResponseHeader(name) { return this.responseHeaders.get(name); }
    send(body = null) {
      if (this.readyState !== 1 || this.sent) throw new Error('XHR fictif non ouvert ou déjà envoyé.');
      this.body = body;
      this.sent = true;
      this.readyState = 2;
      void Promise.resolve().then(() => {
        if (!this.aborted) return perform(this, body);
      }).catch((error) => {
        reportException(error);
        this.fail('error');
      });
    }
    progress(loaded, lengthComputable = true) {
      if (this.completed || this.aborted) return;
      this.upload.onprogress?.({ loaded, total: this.body?.size ?? 0, lengthComputable });
    }
    respond(status = 200, body = '', headers = {}) {
      if (this.completed || this.aborted) return;
      this.status = status;
      this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
      this.responseHeaders = new Headers(headers);
      this.readyState = 4;
      this.completed = true;
      this.onload?.();
    }
    fail(kind = 'error') {
      if (this.completed || this.aborted) return;
      this.readyState = 4;
      this.completed = true;
      if (kind === 'timeout') this.ontimeout?.();
      else this.onerror?.();
    }
    abort() {
      this.abortCount++;
      if (this.completed || this.aborted) return;
      this.aborted = true;
      this.readyState = 0;
      this.onabort?.();
    }
  };
}
