/**
 * @file living/hooks.js
 * @description THE ONE DOOR OUT OF THE BROWSER, AND IT IS NOT `fetch`. A living document that talks
 *   to the world does it through the node's `living-hooks` extension, as the signed-in caller: the
 *   owner's allowlist decides which hosts may be reached, the rate limits and the size caps are the
 *   node's, and the outbound request itself goes through safeFetch on the far side. A page that
 *   called a third-party URL directly would meet CORS on the good days and would be a way to carry
 *   somebody's secrets to an address of the record's choosing on the bad ones.
 *
 *   A GUEST IS TOLD, NOT TRIED. Without a session there is no principal, the node would refuse the
 *   call, and a browser that attempts it anyway earns a console error and a person who cannot tell
 *   whether the document is broken or merely locked. So the check is here, before the transport, and
 *   the answer is a refusal in words the screen can show.
 *
 *   THE TRANSPORT IS A SEAM, ON PURPOSE. `opts.transport` is a function that receives the same
 *   request objects the node would have received and answers what the node would have answered —
 *   which is how the unit suite and the browser proof exercise every path without a node, an
 *   extension or a network. It is the only way in: nothing here reads a URL by any other route, so a
 *   test that passes through the seam has tested the real code.
 *
 *   NOTHING IN A REQUEST NAMES A PRINCIPAL. The identity is the session's own bearer and the node
 *   resolves it; no owner, no GAII and no agent id travels from the record, so a document cannot ask
 *   to act as somebody else by writing a name into itself.
 * @structure createHooks(opts) → { status, signedIn, send, read, task }
 * @usage
 *   import { createHooks } from './hooks.js';
 *   const hooks = createHooks({ langs: () => ['fi'] });
 *   await hooks.send({ url: 'https://…', method: 'POST', body: payload });
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { say, refusalWords } from './hooks-words.js';

/** The extension every living document's outward and inward calls ride. */
export const EXTENSION = 'living-hooks';

/** A clock that is fine to subtract, wherever this runs. */
function now() {
  try {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch { /* no performance clock */ }
  return Date.now();
}

/** The signed-in session, or null on a page with no auth library and for a guest. */
function currentSession() {
  try {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (!ns || !ns.auth || typeof ns.auth.getSession !== 'function') return null;
    return ns.auth.getSession() || null;
  } catch { return null; }
}

/**
 * The door.
 * @param {{ transport?: (req: any) => Promise<any>, signedIn?: boolean, langs?: () => string[],
 *   extension?: string }} [opts]
 * @returns {any}
 */
export function createHooks(opts) {
  const options = opts || {};
  const transport = typeof options.transport === 'function' ? options.transport : null;
  const langs = typeof options.langs === 'function' ? options.langs : function () { return []; };
  const ext = String(options.extension || EXTENSION);

  /** Whether there is a principal to make this call as. A host may state it; otherwise we look. */
  function signedIn() {
    if (typeof options.signedIn === 'boolean') return options.signedIn;
    return !!currentSession();
  }

  /** The real road: the node's extension for a send or a read, the task route for an agent. */
  async function overTheWire(req) {
    const session = currentSession();
    if (!session || typeof session.fetch !== 'function') {
      return { error: { code: 'NO_EXTENSION', message: say('refusal.NO_EXTENSION', langs()) } };
    }
    const head = { 'Content-Type': 'application/json' };
    if (req.kind === 'task') {
      const made = await session.fetch('/v1/agents/' + encodeURIComponent(String(req.agent)) + '/tasks', {
        method: 'POST', headers: head,
        body: JSON.stringify({ title: req.title, description: req.description }),
      });
      if (!made || !made.ok) return { error: (made && made.error) || { code: 'UPSTREAM_FAILED' } };
      return { ok: true, status: 201 };
    }
    const body = req.kind === 'read'
      ? { url: req.url, path: req.path, raw: req.raw, headers: req.headers }
      : { url: req.url, method: req.method, headers: req.headers, body: req.body };
    const answer = await session.fetch('/v1/ext/' + encodeURIComponent(ext) + '/' + (req.kind === 'read' ? 'read' : 'send'), {
      method: 'POST', headers: head, body: JSON.stringify(body),
    });
    if (!answer || !answer.ok) return { error: (answer && answer.error) || { code: 'UPSTREAM_FAILED' } };
    return answer.data || {};
  }

  /**
   * One call, whichever kind. Answers the extension's own shape with `ms` on it, or `{ refusal }`
   * — never a thrown error, because a document that stops rendering when a server is down is a
   * worse document than one that says the reading is old.
   */
  async function call(req) {
    if (!signedIn()) {
      return {
        refusal: {
          code: 'SIGNED_OUT',
          message: say(req.kind === 'read' ? 'guest.read' : 'guest.send', langs()),
        },
        ms: 0,
      };
    }
    const started = now();
    try {
      const answer = transport ? await transport(req) : await overTheWire(req);
      const ms = Math.round(now() - started);
      if (answer && answer.error) return { refusal: answer.error, ms: ms };
      return Object.assign({ ms: ms }, answer || {});
    } catch (e) {
      return {
        refusal: { code: 'UPSTREAM_FAILED', message: (e && e.message) || String(e) },
        ms: Math.round(now() - started),
      };
    }
  }

  return {
    /** Whether this page can make the call at all, and the words to say when it cannot. */
    status() {
      const ok = signedIn();
      return { signedIn: ok, reason: ok ? '' : say('guest.send', langs()) };
    },
    signedIn: signedIn,
    /** The refusal a read earns for a guest, in words — the source runtime shows this on the node. */
    guestRead() { return say('guest.read', langs()); },
    /** A refusal as a person reads it: the node's own sentence first, the code's fallback second. */
    words(refusal) { return refusalWords(refusal, langs()); },

    /** @param {{ url: string, method?: string, headers?: object, body: any }} req */
    send(req) {
      return call({
        kind: 'send', url: String(req.url), method: String(req.method || 'POST'),
        headers: req.headers, body: req.body,
      });
    },
    /** @param {{ url: string, path?: string, raw?: boolean, headers?: object }} req */
    read(req) {
      return call({
        kind: 'read', url: String(req.url), path: req.path, raw: req.raw, headers: req.headers,
      });
    },
    /** @param {{ agent: string, title: string, description: string, body: any }} req */
    task(req) {
      return call({
        kind: 'task', agent: String(req.agent), title: String(req.title),
        description: String(req.description), body: req.body,
      });
    },
  };
}
