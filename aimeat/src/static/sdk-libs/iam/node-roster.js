/**
 * @file iam/node-roster.js
 * @description Talk to the NODE's own member roster instead of an extension's.
 *
 *   This is the shape to prefer for anything new. The three things an app could never do for itself
 *   all live here: the person is told when they are approved or removed, the list is private rather
 *   than served by a world-readable namespace, and their free access moves with their role. An
 *   extension is still welcome to hold the capability vocabulary — which role may do what is
 *   genuinely per-app — and it reads the role the node resolved through `ctx.caller.member`.
 *
 *   The functions below answer in the SAME shapes the extension dialects do, so MemberAdmin and
 *   JoinPanel work against either without knowing which they are driving.
 * @structure nodeMe · nodeState · nodeAssign · nodeRevoke · nodeRequest
 * @usage AIMEAT.iam.init({ app: 'alice/app.html' })
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 2).
 */

/** `owner/file.html` → the roster path prefix. */
function base(appId) {
  const [owner, filename] = String(appId).split('/');
  return '/v1/apps/' + encodeURIComponent(owner || '') + '/' + encodeURIComponent(filename || '') + '/members';
}

/** Unwrap the envelope; a refusal carries its own shape and is returned as-is for the caller to read. */
async function un(p) {
  const body = await p;
  return body && body.data !== undefined ? body.data : body;
}

/**
 * The caller's own standing, in the shape normalise() expects from a gate.
 * @param {(path: string, opts?: RequestInit) => Promise<any>} call
 * @param {string} appId
 * @returns {Promise<any>}
 */
export async function nodeMe(call, appId) {
  const d = await un(call(base(appId) + '/me'));
  const m = d && d.member;
  return {
    role: d && d.isOwner ? 'owner' : (m ? m.role : null),
    level: m && typeof m.level === 'number' ? m.level : (d && d.isOwner ? 0 : null),
    isOwner: !!(d && d.isOwner),
    member: !!m,
    since: m ? m.since : null,
    // The node roster is the person's row by construction, so a role always resolved through them.
    via: m ? 'owner' : 'none',
    requested: d ? d.requested : null,
  };
}

/**
 * Roster + pending asks, in the shape the panel reads from an `op`-family getState.
 * @param {(path: string, opts?: RequestInit) => Promise<any>} call
 * @param {string} appId
 * @param {string[]} roles  The app's own role vocabulary, which the NODE does not hold.
 */
export async function nodeState(call, appId, roles) {
  const d = await un(call(base(appId)));
  if (d && d.ok === false) return d;
  const members = (d && d.members) || [];
  // The panel drives its role selector from `roles`. The node deliberately does not own the
  // vocabulary, so it is supplied by the app and widened with whatever the roster already contains:
  // a role in use must never vanish from the selector just because the app forgot to list it.
  const seen = new Set(roles || []);
  for (const m of members) if (m.role) seen.add(m.role);
  /** @type {Record<string, string[]>} */
  const roleMap = {};
  for (const r of seen) roleMap[r] = [];
  return {
    ok: true,
    isOwner: true,
    roles: roleMap,
    levels: {},
    commands: [],
    config: {},
    assignments: Object.fromEntries(members.map((m) => [m.owner, m.role])),
    requests: (d && d.requests) || [],
    // Everybody who turned up and holds no role. The panel has had a section for these since it was
    // written and the node had nothing to put in it, so it rendered "nobody has turned up yet" on
    // apps people were visiting daily.
    seen: Object.fromEntries(((d && d.seen) || []).map((v) => [v.owner, { visits: v.visits, lastSeen: v.lastSeen }])),
    members,
  };
}

/**
 * Approve, or change a role. `offerings` reaches the node, which reconciles the free access to match
 * — the loop every app used to run itself, in both directions.
 */
export function nodeAssign(call, appId, args) {
  const body = {
    account: args.ghii || args.owner || args.account,
    role: args.role,
  };
  if (args.note) body.note = args.note;
  if (Array.isArray(args.offerings)) body.offerings = args.offerings;
  return un(call(base(appId), { method: 'POST', body: JSON.stringify(body) }));
}

/** Remove a member; the node tells them and withdraws what their role carried. */
export function nodeRevoke(call, appId, args) {
  const who = args.ghii || args.owner || args.account;
  return un(call(base(appId) + '/' + encodeURIComponent(String(who)), { method: 'DELETE' }));
}

/** Decline an ask. */
export function nodeDecline(call, appId, args) {
  const who = args.ghii || args.owner || args.account;
  return un(call(base(appId) + '/requests/' + encodeURIComponent(String(who)), { method: 'DELETE' }));
}

/** Ask the owner for access. Here it is a real ask, and the OWNER is the one notified. */
export async function nodeRequest(call, appId, note) {
  const r = await un(call(base(appId) + '/requests', {
    method: 'POST', body: JSON.stringify(note ? { note } : {}),
  }));
  return { recorded: r && r.recorded !== false, passive: false, alreadyMember: !!(r && r.alreadyMember) };
}
