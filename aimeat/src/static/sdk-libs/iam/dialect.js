/**
 * @file iam/dialect.js
 * @description The adapter that lets one client surface speak to every in-app IAM extension on the
 *   node. Six of them exist and they disagree: the admin action is multiplexed by `op` in the ones
 *   descended from the aimeat-iam pack and by `command` in LÄÄKE's; the gate is `check` in most and
 *   `mylevel` in the Experience Center registry; the applicant queue is an explicit `request` action
 *   in one and a passive visitor log inside `check` in another. This file is where that divergence
 *   is absorbed, so nothing above it has to know which fork an app installed.
 *
 *   Detection reads the extension's own action list and input schema (GET /v1/extensions/:name is
 *   readable without a token), rather than guessing from the name. Three of the six carry EMPTY
 *   schemas — the pack declared them under a key the manifest parser ignores — so schema-based
 *   detection cannot be the only signal: the action list decides first, the schema refines, and the
 *   `op` family is the fallback because it is what the pack ships. Any app may skip detection
 *   entirely by passing `dialect`.
 * @structure DIALECTS · detectDialect(nodeUrl, ext) · callCheck / callAdmin / callRequest
 * @usage import { detectDialect, callCheck } from './dialect.js';
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 1): op | command | level, detected from the
 *     installed extension rather than assumed, so the six live forks work unchanged.
 */

/**
 * @typedef {'op'|'command'|'level'} Dialect
 *   op      — the aimeat-iam pack and its forks: check {permission|command}, admin {op}.
 *   command — LÄÄKE's gate: check {}, request {note}, admin {command}.
 *   level   — a level registry (Experience Center): mylevel {}, admin {op}. Levels, no capability
 *             vocabulary, so `caps` is empty by nature and not by failure.
 */

/** The admin op names, per dialect, for the operations this library performs. */
export const DIALECTS = {
  op: { gate: 'check', admin: 'admin', key: 'op', state: 'getState', assign: 'assign', revoke: 'revoke' },
  command: { gate: 'check', admin: 'admin', key: 'command', state: 'list', assign: 'approve', revoke: 'revoke' },
  level: { gate: 'mylevel', admin: 'admin', key: 'op', state: 'getState', assign: 'assign', revoke: 'revoke' },
};

/**
 * Ask the node what shape this extension actually has. Unauthenticated on purpose: an app should be
 * able to work out how to talk to its own gate before anybody has signed in.
 * @param {string} nodeUrl
 * @param {string} ext  Installed extension name, e.g. 'nuotta-iam'.
 * @returns {Promise<{ dialect: Dialect, actions: string[], hasRequest: boolean }>}
 */
export async function detectDialect(nodeUrl, ext) {
  const res = await fetch(nodeUrl + '/v1/extensions/' + encodeURIComponent(ext));
  if (!res.ok) {
    throw new Error('aimeat-iam: extension "' + ext + '" was not found on this node (' + res.status + ')');
  }
  const body = await res.json();
  const record = (body.data && (body.data.extension || body.data)) || {};
  const actions = (record.actions || []).map((a) => a.id);
  if (!actions.length) throw new Error('aimeat-iam: extension "' + ext + '" advertises no actions');

  // A level registry names its gate differently and holds no capability vocabulary. This is the one
  // signal that survives an empty schema, so it is tested first.
  if (actions.indexOf('mylevel') !== -1) {
    return { dialect: 'level', actions, hasRequest: false };
  }

  // Otherwise the fork is told apart by what its admin action is multiplexed on. Where the schemas
  // were dropped at install this finds nothing, and the `op` family is the right fallback: it is
  // what the pack ships and what every fork except LÄÄKE's inherited.
  const admin = (record.actions || []).find((a) => a.id === 'admin');
  const props = (admin && (admin.inputSchema || admin.input_schema) && (admin.inputSchema || admin.input_schema).properties) || {};
  const dialect = props.command && !props.op ? 'command' : 'op';
  return { dialect, actions, hasRequest: actions.indexOf('request') !== -1 };
}

/**
 * Ask the gate about the caller. Every dialect answers a different shape; normalising is the
 * caller's job (see normalise() in index.js), because only it knows the role→capability map.
 * @param {(path: string, opts?: RequestInit) => Promise<any>} call  Authed fetch returning the envelope.
 * @param {string} ext
 * @param {Dialect} dialect
 * @param {{ permission?: string, command?: string, owner?: string }} [input]
 * @returns {Promise<any>}  The action's own payload.
 */
export function callCheck(call, ext, dialect, input) {
  const d = DIALECTS[dialect];
  // The `command` gate takes no permission argument: it answers with the caller's whole capability
  // list in one go, so a per-capability question is answered locally instead of over the wire.
  const body = dialect === 'command'
    ? (input && input.owner ? { owner: input.owner } : {})
    : (input || {});
  return unwrap(call('/v1/ext/' + ext + '/' + d.gate, { method: 'POST', body: JSON.stringify(body) }));
}

/**
 * Drive the admin surface. `op` is translated to whichever key this extension multiplexes on, so a
 * caller says `admin('state')` and never learns that one fork spells it `command: 'list'`.
 * @param {(path: string, opts?: RequestInit) => Promise<any>} call
 * @param {string} ext
 * @param {Dialect} dialect
 * @param {string} op     One of the logical names in DIALECTS (state | assign | revoke) or a raw op.
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<any>}
 */
export function callAdmin(call, ext, dialect, op, args) {
  const d = DIALECTS[dialect];
  const resolved = d[op] || op;
  const body = Object.assign({}, args || {});
  body[d.key] = resolved;
  return unwrap(call('/v1/ext/' + ext + '/' + d.admin, { method: 'POST', body: JSON.stringify(body) }));
}

/**
 * Ask for access. Only the `command` dialect has a real request action; in the `op` family a
 * first-time caller is recorded passively by the gate itself, so asking is what calling already did
 * and this resolves to that fact rather than pretending to send something.
 * @param {(path: string, opts?: RequestInit) => Promise<any>} call
 * @param {string} ext
 * @param {Dialect} dialect
 * @param {boolean} hasRequest
 * @param {string} [note]
 * @returns {Promise<{ recorded: boolean, passive: boolean, note?: string, alreadyMember?: boolean }>}
 */
export async function callRequest(call, ext, dialect, hasRequest, note) {
  if (!hasRequest) {
    // Nothing to send. The visit itself is the application; say so plainly instead of returning a
    // success that did not happen.
    return { recorded: true, passive: true };
  }
  const r = await unwrap(call('/v1/ext/' + ext + '/request', {
    method: 'POST',
    body: JSON.stringify(note ? { note: note } : {}),
  }));
  return { recorded: r.recorded !== false, passive: false, note: r.note, alreadyMember: r.alreadyMember };
}

/**
 * Extension actions answer inside the standard envelope, and a sandbox refusal is a 200 with
 * `ok: false` in the payload. Return the payload either way and let the caller read `ok`.
 * @param {Promise<any>} p
 * @returns {Promise<any>}
 */
async function unwrap(p) {
  const body = await p;
  if (body && body.data !== undefined) return body.data;
  return body;
}
