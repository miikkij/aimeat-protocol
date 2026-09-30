/**
 * @file public/js/services/classification.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Client for content classification (TARGET-082 V5): the policy of one level (the
 *   node, the signed-in owner, or an organism), a person's review of an AI's proposal to loosen it,
 *   and the audit log of that level. Also the words both surfaces use for a label (its name in the
 *   reader's language, what an AI sees of it, whether it may leave the organism, who may read it) and
 *   for an audit row (what happened, who read it, what a reclassification changed), so the Data Wallet and the admin Security page say
 *   the same thing the same way.
 *
 *   The review is REST only and needs the person's own session: the server refuses it from an agent
 *   or an app (routes/classification.ts), which is why the two pages carry the Accept and Reject
 *   buttons.
 * @structure readPolicy · writePolicy · reviewPolicy · readAudit · listLabels · reviewLabel ·
 *   targetBody · readExceptions · makeException · withdrawException ·
 *   labelName · labelById · aiWord · aiTone · leaveWord · audienceWord · actionWord · actionTone ·
 *   readerKindWord · readerName · sourceWord · purposeWords · exceptionActWord · exceptionState ·
 *   exceptionPurposeWords · isSwitchRow · modeWord · rowActionWord · itemKindWord · sentence · ACTIONS
 * @usage
 *   import { readPolicy, reviewPolicy, labelName } from '/js/services/classification.js';
 *   const view = await readPolicy('owner');
 * @version-history
 *   v1.6.0 — 2026-09-30 — The exceptions list (Jouni's decisions of 2026-09-30): readExceptions,
 *     makeException and withdrawException, the words for an exception (exceptionActWord,
 *     exceptionState), and the log's filter and words for an exception row (ACTIONS 'exception',
 *     exceptionPurposeWords). reviewLabel's target is targetBody, shared with makeException.
 *   v1.5.0 — 2026-09-30 — rowActionWord: a change of the node's switch in the log says "setting
 *     changed", not the word of a label that changed ("reclassified").
 *   v1.4.0 — 2026-09-30 — reviewLabel takes the person's reason (`justification`) for an accepted
 *     suggestion that lowers a classification which needs one (TARGET-082 review, item 3).
 *   v1.3.0 — 2026-09-29 — listLabels and reviewLabel (the Data Wallet's waiting suggestions and
 *     classified items), and the words for a change of the node's switch in the log (isSwitchRow,
 *     modeWord, itemKindWord).
 *   v1.2.0 — 2026-09-29 — readerName, sourceWord and purposeWords: a log row says "Content Classifier"
 *     for the server's own classifier, and a reclassification's purpose in the reader's language (the
 *     labels' names and who gave it) instead of the server's ids.
 *   v1.1.0 — 2026-09-29 — sentence(): a sentence whose first word is a name said in words ("the agent
 *     bot of sandbox proposed it…") starts with a capital letter, in the reader's language.
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V5).
 */
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { t, getLocale } from '/js/i18n.js';

/** The actions an audit row records, in the order the filters show them. */
export const ACTIONS = ['shown', 'used', 'refused', 'changed', 'exception'];

/**
 * The policy of one level: { level, subject, mode, active, stored, effective, proposal, history }.
 * @param {'owner'|'node'|'organism'} level
 * @param {string} [organismId]
 * @returns {Promise<any>}
 */
export async function readPolicy(level, organismId) {
  const q = new URLSearchParams({ level });
  if (organismId) q.set('organism_id', organismId);
  const r = await apiGet(`/v1/classification/policy?${q}`);
  return r?.data ?? null;
}

/**
 * Replace a level's stored policy. The whole level is sent: read it first and send it back changed.
 * @param {'owner'|'node'|'organism'} level
 * @param {object} policy
 * @param {string} [organismId]
 * @returns {Promise<any>} { applied, pending?, loosens, view }
 */
export async function writePolicy(level, policy, organismId) {
  const r = await apiPut('/v1/classification/policy', { level, ...(organismId ? { organism_id: organismId } : {}), policy });
  return r?.data ?? null;
}

/**
 * A person accepts or rejects the AI's waiting proposal to loosen a level's policy.
 * @param {'owner'|'node'|'organism'} level
 * @param {'accept'|'reject'} decision
 * @param {string} [organismId]
 * @returns {Promise<any>} { applied, loosens, view }
 */
