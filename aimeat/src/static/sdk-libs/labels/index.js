/**
 * @file labels/index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The aimeat-labels library (TARGET-082 V5). Exposes AIMEAT.labels: the classification
 *   of a piece of content (public, internal, confidential, or a level the owner or an organism
 *   added), the policy that defines the labels, the audit log, and the classifier scan. Served at
 *   /v1/libs/aimeat-labels.js over the /v1/classification/* routes.
 *
 *   A LABEL IS METADATA BESIDE THE CONTENT. Setting one changes no value; it decides which people
 *   and which AI may read the content and whether it may leave its organism.
 *
 *   AN APP IS THE PERSON'S SCREEN. The node reads an app grant as the signed-in person, so set()
 *   and review() from an app are that person's own decisions and apply at once. Call them only from
 *   a choice the person made on the screen, never from the app's or an AI's own judgement.
 *
 *   WARNINGS. Content with a warning classification carries classificationWarning when it reaches
 *   an AI reader; warningOf() and renderWarning() read it (warning.js). Content hidden from AI reads
 *   as absent to an AI, and an AI call that names it by key fails with the code CLASSIFIED.
 * @structure labelsError · call · targetParams · get · set · review · policy · audit · scan ·
 *   isClassified · warningOf / renderWarning (warning.js) · attach('labels', …)
 * @usage
 *   <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-labels.js"></script>
 *   const v = await AIMEAT.labels.get('notes.2026-09');       // { label, labelDetail, source, locked, suggestion, history }
 *   await AIMEAT.labels.set({ key: 'notes.2026-09', label: picked });   // from the person's own pick
 *   AIMEAT.labels.renderWarning(item, cardEl);
 * @version-history
 *   v1.0.0 - 2026-09-29 - Initial (TARGET-082 V5).
 */
import { makeSession } from '../_core/session.js';
import { attach } from '../_core/namespace.js';
import { warningOf, renderWarning } from './warning.js';

const { authFetch } = makeSession('aimeat-labels.js');

/**
 * Words for the refusals a person can act on. The node's own message wins when it sends one.
 * @type {Record<string, string>}
 */
const HUMAN = {
  CLASSIFIED: 'This content is classified so that an AI may not read it. Nothing was sent to the AI.',
  AUDIENCE_LOCKOUT: 'This label limits who may read the content, and you are not among them. Pick another label, or add yourself to its audience first.',
  JUSTIFICATION_REQUIRED: 'Lowering this label needs a written reason: why the content is less sensitive than its label says.',
  POLICY_DILUTES: 'A lower level may only make the node policy stricter.',
  INVALID_POLICY: 'The policy is not valid.',
  PERSON_REQUIRED: 'A person decides this, signed in themselves.',
  AI_LABELLING_OFF: 'The classification policy does not let an AI set labels. A person sets the label.',
  LABEL_UNKNOWN: 'That label is not active in the policy that applies here.',
  CLASSIFICATION_OFF: 'Classification is off on this server.',
  NO_SUGGESTION: 'Nothing is waiting for a review on this content.',
  NO_PROPOSAL: 'Nothing is waiting for a review on this policy.',
  OPERATOR_REQUIRED: 'Only an operator of this server changes the node policy.',
  NOT_FOUND: 'No such content, or it is not yours to label.',
  FOREIGN_VISITOR: 'A visitor from another node labels nothing here.',
  AUTH_REQUIRED: 'Sign in to see or change a classification.',
  INVALID_INPUT: 'The request does not name the content the way the node expects.',
};

/**
 * Turn an error envelope into an Error with the node's code on .code.
 * @param {any} r
 * @returns {Error & { code?: string, details?: any }}
 */
