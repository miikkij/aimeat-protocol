/**
 * @file offline/queue.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The waiting changes of an app that works with no connection: an ordered list that
 *   survives a reload, sent in order when the node can be reached.
 *
 *   THE APP SENDS, THE QUEUE DECIDES WHEN. The app gives one function, send(batch). The queue calls
 *   it with the oldest entry and every entry that follows it directly under the same group key (a
 *   record, in most apps), one batch at a time. send answers true when the batch is settled: it
 *   landed, or the node refused it and the app has told the person. The batch then leaves the list.
 *   It answers false, or throws, when there was no answer at all: everything stays, and the queue
 *   tries again when the browser reports a network, on the next push, and once after retryMs.
 *
 *   NOTHING IS SENT TWICE BY THE QUEUE, BUT A SEND CAN BE CUT. A reload between a send that landed
 *   and the list being saved sends the batch again. Give each change an id the receiver takes once.
 *
 *   THE STORAGE IS HANDED IN. createQueue reads and writes through the load and save it is given,
 *   and learns of the network through the hooks it is given, so the same code runs in a unit test
 *   with a plain object behind it. index.js gives it IndexedDB and the window's events.
 * @structure createQueue(spec) → { ready, push, items, size, drop, flush, on, state, destroy }
 * @usage
 *   const q = createQueue({ load, save, send: (batch) => publish(batch), group: (e) => e.record });
 *   await q.ready;  q.push({ record: 'p1', change: {...} });
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (wish-teht-v-t-todoist-kind-task-app-on-aimeat-with-agents-app-too).
 */

/**
 * @typedef {Object} QueueSpec
 * @property {() => Promise<{ items?: any[], seq?: number } | null>} load  The kept list, or null.
 * @property {(state: { items: any[], seq: number }) => Promise<any>} save  Keep the list.
 * @property {(batch: any[]) => (boolean | Promise<boolean>)} send  Settle one batch; false or a throw means no answer.
 * @property {(entry: any) => string} [group]  Entries that follow each other under one key go out together.
 * @property {() => boolean} [online]  Whether the device reports a network. Default: always true.
 * @property {number} [retryMs]  One delayed try after a send with no answer. Default 20000; 0 turns it off.
 * @property {(fn: () => void, ms: number) => any} [setTimer]  Default setTimeout.
 * @property {(handle: any) => void} [clearTimer]  Default clearTimeout.
 */

/**
 * @param {QueueSpec} spec
 */
export function createQueue(spec) {
  /** @type {any[]} */
  let items = [];
  let seq = 0;
  let busy = false;
  let reachable = true;
  let closed = false;
  /** @type {any} */
  let retryTimer = null;
  /** @type {Promise<any>} */
  let saving = Promise.resolve();
  /** @type {Array<() => void>} */
  const listeners = [];
  const setTimer = spec.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
  const clearTimer = spec.clearTimer || function (h) { clearTimeout(h); };
  const retryMs = spec.retryMs === undefined ? 20000 : spec.retryMs;
  const keyOf = function (entry) { return spec.group ? String(spec.group(entry.value)) : '#' + entry.n; };

  function tell() { listeners.slice().forEach(function (fn) { fn(); }); }
  /** Writes follow each other, so a later list never lands before an earlier one. */
  function persist() {
    const snapshot = { items: items.map(function (e) { return { n: e.n, value: e.value }; }), seq: seq };
    saving = saving.then(function () { return spec.save(snapshot); })
      .then(null, function (err) { console.warn('[aimeat-offline] the waiting changes were not kept:', err && err.message); });
    return saving;
  }

  const ready = Promise.resolve().then(function () { return spec.load(); }).then(function (kept) {
    const had = kept && Array.isArray(kept.items) ? kept.items.filter(function (e) { return e && typeof e.n === 'number'; }) : [];
    // Entries pushed before the kept list was read come after it, numbered on from it.
    const early = items;
    seq = Math.max((kept && Number(kept.seq)) || 0, had.reduce(function (m, e) { return Math.max(m, e.n); }, 0));
    early.forEach(function (e) { e.n = ++seq; });
    items = had.concat(early);
    if (had.length) tell();
  }, function (err) {
    console.warn('[aimeat-offline] the kept changes could not be read:', err && err.message);
  });

  function retryLater() {
    if (!retryMs || closed) return;
    clearTimer(retryTimer);
    retryTimer = setTimer(function () { retryTimer = null; flush(); }, retryMs);
  }

  /**
   * Send what waits, oldest first. Answers true when the list is empty at the end, false when a
   * batch got no answer (or the device reports no network) and the rest still waits.
   * @returns {Promise<boolean>}
   */
  function flush() {
    if (closed) return Promise.resolve(false);
    if (busy) return Promise.resolve(items.length === 0);
    if (!items.length) return Promise.resolve(true);
    if (spec.online && !spec.online()) {
      if (reachable) { reachable = false; tell(); }
      return Promise.resolve(false);
    }
    busy = true;
    function next() {
      if (!items.length || closed) return Promise.resolve(true);
      const head = items[0], key = keyOf(head), batch = [];
      for (let i = 0; i < items.length && keyOf(items[i]) === key; i++) batch.push(items[i]);
      return Promise.resolve().then(function () { return spec.send(batch.map(function (e) { return e.value; })); }).then(function (settled) {
        if (!settled) return false;
        items = items.filter(function (e) { return batch.indexOf(e) < 0; });
        reachable = true;
        return persist().then(function () { tell(); return next(); });
      });
    }
    return next().then(null, function (err) {
      console.warn('[aimeat-offline] a send failed without an answer:', err && err.message);
      return false;
    }).then(function (all) {
      busy = false;
      if (!all) { reachable = false; retryLater(); }
      tell();
      return !!all;
    });
  }

  return {
    /** Resolves when the kept list has been read. push() before it is safe. */
    ready: ready,
    /**
     * Add one change at the end, keep the list, and try to send.
     * @param {any} value  The change, as plain data the browser can store.
     * @returns {Promise<any>} Resolves when the list is kept.
     */
    push: function (value) {
      items.push({ n: ++seq, value: value });
      const kept = ready.then(persist);
      tell();
      ready.then(flush);
      return kept;
    },
    /** The waiting changes, oldest first. */
    items: function () { return items.map(function (e) { return e.value; }); },
    size: function () { return items.length; },
    /**
     * Take out every waiting change the test picks (a change that depended on a refused one).
     * @param {(value: any) => boolean} test
     * @returns {number} How many left.
     */
    drop: function (test) {
      const before = items.length;
      items = items.filter(function (e) { return !test(e.value); });
      if (items.length !== before) { ready.then(persist); tell(); }
      return before - items.length;
    },
    flush: function () { return ready.then(flush); },
    /**
     * Hear every change of the list or of its state.
     * @param {() => void} fn
     * @returns {() => void} Stop hearing.
     */
    on: function (fn) {
      listeners.push(fn);
      return function () { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    /** waiting: how many changes wait; busy: a send is running; reachable: the last send got an answer. */
    state: function () { return { waiting: items.length, busy: busy, reachable: reachable }; },
    /** The device reports a network again, or lost it: index.js calls these from the window's events. */
    networkChanged: function (on) {
      if (!on) { if (reachable) { reachable = false; tell(); } return; }
      ready.then(flush);
    },
    /** Stop sending and forget the timers. The kept list stays. */
    destroy: function () { closed = true; clearTimer(retryTimer); listeners.length = 0; },
  };
}
