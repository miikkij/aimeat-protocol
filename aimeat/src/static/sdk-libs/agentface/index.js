/**
 * @file agentface/index.js
 * @description The aimeat-agentface library (SDK-libs migration Phase 1). Publishes an app's Agent
 *   Face — the markdown read-surface agents get on the app URL via Accept: text/markdown — in one
 *   call from inside the running app: publish() composes markdown (raw string or { title, sections }),
 *   infers the app filename (opts.app > <meta name="aimeat-app"> > the /v1/apps/{owner}/{file} path),
 *   and writes the public record apps.{filename}.agentface via the authenticated memory API. Exposed
 *   as BOTH AIMEAT.agentface (house convention) and AIMEATAgentFace (spec name). Componentized ESM
 *   source esbuild bundles to the IIFE served, unchanged, at /v1/libs/aimeat-agentface.js. Ported
 *   verbatim from lib-agentface.ts — the bespoke auth-guard messages are preserved (they teach the
 *   app-owner-only serving rule), so getSession stays inline rather than using _core/session.
 * @structure imports attach (namespace) + copyText (clipboard); getSession/compose/inferFilename;
 *   the quiet publisher (sessionOrNull/quietState/quietRun); the `agentface` object
 *   (key/compose/copyText/publish/publishQuietly); attach('agentface', …) + window.AIMEATAgentFace.
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-agentface.js"></script>
 *   await AIMEATAgentFace.publish('# My app\n\n…', { app: 'my-app.html' });
 *   AIMEATAgentFace.publishQuietly(() => ({ title, sections }), { app: 'my-app.html', debounceMs: 800 });
 *   await AIMEAT.agentface.copyText(promptText);  // the shared "Copy prompt" implementation
 * @version-history
 *   v1.2.0 — 2026-10-01 — publishQuietly(input, { app, debounceMs }): the guard ten apps wrote by
 *     hand around publish(). Resolves false and writes nothing when signed out, never throws (one
 *     console.warn line instead), skips a face identical to the last one written for that app,
 *     writes one app's faces in call order, and with debounceMs writes only the last of a burst.
 *     The input may be a function, read when the write happens. copyText() moved to
 *     _core/clipboard.js unchanged, so the Atelier kit shares it. publish() is unchanged.
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-agentface.ts (SDK-libs migration Phase 1).
 *   v1.1.0 — 2026-08-05 — copyText(): the ONE shared clipboard implementation for the platform's
 *     copy-a-prompt-to-your-AI pattern (async API + hidden-textarea fallback, no visible
 *     selection) — every app was hand-rolling its own, several of them badly.
 */
import { attach } from '../_core/namespace.js';
import { copyText } from '../_core/clipboard.js';

const MAX_BYTES = 256 * 1024; // the convention cap — the node treats an oversize face as absent

function getSession() {
  const auth = window.AIMEAT && window.AIMEAT.auth;
  if (!auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-agentface.js');
  }
  const s = auth.getSession();
  if (!s) {
    throw new Error('Not signed in. AIMEATAgentFace.publish writes the face as the signed-in user — call AIMEAT.auth.login() first. Note: the node serves only the record written by the APP OWNER; another user\'s publish lands in their own namespace and is never served.');
  }
  return s;
}

/** Compose { title, sections: [{ heading, body }] } into a markdown document. */
function compose(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('compose expects { title, sections: [{ heading, body }] }');
  }
  const parts = [];
  if (doc.title) parts.push('# ' + String(doc.title).trim());
  const sections = Array.isArray(doc.sections) ? doc.sections : [];
  for (const s of sections) {
    if (!s || typeof s.heading !== 'string' || !s.heading.trim()) {
      throw new Error('Every section needs a non-empty string heading');
    }
    parts.push('## ' + s.heading.trim() + '\n\n' + (typeof s.body === 'string' ? s.body.trim() : ''));
  }
  if (parts.length === 0) throw new Error('Nothing to compose — provide a title and/or sections');
  return parts.join('\n\n') + '\n';
}