export async function reviewPolicy(level, decision, organismId) {
  const r = await apiPost('/v1/classification/policy/review', { level, ...(organismId ? { organism_id: organismId } : {}), decision });
  return r?.data ?? null;
}

/**
 * A page of the classifications stored on the signed-in person's content (GET /v1/classification/labels).
 * @param {{ level?: 'owner'|'organism', organismId?: string, label?: string, pending?: boolean, limit?: number, cursor?: string }} [opts]
 * @returns {Promise<{ items: Array<any>, next: string|null }>}
 */
export async function listLabels(opts = {}) {
  const q = new URLSearchParams({ level: opts.level || 'owner' });
  if (opts.organismId) q.set('organism_id', opts.organismId);
  if (opts.label) q.set('label', opts.label);
  if (opts.pending) q.set('pending', 'true');
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.cursor) q.set('cursor', opts.cursor);
  const r = await apiGet(`/v1/classification/labels?${q}`);
  return { items: r?.data?.items ?? [], next: r?.data?.next ?? null };
}

/**
 * A person accepts or rejects the suggestion waiting on one item (POST /v1/classification/label/review).
 * An explorer item carries its own address: kind, key, whose namespace holds it (`owner`: the person,
 * or one of their agents or apps), and for a row its organism and row key.
 * Accepting a suggestion that lowers a classification which needs a reason carries the person's
 * words as `justification`.
 * @param {{ kind: string, key: string, owner?: string|null, organismId?: string|null }} item
 * @param {'accept'|'reject'} decision
 * @param {{ justification?: string }} [opts]
 * @returns {Promise<any>} { applied, label, from, source, locked }
 */
export async function reviewLabel(item, decision, opts = {}) {
  const said = typeof opts.justification === 'string' ?opts.justification.trim() : '';
  const r = await apiPost('/v1/classification/label/review', { ...targetBody(item), decision, ...(said ? { justification: said } : {}) });
  return r?.data ?? null;
}

/**
 * An explorer item's address as the label and exception endpoints read it: a row by its organism,
 * workspace, space and row id; anything else by kind, key and whose namespace holds it.
 * @param {{ kind: string, key: string, owner?: string|null, organismId?: string|null }} item
 * @returns {Record<string, string>}
 */
function targetBody(item) {
  if (item.kind === 'row') {
    const [ws, space, rowId] = String(item.key).split('/');
    return { kind: 'row', organism_id: item.organismId, ws, space, row_id: rowId };
  }
  return { kind: item.kind, key: item.key, ...(item.owner ? { owner: item.owner } : {}) };
}

/**
 * The exceptions list of one level, newest first (GET /v1/classification/exceptions). Level node is
 * the whole server's, for an operator.
 * @param {'owner'|'organism'|'node'} level
 * @param {{ organismId?: string, action?: string, limit?: number }} [opts]
 * @returns {Promise<Array<any>>} the exceptions
 */
export async function readExceptions(level, opts = {}) {
  const q = new URLSearchParams({ level });
  if (opts.organismId) q.set('organism_id', opts.organismId);
  if (opts.action) q.set('action', opts.action);
  if (opts.limit) q.set('limit', String(opts.limit));
  const r = await apiGet(`/v1/classification/exceptions?${q}`);
  return r?.data?.exceptions ?? [];
}

/**
 * A person makes an exception for one explorer item (POST /v1/classification/exceptions): the item
 * may leave ('leave'), or an AI may see it and send it out ('ai-send'), despite its classification.
 * `until` is an ISO time, or empty for no end.
 * @param {{ kind: string, key: string, owner?: string|null, organismId?: string|null }} item
 * @param {{ action: 'leave'|'ai-send', reason: string, until?: string|null }} what
 * @returns {Promise<any>} the exception
 */
export async function makeException(item, what) {
  const r = await apiPost('/v1/classification/exceptions', {
    ...targetBody(item), action: what.action, reason: String(what.reason || '').trim(), ...(what.until ? { until: what.until } : {}),
  });
  return r?.data ?? null;
}

/**
 * Withdraw an exception (DELETE /v1/classification/exceptions/:id). It stays on the list, withdrawn.
 * @param {string} id
 * @returns {Promise<any>} the exception
 */
export async function withdrawException(id) {
  const r = await apiDelete(`/v1/classification/exceptions/${encodeURIComponent(id)}`);
  return r?.data ?? null;
}

/**
 * The audit log of one level, newest first.
 * @param {'owner'|'node'|'organism'} level
 * @param {{ action?: string, since?: string, limit?: number, organismId?: string }} [opts]
 * @returns {Promise<Array<any>>} the rows
 */
