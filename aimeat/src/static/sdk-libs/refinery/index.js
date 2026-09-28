/**
 * @file refinery/index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The aimeat-refinery library. Exposes AIMEAT.refinery: an app's side of the mail
 *   refinery, the batch the NODE runs (services/refinery/): read a mailbox, sort each message into a
 *   kind, read its fields from the text and the PDFs, and file it as a workspace row in a queue.
 *
 *   THE WORK IS ON THE NODE. This library starts a batch and follows it; it does not read mail or
 *   ask a model itself. So an app's batch, an agent's (aimeat_refinery_run) and a nightly schedule
 *   (kind "refinery") file the same rows the same way, and a batch keeps running when the page
 *   closes.
 *
 *   THE DEFINITION IS THE OWNER'S MEMORY RECORD `<prefix>.config`, with `<prefix>.cursor` and
 *   `<prefix>.runs` beside it. The prefix is the app's word, so an app keeps the data it wrote.
 *
 *   WHAT IS STILL THE APP'S: what an approved record is sent to, and how the queues look. move()
 *   and teach() are the two things every refinery app does to a row, so they are here.
 * @structure QUEUES · classes · definition · saveDefinition · start · status · run · rows · counts ·
 *   log · runs · restart · move · update · teach · schedule · schedules · unschedule · rowIdOf · console
 * @usage
 *   <script src="/v1/libs/aimeat-auth.js"></script>
 *   <script src="/v1/libs/aimeat-atelier.js"></script>   (only for console())
 *   <script src="/v1/libs/aimeat-refinery.js"></script>
 *   const def = await AIMEAT.refinery.definition('postinjalostamo');
 *   const run = await AIMEAT.refinery.run('postinjalostamo', { onProgress: function (r) { paint(r); } });
 *   const { rows } = await AIMEAT.refinery.rows(def, { queue: 'selkea' });
 * @version-history
 *   v1.0.0 - 2026-09-29 - Initial (wish aimeat-refinery).
 */
import { makeSession } from '../_core/session.js';
import { attach } from '../_core/namespace.js';
import { refineryConsole, addConsoleWords } from './console.js';

const { authFetch } = makeSession('aimeat-refinery.js');

/** The queues, in the order a person works through them. The first four are where a batch files. */
const QUEUES = ['selkea', 'epaselva', 'kelvoton', 'ohitettu', 'hyvaksytty', 'lahetetty', 'hylatty'];
const PREFIX_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;

/**
 * @typedef {{ organismId: string, workspaceId: string, provider?: string, spaces?: { items?: string, events?: string },
 *   rules?: Array<{ match: string, value: string, klass: string, at?: string }>, since?: string, query?: string,
 *   batchSize?: number, [key: string]: any }} RefineryDefinition
 */

/**
 * An error a person can act on, the node's code on `.code`.
 * @param {any} r
 * @param {string} fallback
 * @returns {Error & { code?: string }}
 */
function refineryError(r, fallback) {
  const err = /** @type {Error & { code?: string }} */ (new Error((r && r.error && r.error.message) || fallback));
  err.code = (r && r.error && r.error.code) || 'UNKNOWN';
  return err;
}