/** Derive this app's filename: <meta name="aimeat-app">, else the /v1/apps/{owner}/{file} path. */
function inferFilename() {
  const meta = typeof document !== 'undefined' && document.querySelector('meta[name="aimeat-app"]');
  const fromMeta = meta && meta.getAttribute('content');
  if (fromMeta && fromMeta.trim()) return fromMeta.trim();
  const m = typeof location !== 'undefined' && location.pathname.match(/\/v1\/apps\/[^/]+\/([^/?#]+\.html?)$/i);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

// ── The quiet publisher ──
// Ten apps wrapped publish() in the same guard: stop when the library or the session is missing,
// try, swallow the error. Some debounced it and one skipped an unchanged face. This is that guard.

/** The signed-in session, or null when aimeat-auth is missing or nobody is signed in. */
function sessionOrNull() {
  const auth = window.AIMEAT && window.AIMEAT.auth;
  if (!auth || typeof auth.getSession !== 'function') return null;
  try { return auth.getSession() || null; } catch { return null; }
}

/**
 * Per app filename: the markdown last written (or being written), the chain that keeps one app's
 * writes in call order, and the burst a debounce is collecting.
 * @type {Map<string, { last: string|null, chain: Promise<any>, timer: any, input: any, waiters: Array<(ok: boolean) => void> }>}
 */
const quiet = new Map();

function quietState(filename) {
  let st = quiet.get(filename);
  if (!st) {
    st = { last: null, chain: Promise.resolve(), timer: null, input: null, waiters: [] };
    quiet.set(filename, st);
  }
  return st;
}

/** One line in the console, never an exception. */
function quietWarn(filename, err) {
  console.warn('[aimeat-agentface] publishQuietly(' + (filename || '?') + ') wrote nothing: ' + String((err && err.message) || err));
}

/**
 * Write one face if it differs from the last one written for this app. Queued behind the app's
 * earlier writes, so two calls never land out of order.
 * @returns {Promise<boolean>}
 */
function quietRun(filename, input) {
  const st = quietState(filename);
  const run = st.chain.then(async function () {
    if (!sessionOrNull()) return false;
    let markdown;
    try {
      const value = typeof input === 'function' ? input() : input;
      markdown = typeof value === 'string' ? value : compose(value);
    } catch (e) { quietWarn(filename, e); return false; }
    if (markdown === st.last) return false;
    st.last = markdown;
    try {
      await agentface.publish(markdown, { app: filename });
      return true;
    } catch (e) {
      st.last = null; // the next call tries again
      quietWarn(filename, e);
      return false;
    }
  });
  st.chain = run;
  return run;
}

const agentface = {
  /** The convention memory key the face lives under. */
  key(filename) { return 'apps.' + filename + '.agentface'; },

  /** The markdown composer (exposed so an app can preview what publish() will write). */
  compose: compose,

  /**
   * Copy text to the clipboard the way every "Copy prompt" button should: async clipboard API
   * first, hidden-offscreen-textarea execCommand fallback — never a visible selection painted
   * over the page. Resolves to true/false; never throws. This is THE shared implementation for
   * the platform's copy-a-prompt-to-your-AI pattern — stop hand-rolling it per app. The code
   * lives in _core/clipboard.js, shared with the Atelier kit's copy().
   * @param {unknown} text
   * @returns {Promise<boolean>}
   */
  copyText(text) { return copyText(text); },

  /**
   * Publish this app's agent face: a markdown string, or { title, sections: [{ heading, body }] }.
   * opts.app names the app filename explicitly (e.g. 'my-app.html') and overrides inference —
   * pass it on per-app subdomain origins, where the filename is not derivable from the URL.
   * Writes the public record apps.{filename}.agentface via the authenticated memory API.
   */
  async publish(input, opts) {
    opts = opts || {};
    const markdown = typeof input === 'string' ? input : compose(input);
    if (!markdown.trim()) throw new Error('AIMEATAgentFace.publish: the markdown content is empty');
    if (new TextEncoder().encode(markdown).length > MAX_BYTES) {
      throw new Error('Agent face exceeds the 256 KB cap — the node would treat it as absent. Publish a summary and link out to records instead.');
    }
    const filename = typeof opts.app === 'string' && opts.app.trim() ? opts.app.trim() : inferFilename();
    if (!filename) {
      throw new Error('Cannot derive the app filename on this origin — pass { app: "your-file.html" } or add <meta name="aimeat-app" content="your-file.html"> to the page');
    }
    const session = getSession();
    const key = agentface.key(filename);
    const res = await session.fetch('/v1/memory', {
      method: 'POST',
      body: JSON.stringify({ key: key, value: markdown, visibility: 'public' }),
    });
    if (!res.ok) {
      throw new Error((res.error && res.error.message) || 'Failed to publish the agent face');
    }
    return { key: key, app: filename, version: res.data && res.data.version, visibility: 'public' };
  },

  /**
   * publish() for an app that updates its face as it runs and must never break because of it.
   * `input` is what publish() takes (markdown or { title, sections }) or a function that returns
   * it, called when the write happens, so a debounced burst composes the latest state once.
   * Resolves true when the face was written; false when nothing was written: signed out or no
   * aimeat-auth on the page, the same markdown as the last write for this app, a burst member
   * that a later call replaced, or a failure (then one console.warn line). Never rejects.
   * @param {string|object|(() => string|object)} input
   * @param {{ app?: string, debounceMs?: number }} [opts]
   * @returns {Promise<boolean>}
   */
  publishQuietly(input, opts) {
    const o = opts || {};
    if (!sessionOrNull()) return Promise.resolve(false);
    const filename = typeof o.app === 'string' && o.app.trim() ? o.app.trim() : inferFilename();
    if (!filename) {
      quietWarn(null, new Error('no app filename on this origin; pass { app: "your-file.html" }'));
      return Promise.resolve(false);
    }
    const wait = Number(o.debounceMs) > 0 ? Number(o.debounceMs) : 0;
    if (!wait) return quietRun(filename, input);
    const st = quietState(filename);
    st.input = input;
    if (st.timer) clearTimeout(st.timer);
    return new Promise(function (resolveOk) {
      st.waiters.push(resolveOk);
      st.timer = setTimeout(function () {
        const waiters = st.waiters;
        const latest = st.input;
        st.waiters = [];
        st.input = null;
        st.timer = null;
        quietRun(filename, latest).then(function (ok) {
          // The call that carried the written face answers true; the ones it replaced answer false.
          waiters.forEach(function (w, i) { w(i === waiters.length - 1 ? ok : false); });
        });
      }, wait);
    });
  },
};

// ── Expose globally: house convention + the convention's spec name ──
attach('agentface', agentface);
window.AIMEATAgentFace = agentface;