function labelsError(r) {
  const e = r && r.error;
  const code = (e && e.code) || 'UNKNOWN';
  const err = /** @type {Error & { code?: string, details?: any }} */ (
    new Error((e && e.message) || HUMAN[code] || 'The classification call failed'));
  err.code = code;
  if (e && e.details !== undefined && e.details !== null) err.details = e.details;
  return err;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function call(path, init) {
  const r = await authFetch(path, init);
  if (!r || r.ok === false) throw labelsError(r);
  return r.data;
}

/**
 * @param {string} method
 * @param {string} path
 * @param {any} body
 */
const send = (method, path, body) =>
  call(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** @param {Record<string, any>} params */
function query(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const qs = p.toString();
  return qs ? '?' + qs : '';
}

/**
 * What a piece of content is, in the node's field names.
 * A string is a memory key. { key } is a memory key (an organism workspace key included);
 * { kind: 'file', key } is a stored file; a row is { row: { organismId, ws, space, rowId } } or the
 * same fields with kind: 'row'.
 * @typedef {string | { key?: string, kind?: 'memory'|'file'|'row', organismId?: string, ws?: string, space?: string, rowId?: string, row?: { organismId: string, ws: string, space: string, rowId: string } }} LabelTarget
 */

/**
 * @param {LabelTarget} t
 * @returns {Record<string, string|undefined>}
 */
function targetParams(t) {
  if (typeof t === 'string') return { kind: 'memory', key: t };
  const o = /** @type {any} */ (t || {});
  const row = o.row || (o.kind === 'row' ? o : null);
  if (row) {
    return {
      kind: 'row', organism_id: row.organismId ?? row.organism_id, ws: row.ws, space: row.space,
      row_id: row.rowId ?? row.row_id,
    };
  }
  return { kind: o.kind || 'memory', key: o.key };
}

/**
 * The classification of one piece of content: { target, label, labelDetail, source, locked,
 * suggestion, history }. labelDetail is the label as the policy defines it: { id, name: { fi, en, es },
 * rank, color, description, aiVisibility: 'hidden'|'warning'|'allowed', audit, mayLeaveOrganism,
 * lowerNeedsJustification, audience }. source is default, human, human-via-ai, ai or rule; locked
 * is true when a person set it. suggestion is a waiting label a person accepts or rejects.
 * @param {LabelTarget} target
 */
function get(target) {
  return call('/v1/classification/label' + query(targetParams(target)));
}

/**
 * Give content a label. From an app this is the signed-in person's own decision and applies at
 * once, so call it only with the label the person picked. Lowering from a label that asks for a
 * reason needs justification. humanSaid carries the person's own words, verbatim, when the app
 * relays an instruction they gave elsewhere (a chat line). Resolves with { applied, label, from,
 * source, locked, pending? }.
 * @param {LabelTarget & { label: string, justification?: string, humanSaid?: string, confidence?: number, reason?: string }} input
 */
async function set(input) {
  const o = /** @type {any} */ (input || {});
  if (typeof o.label !== 'string' || !o.label) throw new Error('label is required: a label id from policy()');
  return send('PUT', '/v1/classification/label', {
    ...targetParams(o), label: o.label, justification: o.justification, humanSaid: o.humanSaid,
    confidence: o.confidence, reason: o.reason,
  });
}

/**
 * The person accepts or rejects the label waiting as a suggestion on the content. Accepting is the
 * person setting that label.
 * @param {LabelTarget & { decision: 'accept'|'reject', justification?: string, humanSaid?: string }} input
 */
async function review(input) {
  const o = /** @type {any} */ (input || {});
  if (o.decision !== 'accept' && o.decision !== 'reject') throw new Error('decision is accept or reject');
  return send('POST', '/v1/classification/label/review', {
    ...targetParams(o), decision: o.decision, justification: o.justification, humanSaid: o.humanSaid,
  });
}

/**
 * The policy that applies at one level: the labels (id, name, rank, colour, what an AI may do),
 * the detection rules, the default label and the AI mode, and whether classification is on.
 * level is node, owner (the default) or organism, which needs organismId.
 * @param {{ level?: 'node'|'owner'|'organism', organismId?: string }} [opts]
 */
function policy(opts) {
  const o = opts || {};
  return call('/v1/classification/policy' + query({ level: o.level, organism_id: o.organismId }));
}

/**
 * The audit log of a level: which classified items were shown to or used by an AI, which were
 * refused and which labels changed, one row per reader, item and action per minute, with a count.
 * @param {{ level?: 'node'|'owner'|'organism', organismId?: string, since?: string, action?: 'shown'|'used'|'refused'|'changed', limit?: number }} [opts]
 */
function audit(opts) {
  const o = opts || {};
  return call('/v1/classification/audit' + query({
    level: o.level, organism_id: o.organismId, since: o.since, action: o.action, limit: o.limit,
  }));
}

/**
 * Ask the Content Classifier to judge memory keys. Up to 20 named keys are judged now; more keys,
 * or a prefix, wait in a queue the node works through. Its label follows the AI rules: it never
 * lowers a label and never changes one a person set. Resolves with { classified, queued, missing }.
 * @param {{ key?: string, keys?: string[], prefix?: string }} input
 */
async function scan(input) {
  const o = input || {};
  if (o.prefix) return send('POST', '/v1/classification/scan', { prefix: o.prefix });
  const keys = o.keys || (o.key ? [o.key] : null);
  if (!keys || keys.length === 0) throw new Error('scan needs key, keys or prefix');
  return send('POST', '/v1/classification/scan', { keys });
}

/**
 * True when an error is the node refusing to give classified content to an AI. Show the person the
 * message and do not retry: the same call is refused again until the label changes.
 * @param {any} err
 * @returns {boolean}
 */
function isClassified(err) {
  return !!err && err.code === 'CLASSIFIED';
}

export const labels = { get, set, review, policy, audit, scan, warningOf, renderWarning, isClassified };

attach('labels', labels);
