/**
 * @file iam/node-parties.js
 * @description The owner's side of the people registered to an app without an account (aimeat-parties,
 *   plan doc-mvwxcas3dom3, D4), over the node routes /v1/apps/{owner}/{file}/parties/...: the list,
 *   a role change (POST .../members with `party`), stop, resume, removal and the signup setting.
 *   MemberAdmin shows them beside the account holders, so an app has one members panel (WP9d).
 *   Every function answers the route's data, or its refusal envelope `{ ok: false, error }` as is.
 * @structure partiesState · partySetRole · partyRemove · partyStop · partyResume · partyRegistrationSet
 * @usage import { partiesState } from './node-parties.js'; const st = await partiesState(call, 'alice/app.html');
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9d).
 */

/** `owner/file.html` → the app's path prefix. */
function base(appId) {
  const [owner, filename] = String(appId).split('/');
  return '/v1/apps/' + encodeURIComponent(owner || '') + '/' + encodeURIComponent(filename || '');
}

/** Unwrap the envelope; a refusal is returned as is for the caller to read. */
async function un(p) {
  const body = await p;
  return body && body.data !== undefined ? body.data : body;
}

/**
 * The registered people and the signup setting: `{ ok: true, parties, registration, total }`, or the
 * refusal. `registration` carries the node's setting (`node_setting` off | apps-ask | on), the app's own
 * `state` (closed | requested | open | refused), whether it is `open` now, and the `role` a newcomer gets.
 * @param {(path: string, opts?: RequestInit) => Promise<any>} call
 * @param {string} appId
 */
export async function partiesState(call, appId) {
  const d = await un(call(base(appId) + '/parties'));
  if (!d || d.ok === false) return d || { ok: false, error: { message: 'No answer' } };
  return { ok: true, parties: d.parties || [], registration: d.registration || null, total: d.total || 0 };
}

/** Give a registered person a role on the roster. The node refuses a role that manages the roster. */
export function partySetRole(call, appId, partyRef, role) {
  return un(call(base(appId) + '/members', { method: 'POST', body: JSON.stringify({ party: partyRef, role: role }) }));
}

/** Remove a registered person: the sign-in ends, the roster row and everything they kept go. */
export function partyRemove(call, appId, name) {
  return un(call(base(appId) + '/parties/' + encodeURIComponent(String(name)), { method: 'DELETE' }));
}

/** Stop a registered person: the sign-in is refused, the role and the data stay. */
export function partyStop(call, appId, name) {
  return un(call(base(appId) + '/parties/' + encodeURIComponent(String(name)) + '/stop', { method: 'POST', body: '{}' }));
}

/** Let a stopped person in again. */
export function partyResume(call, appId, name) {
  return un(call(base(appId) + '/parties/' + encodeURIComponent(String(name)) + '/resume', { method: 'POST', body: '{}' }));
}

/**
 * Open or close the signup, and the role a newcomer gets. Under the node's apps-ask the opening is a
 * request the operator decides.
 * @param {{ open: boolean, role?: string }} args
 */
export function partyRegistrationSet(call, appId, args) {
  const body = { open: !!args.open };
  if (args.role) body.role = args.role;
  return un(call(base(appId) + '/parties/registration', { method: 'PUT', body: JSON.stringify(body) }));
}
