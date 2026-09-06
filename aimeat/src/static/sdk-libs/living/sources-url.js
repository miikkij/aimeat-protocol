/**
 * @file living/sources-url.js
 * @description THE OTHER HALF OF A LIVE SOURCE: the one that comes off an address. The memory-key
 *   road rides the platform's own change event and needs no clock; a URL has nobody to tell us it
 *   moved, so it is asked — through the node's `living-hooks` extension, as the signed-in caller,
 *   never by the browser itself.
 *
 *   IT ASKS WHILE SOMEBODY IS LOOKING, AND STOPS WHEN THEY ARE NOT. Polling runs while the document
 *   is mounted AND the tab is visible; a background tab with a spot-price sheet open for a week
 *   would otherwise make ten thousand calls nobody reads, against somebody else's server, on the
 *   owner's rate limit. The floor of ten seconds is the record's own refusal (source.js), and this
 *   file clamps to it as well, because a record can be edited after it was validated.
 *
 *   A FAILED READ IS WORDS, NOT A HOLE. The number stays exactly where it was and the node's
 *   `stale` output gains the refusal, so a sentence can say the reading is old and the chart keeps
 *   its shape. The opposite — blanking the node — is the failure this file was written around: a
 *   day of prices that drops to zero for one poll is a document that lies with a number, and a
 *   number is believed.
 * @structure createUrlSources(spec) → { start, stop, readOnce, polled, destroy }
 * @usage
 *   const live = createUrlSources({ doc, graph, hooks, langs, onChanged });
 *   live.start();
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { EVERY_FLOOR } from './nodes/source.js';
import { say } from './hooks-words.js';

/** A raw body as a value: a number when it parses as one, otherwise the text itself. */
export function asRaw(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const text = v.trim();
    if (text !== '' && Number.isFinite(Number(text))) return Number(text);
  }
  return v;
}

/**
 * The runtime.
 * @param {{ doc: any, graph: any, hooks: any, langs?: () => string[],
 *   onResult?: (result: { changed: string[], transitions?: any[] }) => void }} spec
 * @returns {any}
 */
export function createUrlSources(spec) {
  const doc = spec.doc || {};
  const graph = spec.graph;
  const hooks = spec.hooks;
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  /** @type {Map<string, any>} */
  const timers = new Map();
  let destroyed = false;
  let running = false;
  let watching = null;

  /** Every source in the record that reads an address. */
  function sources() {
    const nodes = (doc.model || {}).nodes || {};
    const out = [];
    for (const id of Object.keys(nodes)) {
      const node = nodes[id] || {};
      if (String(node.type) === 'source' && node.url) out.push({ id: id, node: node });
    }
    return out;
  }

  /** How often this one is asked, never under the floor. Nothing means "once, on mount". */
  function everyOf(node) {
    const n = Number(node.every);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(EVERY_FLOOR, n);
  }

  function report(out) {
    // The WHOLE result travels, not just the ids: a reading that arrives can cross a threshold and
    // move a machine, and a caller handed only the changed list would have no transition to deliver.
    if (spec.onResult && out && out.changed && out.changed.length) spec.onResult(out);
  }

  /**
   * Ask once. Answers when it is done, so a caller can await the first read before it says the
   * document is ready.
   * @param {string} id
   */
  async function readOnce(id) {
    if (destroyed) return;
    const node = ((doc.model || {}).nodes || {})[String(id)];
    if (!node || !node.url) return;
    const answer = await hooks.read({
      url: String(node.url), path: node.path, raw: node.raw ? true : undefined,
      // The headers the record carries, secret names and all. What a `{{secret:NAME}}` stands for
      // is resolved on the node as the call leaves it; this browser never holds the value.
      headers: node.headers,
    });
    if (destroyed) return;
    if (answer.refusal) {
      // A guest is told what to do, not told that something failed: nothing was tried.
      const words = String(answer.refusal.code) === 'SIGNED_OUT'
        ? hooks.words(answer.refusal)
        : say('stale.lead', langs()) + hooks.words(answer.refusal) + say('stale.tail', langs());
      report(graph.setField(String(id), 'stale', words));
      return;
    }
    const value = node.raw ? asRaw(answer.value) : answer.value;
    report(graph.set(String(id), value));
    report(graph.setField(String(id), 'stale', ''));
  }

  /** Whether anybody is looking at this page right now. A page with no document always is. */
  function visible() {
    try {
      if (typeof document === 'undefined' || !document) return true;
      return document.visibilityState !== 'hidden';
    } catch { return true; }
  }

  function clearTimers() {
    for (const [, handle] of timers) clearInterval(handle);
    timers.clear();
  }

  function arm() {
    clearTimers();
    if (destroyed || !running || !visible()) return;
    for (const entry of sources()) {
      const every = everyOf(entry.node);
      if (!every) continue;
      timers.set(entry.id, setInterval(function () { readOnce(entry.id); }, every * 1000));
    }
  }

  return {
    /** Read every address once, then keep the ones with an `every` up to date. */
    start() {
      if (destroyed) return Promise.resolve();
      running = true;
      if (!watching) {
        watching = function () { arm(); };
        try { document.addEventListener('visibilitychange', watching); } catch { watching = null; }
      }
      const first = sources().map(function (entry) { return readOnce(entry.id); });
      arm();
      return Promise.all(first);
    },

    /** Stop asking, without forgetting anything. */
    stop() { running = false; clearTimers(); },

    readOnce: readOnce,

    /** Which nodes are on a clock, and how often — after the floor has been applied. */
    polled() {
      const out = [];
      for (const entry of sources()) {
        const every = everyOf(entry.node);
        if (every) out.push({ id: entry.id, every: every });
      }
      return out;
    },

    destroy() {
      destroyed = true;
      running = false;
      clearTimers();
      if (watching) {
        try { document.removeEventListener('visibilitychange', watching); } catch { /* no document */ }
        watching = null;
      }
    },
  };
}