/** @param {string} prefix */
function checkPrefix(prefix) {
  if (!PREFIX_RE.test(String(prefix || ''))) throw new Error('A refinery prefix is lowercase letters, digits, - or _ (the definition is <prefix>.config).');
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @param {string} [fallback]
 */
async function call(path, init, fallback) {
  const r = await authFetch(path, init);
  if (!r || !r.ok) throw refineryError(r, fallback || 'The refinery call failed');
  return r.data;
}

/** @param {string} key */
async function readMemory(key) {
  const r = await authFetch('/v1/memory/' + encodeURIComponent(key));
  if (r && r.ok) return r.data ? r.data.value : null;
  if (r && r.error && r.error.code === 'NOT_FOUND') return null;
  throw refineryError(r, 'Could not read ' + key);
}

/** @param {string} key @param {any} value */
async function writeMemory(key, value) {
  return call('/v1/memory', { method: 'POST', body: JSON.stringify({ key: key, value: value, visibility: 'private' }) }, 'Could not save ' + key);
}

/** @param {RefineryDefinition} def @param {'items'|'events'} which */
function rowsPath(def, which) {
  const space = (def.spaces && def.spaces[which]) || (which === 'items' ? 'viesti' : 'tapahtuma');
  return '/v1/organisms/' + encodeURIComponent(def.organismId) + '/workspace/rows/' + encodeURIComponent(space)
    + '?ws=' + encodeURIComponent(def.workspaceId);
}

/** @param {number} ms */
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

const refinery = {
  QUEUES: QUEUES,

  /** The row id of a message: the provider and the mailbox's own message id. @param {RefineryDefinition} def @param {string} messageId */
  rowIdOf(def, messageId) { return (def.provider || 'mail') + ':' + messageId; },

  /** The class packs a definition can name: `[{ id, label, process, type, describe, fields }]`. */
  async classes() {
    const d = await call('/v1/refinery/classes', undefined, 'Could not read the class packs');
    return d.classes || [];
  },

  /** The definition at `<prefix>.config`, or null when there is none. @param {string} prefix @returns {Promise<RefineryDefinition|null>} */
  async definition(prefix) { checkPrefix(prefix); return readMemory(prefix + '.config'); },

  /** Save the definition (private). @param {string} prefix @param {RefineryDefinition} def */
  async saveDefinition(prefix, def) { checkPrefix(prefix); await writeMemory(prefix + '.config', def); return def; },

  /**
   * Start one batch; answers at once. `messageIds` runs exactly those messages again.
   * @param {string} prefix
   * @param {{ messageIds?: string[] }} [opts]
   * @returns {Promise<{ run: any, alreadyRunning: boolean }>}
   */
  async start(prefix, opts) {
    checkPrefix(prefix);
    const body = { prefix: prefix };
    if (opts && Array.isArray(opts.messageIds) && opts.messageIds.length) body.message_ids = opts.messageIds;
    const d = await call('/v1/refinery/runs', { method: 'POST', body: JSON.stringify(body) }, 'Could not start the batch');
    return { run: d.run, alreadyRunning: !!d.already_running };
  },

  /** How far a batch is. @param {string} runId */
  async status(runId) {
    const d = await call('/v1/refinery/runs/' + encodeURIComponent(runId), undefined, 'Could not read the batch');
    return d.run;
  },

  /**
   * Start a batch and follow it to the end. `onProgress(run)` is called on every change; the answer
   * is the finished run, `status` 'done' or 'failed' (with `error`). A batch already running is
   * followed instead of a second one started.
   * @param {string} prefix
   * @param {{ messageIds?: string[], onProgress?: (run: any) => void, every?: number }} [opts]
   */
  async run(prefix, opts) {
    const o = opts || {};
    const started = await refinery.start(prefix, o);
    let run = started.run;
    let seen = '';
    for (;;) {
      const mark = run.status + '|' + run.i + '|' + run.step + '|' + run.rows.length;
      if (mark !== seen && o.onProgress) { seen = mark; o.onProgress(run); }
      if (run.status !== 'running') return run;
      await sleep(o.every || 700);
      run = await refinery.status(run.id);
    }
  },

  /**
   * The rows of one queue (or all), newest first: the row bodies and a cursor for more.
   * @param {RefineryDefinition} def
   * @param {{ queue?: string, limit?: number, order?: 'asc'|'desc', cursor?: string }} [opts]
   * @returns {Promise<{ rows: any[], cursor: string|null }>}
   */
  async rows(def, opts) {
    const o = opts || {};
    let url = rowsPath(def, 'items') + '&limit=' + (o.limit || 100) + '&order=' + (o.order || 'desc');
    if (o.queue) url += '&queue=' + encodeURIComponent(o.queue);
    if (o.cursor) url += '&cursor=' + encodeURIComponent(o.cursor);
    const d = await call(url, undefined, 'Could not read the rows');
    return { rows: (d.rows || []).map(function (/** @type {any} */ r) { return r.body; }), cursor: d.cursor || null };
  },

  /**
   * How many rows each queue holds, a hundred counted at most (then '100+').
   * @param {RefineryDefinition} def
   * @returns {Promise<Record<string, number|string>>}
   */
  async counts(def) {
    /** @type {Record<string, number|string>} */
    const out = {};
    await Promise.all(QUEUES.map(async function (q) {
      const r = await refinery.rows(def, { queue: q, limit: 100 });
      out[q] = r.rows.length >= 100 ? '100+' : r.rows.length;
    }));
    return out;
  },

  /** The log rows, newest first. @param {RefineryDefinition} def @param {{ limit?: number }} [opts] */
  async log(def, opts) {
    const d = await call(rowsPath(def, 'events') + '&limit=' + ((opts && opts.limit) || 100) + '&order=desc', undefined, 'Could not read the log');
    return (d.rows || []).map(function (/** @type {any} */ r) { return Object.assign({ rowId: r.rowId }, r.body || {}); });
  },

  /** The last fifty batches, newest first. @param {string} prefix */
  async runs(prefix) { checkPrefix(prefix); const v = await readMemory(prefix + '.runs'); return Array.isArray(v) ? v : []; },

  /** Start again from the definition's first day: the next batch reads from the top. @param {string} prefix */
  async restart(prefix) {
    checkPrefix(prefix);
    const r = await authFetch('/v1/memory/' + encodeURIComponent(prefix + '.cursor'), { method: 'DELETE' });
    if (r && !r.ok && !(r.error && r.error.code === 'NOT_FOUND')) throw refineryError(r, 'Could not reset the place in the mailbox');
  },

  /**
   * Put a row in another queue, and write why in the log. `kind` is the log's word (approved,
   * sent, rejected, moved); `actor` defaults to the person.
   * @param {RefineryDefinition} def
   * @param {any} row
   * @param {string} queue
   * @param {{ kind?: string, detail?: any, actor?: string }} [opts]
   */
  async move(def, row, queue, opts) {
    if (QUEUES.indexOf(queue) < 0) throw new Error('Unknown queue ' + queue + '. The queues are ' + QUEUES.join(', ') + '.');
    const o = opts || {};
    return refinery.update(def, row, { queue: queue, status: queue },
      { kind: o.kind || 'moved', actor: o.actor, detail: Object.assign({ from: row.queue, to: queue }, o.detail || {}) });
  },

  /**
   * Change a row (a field a person corrected, a note) and write why in the log. The row keeps its
   * id, so the change replaces it.
   * @param {RefineryDefinition} def
   * @param {any} row
   * @param {Record<string, any>} patch
   * @param {{ kind?: string, detail?: any, actor?: string }} [opts]
   */
  async update(def, row, patch, opts) {
    const o = opts || {};
    const next = Object.assign({}, row, patch, { updatedAt: new Date().toISOString() });
    const rowId = refinery.rowIdOf(def, row.messageId);
    await call(rowsPath(def, 'items'), { method: 'POST', body: JSON.stringify({ body: next, row_id: rowId, occurred_at: row.date || undefined }) }, 'Could not save the row');
    const logged = await authFetch(rowsPath(def, 'events'), { method: 'POST', body: JSON.stringify({ body: {
      app: def.app || '', kind: o.kind || 'edited', message: rowId, subject: row.subject || '', actor: o.actor || 'person',
      at: new Date().toISOString(), detail: o.detail || {},
    } }) });
    // The row is the record; a log line that did not land is said, not fatal.
    if (!logged || !logged.ok) console.warn('[aimeat-refinery] the log row was not written:', logged && logged.error);
    return next;
  },

  /**
   * Teach the refinery: this sender (scope 'from'), this domain ('domain') or this message
   * ('message') is of kind `klass`. The rule goes into the definition and answers before the model
   * from now on; the message is then run again. Records the person's override on the decision
   * when aimeat-decide.js is on the page.
   * @param {string} prefix
   * @param {any} row
   * @param {string} klass
   * @param {'from'|'domain'|'message'} [scope]
   */
  async teach(prefix, row, klass, scope) {
    const def = await refinery.definition(prefix);
    if (!def) throw new Error('There is no refinery definition at ' + prefix + '.config.');
    const how = scope || 'domain';
    const m = /<([^>]+)>/.exec(row.from || '');
    const addr = (m ? m[1] : String(row.from || '')).trim().toLowerCase();
    const value = how === 'from' ? addr : how === 'domain' ? (addr.split('@')[1] || '') : row.messageId;
    if (!value) throw new Error('This message has no sender to learn from; teach it by message instead.');
    def.rules = (def.rules || []).filter(function (r) { return !(r.match === how && r.value === value); });
    def.rules.unshift({ match: how, value: value, klass: klass, at: new Date().toISOString() });
    await refinery.saveDefinition(prefix, def);
    const decide = /** @type {any} */ (window).AIMEAT && /** @type {any} */ (window).AIMEAT.decide;
    if (row.decisionId && decide && decide.review) {
      try { await decide.review(row.decisionId, 'overridden', { override: klass }); } catch (e) { console.warn('[aimeat-refinery] the decision review was not recorded:', e); }
    }
    return refinery.run(prefix, { messageIds: [row.messageId] });
  },

  /**
   * Put the refinery on the node's clock: one batch each time `cron` fires, also when the page is
   * closed. Needs connections:read-through, ai:use, organism:rows and memory:write.
   * @param {string} prefix
   * @param {{ cron: string, timezone?: string, name?: string }} spec
   */
  async schedule(prefix, spec) {
    checkPrefix(prefix);
    const d = await call('/v1/schedules', { method: 'POST', body: JSON.stringify({
      kind: 'refinery', cron: spec.cron, timezone: spec.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      display_name: spec.name || ('Refinery ' + prefix), input: { prefix: prefix },
    }) }, 'Could not create the schedule');
    return d.schedule;
  },

  /** This definition's schedules. Reading them needs the workflow:read scope. @param {string} prefix */
  async schedules(prefix) {
    const d = await call('/v1/schedules', undefined, 'Could not read the schedules');
    const list = Array.isArray(d.schedules) ? d.schedules : Array.isArray(d.managed) ? d.managed : [];
    return list.filter(function (/** @type {any} */ s) { return s.type === 'refinery' && s.input && s.input.prefix === prefix; });
  },

  /** Take a schedule off the clock. @param {string} id */
  async unschedule(id) { await call('/v1/schedules/' + encodeURIComponent(id), { method: 'DELETE' }, 'Could not remove the schedule'); },

  /**
   * The workbench console: the batch figure with its button, the steps and tallies, and the rows
   * of the batch as they land. Built from the atelier kit's parts (aimeat-atelier.js on the page).
   * @param {{ target: string|Element, prefix: string, total?: number, classLabel?: (klass: string) => string,
   *   onRow?: (row: any) => void, onDone?: (run: any) => void, onError?: (err: Error) => void }} spec
   */
  console(spec) { return refineryConsole(refinery, spec); },
};

attach('refinery', refinery);
// The console's words go to the kit now, before a page listens for new words (console.js says why).
addConsoleWords();
export default refinery;
