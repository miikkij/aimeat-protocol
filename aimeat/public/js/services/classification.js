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
 *   labelName · labelById · aiWord · aiTone · leaveWord · audienceWord · actionWord · actionTone ·
 *   readerKindWord · readerName · sourceWord · purposeWords · isSwitchRow · modeWord ·
 *   rowActionWord · itemKindWord · sentence · ACTIONS
 * @usage
 *   import { readPolicy, reviewPolicy, labelName } from '/js/services/classification.js';
 *   const view = await readPolicy('owner');
 * @version-history
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
import { apiGet, apiPut, apiPost } from '/js/api.js';
import { t, getLocale } from '/js/i18n.js';

/** The actions an audit row records, in the order the filters show them. */
export const ACTIONS = ['shown', 'used', 'refused', 'changed'];

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
  const [ws, space, rowId] = item.kind === 'row' ? String(item.key).split('/') : [];
  const target = item.kind === 'row'
    ? { kind: 'row', organism_id: item.organismId, ws, space, row_id: rowId }
    : { kind: item.kind, key: item.key, ...(item.owner ? { owner: item.owner } : {}) };
  const said = typeof opts.justification === 'string' ?opts.justification.trim() : '';
  const r = await apiPost('/v1/classification/label/review', { ...target, decision, ...(said ? { justification: said } : {}) });
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
export const actionTone = (a) => (a === 'refused' ? 'danger' : a === 'changed' ? 'attention' : 'fine');
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
  if (isSwitchRow(row)) {
    const s = /^(\S+) → (\S+)$/.exec(p);
    return s ? W('switchPurpose', { from: modeWord(s[1]), to: modeWord(s[2]) }) : p;
  }
  const m = row?.action === 'changed' ? /^(\S+) → (\S+) \(([^)]+)\)$/.exec(p) : null;
  if (!m) return p;
  const name = (id) => labelName(labelById(policy, id)) || id;
  return W('changedPurpose', { from: name(m[1]), to: name(m[2]), source: sourceWord(m[3]) });
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
