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
 * @structure imports attach (namespace); getSession/compose/inferFilename; the `agentface` object
 *   (key/compose/copyText/publish); attach('agentface', …) + window.AIMEATAgentFace.
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-agentface.js"></script>
 *   await AIMEATAgentFace.publish('# My app\n\n…', { app: 'my-app.html' });
 *   await AIMEAT.agentface.copyText(promptText);  // the shared "Copy prompt" implementation
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-agentface.ts (SDK-libs migration Phase 1).
 *   v1.1.0 — 2026-08-05 — copyText(): the ONE shared clipboard implementation for the platform's
 *     copy-a-prompt-to-your-AI pattern (async API + hidden-textarea fallback, no visible
 *     selection) — every app was hand-rolling its own, several of them badly.
 */
import { attach } from '../_core/namespace.js';

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

const agentface = {
  /** The convention memory key the face lives under. */
  key(filename) { return 'apps.' + filename + '.agentface'; },

  /** The markdown composer (exposed so an app can preview what publish() will write). */
  compose: compose,

  /**
   * Copy text to the clipboard the way every "Copy prompt" button should: async clipboard API
   * first, hidden-offscreen-textarea execCommand fallback — never a visible selection painted
   * over the page. Resolves to true/false; never throws. This is THE shared implementation for
   * the platform's copy-a-prompt-to-your-AI pattern — stop hand-rolling it per app.
   */
  async copyText(text) {
    const value = String(text == null ? '' : text);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch { /* fall through to the textarea fallback */ }
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  },

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
};

// ── Expose globally: house convention + the convention's spec name ──
attach('agentface', agentface);
window.AIMEATAgentFace = agentface;