export async function readAudit(level, opts = {}) {
  const q = new URLSearchParams({ level });
  if (opts.organismId) q.set('organism_id', opts.organismId);
  if (opts.action && opts.action !== 'all') q.set('action', opts.action);
  if (opts.since) q.set('since', opts.since);
  if (opts.limit) q.set('limit', String(opts.limit));
  const r = await apiGet(`/v1/classification/audit?${q}`);
  return r?.data?.rows ?? [];
}

/* ── The words ────────────────────────────────────────────────────────────────────────────────── */

const W = (key, vars) => t('classification.' + key, vars);

/** A label's name in the reader's language, then English, then its id. */
export function labelName(label) {
  if (!label) return '';
  const lang = String(getLocale() || 'en').slice(0, 2);
  return label.name?.[lang] || label.name?.en || label.id;
}

/** The label with this id in a policy, or undefined. */
export function labelById(policy, id) {
  return (policy?.labels || []).find((l) => l.id === id);
}

/** What an AI sees of content with this label: hidden, a warning, or allowed. */
export const aiWord = (v) => W('ai.' + (v === 'hidden' || v === 'warning' ? v : 'allowed'));
/** The status tone of what an AI sees. */
export const aiTone = (v) => (v === 'hidden' ? 'danger' : v === 'warning' ? 'attention' : 'fine');
/** Whether content with this label may leave the organism. */
export const leaveWord = (may) => W(may ? 'leave.yes' : 'leave.no');

/** Who may read content with this label: everyone who has access anyway, or the listed readers. */
export function audienceWord(aud) {
  const parts = [
    ...(aud?.roles || []).map((r) => W('audience.role', { name: r })),
    ...(aud?.groups || []).map((g) => W('audience.group', { name: g })),
    ...(aud?.people || []),
  ];
  return parts.length ? parts.join(', ') : W('audience.any');
}

/** What an audit row says happened. */
export const actionWord = (a) => W('action.' + (ACTIONS.includes(a) ? a : 'changed'));
/** The status tone of an audit row's action. */
export const actionTone = (a) => (a === 'refused' ? 'danger' : a === 'changed' || a === 'exception' ? 'attention' : 'fine');
/** Who the reader of an audit row was: a person, an AI, the system, or someone not signed in. */
export const readerKindWord = (k) => W('reader.' + (['human', 'ai', 'system', 'anonymous'].includes(k) ? k : 'system'));

/**
 * The reader of an audit row in words when it is this server's own Content Classifier: its rules and
 * its model write as `classifier@<node>` (services/classification/classifier.ts), of kind system or
 * ai. Null for any other reader, whose own name the page shows.
 * @param {string} reader @param {string} kind
 * @returns {string|null}
 */
export function readerName(reader, kind) {
  if (kind !== 'system' && kind !== 'ai') return null;
  return /^classifier(@|$)/.test(String(reader || '')) ? W('classifierName') : null;
}

/** The locale key of each source a classification can come from (services/classification/labels.ts). */
const SOURCES = { human: 'human', 'human-via-ai': 'humanViaAi', ai: 'ai', rule: 'rule', default: 'default' };
/** Who gave a classification, as a word: a person, a person through an AI, an AI, a rule, the default. */
export const sourceWord = (s) => (SOURCES[s] ? W('source.' + SOURCES[s]) : String(s ?? ''));

/**
 * What an audit row's purpose says, in the reader's language. A reclassification carries
 * "<from id> → <to id> (<source>)" (services/classification/labels.ts): the two ids become the
 * labels' names and the source a word. Any other purpose (the capability and model an AI read the
 * content with) is shown as the server wrote it.
 * @param {any} policy the effective policy, for the labels' names @param {any} row an audit row
 * @returns {string}
 */
export function purposeWords(policy, row) {
  const p = String(row?.purpose ?? '');
  if (row?.action === 'exception') return exceptionPurposeWords(p);
  if (isSwitchRow(row)) {
    const s = /^(\S+) → (\S+)$/.exec(p);
    return s ? W('switchPurpose', { from: modeWord(s[1]), to: modeWord(s[2]) }) : p;
  }
  const m = row?.action === 'changed' ? /^(\S+) → (\S+) \(([^)]+)\)$/.exec(p) : null;
  if (!m) return p;
  const name = (id) => labelName(labelById(policy, id)) || id;
  return W('changedPurpose', { from: name(m[1]), to: name(m[2]), source: sourceWord(m[3]) });
}

