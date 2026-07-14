/**
 * @file src/routes/lib-agentface.ts
 * @description Server-side generator for the browser library aimeat-agentface.js — publish an
 *   app's Agent Face (the markdown read-surface agents get on the app URL via Accept:
 *   text/markdown, phase 1) in one call from inside the running app. publish() composes the
 *   markdown (raw string, or { title, sections }), derives the app filename (explicit option >
 *   <meta name="aimeat-app"> > the /v1/apps/{owner}/{filename} path), and writes the convention
 *   record apps.{filename}.agentface with visibility 'public' through the SAME authenticated
 *   data-write path apps already use (session.fetch POST /v1/memory — what AIMEAT.data.set
 *   wraps). The node serves the record only when the WRITER is the app owner (the face is read
 *   from the app owner's GHII), so a visitor's call writes harmlessly into their own namespace.
 * @structure
 *   - aimeatAgentFaceLib(config): returns the aimeat-agentface.js source string as an IIFE
 *   - emitted publish(input, opts?): compose + infer filename + write the public record
 *   - emitted compose({ title, sections }): the markdown composer, exposed for previewing
 *   - emitted key(filename): the convention memory key
 *   - exposed as BOTH AIMEAT.agentface (house convention) and AIMEATAgentFace (spec name)
 * @usage
 *   router.get('/v1/libs/aimeat-agentface.js', (_req, res) =>
 *     sendJavascriptLibrary(res, aimeatAgentFaceLib(config)));
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial: Agent Face publish library (phase 2)
 */
import type { AimeatConfig } from '../config.js';

export function aimeatAgentFaceLib(config: AimeatConfig): string {
  return `// aimeat-agentface.js — publish this app's Agent Face (markdown read-surface for agents)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first (the publish is an authenticated owner write)
// Usage:
//   await AIMEATAgentFace.publish('# My app\\n\\nCurrent state lives in public records.', { app: 'my-app.html' });
//   await AIMEATAgentFace.publish({ title: 'My app', sections: [{ heading: 'Today', body: '...' }] });
// The node serves the face at the app URL for Accept: text/markdown (or ?format=md) — with a
// node-generated affordances footer — ONLY when the record sits under the APP OWNER's identity.
// Call publish on the same code paths that update the visible view, so agents and humans see
// the same state.
(function(global) {
'use strict';

const MAX_BYTES = 256 * 1024; // the convention cap — the node treats an oversize face as absent

function getSession() {
  const auth = global.AIMEAT && global.AIMEAT.auth;
  if (!auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-agentface.js');
  }
  const s = auth.getSession();
  if (!s) {
    throw new Error('Not signed in. AIMEATAgentFace.publish writes the face as the signed-in user — call AIMEAT.auth.login() first. Note: the node serves only the record written by the APP OWNER; another user\\'s publish lands in their own namespace and is never served.');
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
    parts.push('## ' + s.heading.trim() + '\\n\\n' + (typeof s.body === 'string' ? s.body.trim() : ''));
  }
  if (parts.length === 0) throw new Error('Nothing to compose — provide a title and/or sections');
  return parts.join('\\n\\n') + '\\n';
}

/** Derive this app's filename: <meta name="aimeat-app">, else the /v1/apps/{owner}/{file} path. */
function inferFilename() {
  const meta = typeof document !== 'undefined' && document.querySelector('meta[name="aimeat-app"]');
  const fromMeta = meta && meta.getAttribute('content');
  if (fromMeta && fromMeta.trim()) return fromMeta.trim();
  const m = typeof location !== 'undefined' && location.pathname.match(/\\/v1\\/apps\\/[^/]+\\/([^/?#]+\\.html?)$/i);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

const agentface = {
  /** The convention memory key the face lives under. */
  key(filename) { return 'apps.' + filename + '.agentface'; },

  /** The markdown composer (exposed so an app can preview what publish() will write). */
  compose: compose,

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
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.agentface = agentface;
global.AIMEATAgentFace = agentface;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