/* ── The exceptions list ──────────────────────────────────────────────────────────────────────── */

/** The locale key of each act an exception records (services/classification/exceptions.ts). */
const EXCEPTION_ACTS = { leave: 'leave', 'ai-send': 'aiSend', lower: 'lower', policy: 'policy', review: 'review' };

/**
 * What an exception let happen, in words: a person's "may leave" or "an AI may send it", or an app's
 * act ("app lowered the classification"). An app's own exception of a person's kind reads as the
 * person's does.
 * @param {{ action: string, auto?: boolean }} e
 * @returns {string}
 */
export function exceptionActWord(e) {
  const act = EXCEPTION_ACTS[e?.action];
  if (!act) return String(e?.action ?? '');
  return W((e.auto || (act !== 'leave' && act !== 'aiSend') ? 'exc.auto.' : 'exc.act.') + act);
}

/**
 * Where an exception stands at `now`: 'active' (a person's, in force), 'withdrawn', 'expired', or
 * 'recorded' (an app's act, which grants nothing).
 * @param {{ auto?: boolean, withdrawnAt?: string|null, until?: string|null }} e
 * @param {string} [now] ISO
 * @returns {'active'|'withdrawn'|'expired'|'recorded'}
 */
export function exceptionState(e, now = new Date().toISOString()) {
  if (e?.withdrawnAt) return 'withdrawn';
  if (e?.auto) return 'recorded';
  return e?.until && e.until <= now ? 'expired' : 'active';
}

/** The locale key of each place an exception's use sent the item (reader.ts destinationOf). */
const WHERE = { shown: 'shown', export: 'export', share: 'share', federation: 'federation', external: 'external' };

/**
 * An exception row of the audit log in words. The server writes "<event> <id> (<act>[, automatic]):
 * <reason>", and for a use "used <id> (<act>) → <where>: <reason>" (exceptions.ts); the page says
 * the event, the act and the reason, and where the item went, instead of the ids.
 * @param {string} p
 * @returns {string}
 */
function exceptionPurposeWords(p) {
  const m = /^(made|added to|used|withdrawn)(?: \S+)? \(([a-z-]+)((?:, [a-z ]+)*)\)(?: → (\S+?))?: ([\s\S]*)$/.exec(p);
  if (!m) return p;
  const event = W('exc.event.' + (m[1] === 'added to' ? 'addedTo' : m[1]));
  const act = exceptionActWord({ action: m[2], auto: /automatic/.test(m[3]) });
  const kind = m[4] ? m[4].split(':')[0] : '';
  if (!kind) return W('exc.purpose', { event, act, reason: m[5] });
  return W('exc.purposeUsed', { event, act, reason: m[5], where: WHERE[kind] ? W('exc.where.' + WHERE[kind]) : m[4] });
}

/**
 * True for an audit row that records a change of the node's switch (services/classification/switch.ts):
 * key `classification.mode`, the new mode as its label, `<from> → <to>` as its purpose.
 * @param {any} row
 * @returns {boolean}
 */
export function isSwitchRow(row) {
  return row?.action === 'changed' && row?.key === 'classification.mode';
}

/** The switch's state in words: off, each owner decides, or on for everyone. */
export const modeWord = (m) => W('modeWord.' + (m === 'owner' || m === 'all' ? m : 'off'));

/**
 * What one audit row says happened: a change of the node's switch is a setting changed, every other
 * row its action's word ("reclassified" for a label that changed).
 * @param {any} row
 * @returns {string}
 */
export const rowActionWord = (row) => (isSwitchRow(row) ? W('action.setting') : actionWord(row?.action));

/** What an audit row's item is, in words: the kind of content, or the node's switch. */
export const itemKindWord = (row) => (isSwitchRow(row) ? W('kind.switch') : t('classification.kind.' + row?.kind));

/**
 * A finished sentence with a capital letter at its start. A locale string that opens with a
 * placeholder ("{by} proposed it on {date}.") starts lower case when the value is a name said in
 * words, so the caller passes the interpolated sentence through this.
 * @param {string} s
 * @returns {string}
 */
export function sentence(s) {
  const str = String(s ?? '');
  if (!str) return str;
  const lang = String(getLocale() || 'en').slice(0, 2);
  return str.charAt(0).toLocaleUpperCase(lang) + str.slice(1);
}
