/**
 * @file organism/members.js
 * @description Who may open one workspace, for AIMEAT.organism: the members and their roles, the
 *   access requests waiting for a decision, a direct grant or revoke, the decision on a request, and
 *   an email invitation into the organism with workspace grants. Every method calls one existing node
 *   route under /v1/organisms/:id (workspace-access, workspace-access/grant, workspace-access/revoke,
 *   workspace-access/decision, invitations/email), so three apps that wrote this list by hand
 *   (cadence, lahetin, experience-center) can call it instead. The open email invitations are
 *   listed and cancelled here too. A refusal throws the node's own message through the `fail` the
 *   caller passes in.
 * @structure workspaceMembers(h) → { access, members, requests, grant, revoke, decide, inviteByEmail,
 *   invitations, cancelInvitation }; displayNames() resolves account names through the public
 *   profile route, cached per page; invitationRow() shapes one invitation.
 * @usage Object.assign(organism, workspaceMembers({ authFetch, fail, getSession }));
 *   const team = await AIMEAT.organism.members(orgId, wsId);
 *   const open = await AIMEAT.organism.invitations(orgId, { ws: [wsA, wsB] });
 * @version-history
 *   v1.1.0 — 2026-10-02 — invitations(orgId, { ws? }) and cancelInvitation(orgId, invId), over GET
 *     /invitations/email and POST /invitations/email/:invId/cancel (the Experience Center list).
 *   v1.0.0 — 2026-10-01 — Initial (IAM plan Phase D block 2).
 */

/**
 * @typedef {Object} OrgHttp
 * @property {(path: string, opts?: RequestInit) => Promise<any>} authFetch  The session fetch; answers the parsed envelope.
 * @property {(res: any, fallback: string) => Error} fail                  The node's refusal as an Error (message, code, details).
 * @property {() => any} getSession                                         The AIMEAT.auth session.
 */

/**
 * One person who holds a role in a workspace.
 * @typedef {Object} WorkspaceMember
 * @property {string} account        The account name (a GHII when the person is on another node).
 * @property {string} [displayName]  The name on their public profile, when they set one.
 * @property {string|null} role      'viewer' | 'contributor', 'creator' for the workspace's creator, null on a pending request.
 * @property {string} [since]        When the role was granted (ISO time), when the node knows it.
 * @property {string|null} [source]  How the role came: 'grant' | 'request' | 'invite'.
 * @property {string|null} [grantedBy] The account that granted it.
 * @property {boolean} [pending]     True on a request that waits for a decision (members({ pending: true })).
 */

/**
 * One access request to a workspace.
 * @typedef {Object} AccessRequest
 * @property {string} account        The account that asked.
 * @property {string} [displayName]
 * @property {string} message        What they wrote with the request.
 * @property {string} [at]           When they asked (ISO time).
 * @property {string} status         'pending' | 'approved' | 'denied' | 'revoked', as the node wrote it.
 * @property {string|null} role      The role they hold now, if any.
 */

/** Account name → display name ('' when the profile has none or cannot be read). One per page. */
var nameCache = new Map();
/** How many profile reads run at once. */
var NAME_READS_AT_ONCE = 6;

/** The node part of the session's GHII, for turning a bare account into a GHII. */
function nodeOf(session) {
  var g = String((session && (session.ghii || session.owner)) || '');
  var at = g.indexOf('@');
  return at >= 0 ? g.slice(at + 1) : '';
}

/**
 * Fill `displayName` on each row from the public profile route GET /v1/ghii/:ghii. A profile that
 * cannot be read leaves the field out: the account name is the fallback, and a missing display name
 * is not a refusal of the call that asked for the list.
 * @param {OrgHttp} h
 * @param {Array<{ account: string, displayName?: string }>} rows
 */
async function displayNames(h, rows) {
  var node = nodeOf(h.getSession());
  var todo = [];
  rows.forEach(function (r) { if (r.account && !nameCache.has(r.account) && todo.indexOf(r.account) < 0) todo.push(r.account); });
  var next = 0;
  async function worker() {
    while (next < todo.length) {
      var account = todo[next++];
      var ghii = account.indexOf('@') >= 0 || !node ? account : account + '@' + node;
      var name = '';
      try {
        var res = await h.authFetch('/v1/ghii/' + encodeURIComponent(ghii));
        if (res && res.ok !== false) name = String((res.data && res.data.display_name) || '');
      } catch { name = ''; }
      nameCache.set(account, name);
    }
  }
  var workers = [];
  for (var w = 0; w < Math.min(NAME_READS_AT_ONCE, todo.length); w++) workers.push(worker());
  await Promise.all(workers);
  rows.forEach(function (r) { var n = nameCache.get(r.account); if (n) r.displayName = n; });
  return rows;
}

/** The body of a JSON POST. */
function post(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** '/v1/organisms/<id>' with the id encoded. */
function orgPath(orgId) {
  return '/v1/organisms/' + encodeURIComponent(orgId);
}

/**
 * The workspace-access methods, bound to the caller's session helpers.
 * @param {OrgHttp} h
 */
export function workspaceMembers(h) {
  /** GET /v1/organisms/:id/workspace-access?ws= → the node's { ws, members, requests }. */
  async function readAccess(orgId, wsId) {
    var res = await h.authFetch(orgPath(orgId) + '/workspace-access?ws=' + encodeURIComponent(wsId));
    if (!res || res.ok === false) throw h.fail(res, 'Failed to read workspace access');
    return res.data !== undefined ? res.data : res;
  }

  /** The workspace's creator, from GET /v1/organisms/:id/workspaces (the route the list comes from). */
  async function creatorOf(orgId, wsId) {
    var res = await h.authFetch(orgPath(orgId) + '/workspaces');
    if (!res || res.ok === false) throw h.fail(res, 'Failed to list workspaces');
    var d = res.data !== undefined ? res.data : res;
    var row = ((d && d.workspaces) || []).filter(function (w) { return w && w.id === wsId; })[0];
    return row ? { account: row.created_by, since: row.created_at } : null;
  }

  /** @returns {WorkspaceMember} */
  function memberRow(m) {
    return { account: m.owner, role: m.role || null, since: m.granted_at || undefined, source: m.source || null, grantedBy: m.granted_by || null };
  }
  /** @returns {AccessRequest} */
  function requestRow(r) {
    return { account: r.requester, message: r.message || '', at: r.created_at || undefined, status: r.status || 'pending', role: r.role || null };
  }

  // Named, so members() and requests() reach access() without `this` (an app may destructure them).
  var api = {
    /**
     * Members and requests in one read. Only the workspace's creator or an organism owner or admin may
     * read them; anyone else gets the node's refusal (ACCESS_DENIED).
     * @param {string} orgId
     * @param {string} wsId
     * @param {{ names?: boolean, creator?: boolean, all?: boolean }} [opts]  names (default true) fills
     *   displayName; creator (default true) puts the creator first with role 'creator'; all (default
     *   false) keeps decided requests in `requests`.
     * @returns {Promise<{ members: WorkspaceMember[], requests: AccessRequest[] }>}
     */
    async access(orgId, wsId, opts) {
      opts = opts || {};
      var both = await Promise.all([
        readAccess(orgId, wsId),
        opts.creator === false ? Promise.resolve(null) : creatorOf(orgId, wsId),
      ]);
      var d = both[0], creator = both[1];
      var members = ((d && d.members) || []).map(memberRow);
      if (creator && creator.account && !members.some(function (m) { return m.account === creator.account; })) {
        members.unshift({ account: creator.account, role: 'creator', since: creator.since || undefined, source: null, grantedBy: null });
      }
      var requests = ((d && d.requests) || []).map(requestRow)
        .filter(function (r) { return opts.all || r.status === 'pending'; });
      if (opts.names !== false) await displayNames(h, /** @type {any[]} */ (members).concat(requests));
      return { members: members, requests: requests };
    },

    /**
     * Who holds a role in the workspace: GET /v1/organisms/:id/workspace-access?ws=, plus the creator
     * from GET /v1/organisms/:id/workspaces. `{ pending: true }` adds each waiting requester with
     * `pending: true` and role null, after the members.
     * @param {string} orgId
     * @param {string} wsId
     * @param {{ names?: boolean, creator?: boolean, pending?: boolean }} [opts]
     * @returns {Promise<WorkspaceMember[]>}
     */
    async members(orgId, wsId, opts) {
      opts = opts || {};
      var a = await api.access(orgId, wsId, { names: opts.names, creator: opts.creator });
      if (!opts.pending) return a.members;
      var waiting = a.requests.filter(function (r) { return !a.members.some(function (m) { return m.account === r.account; }); })
        .map(function (r) { return /** @type {WorkspaceMember} */ ({ account: r.account, displayName: r.displayName, role: null, since: r.at, pending: true }); });
      return a.members.concat(waiting);
    },

    /**
     * The access requests: GET /v1/organisms/:id/workspace-access?ws=. Pending ones only, unless
     * `{ all: true }`.
     * @param {string} orgId
     * @param {string} wsId
     * @param {{ names?: boolean, all?: boolean }} [opts]
     * @returns {Promise<AccessRequest[]>}
     */
    async requests(orgId, wsId, opts) {
      opts = opts || {};
      var a = await api.access(orgId, wsId, { names: opts.names, creator: false, all: opts.all });
      return a.requests;
    },

    /**
     * Give a person a role, or change the one they hold: POST /v1/organisms/:id/workspace-access/grant
     * { ws, grantee, role }. Needs the organism:invite scope on an app session, and the caller must be
     * the workspace's creator or an organism owner or admin.
     * @param {string} orgId
     * @param {string} wsId
     * @param {string} account  An account name, a GHII or a GAII; the grant goes to the person.
     * @param {'viewer'|'contributor'} role
     * @returns {Promise<{ ws: string, grantee: string, role: string }>}
     */
    async grant(orgId, wsId, account, role) {
      var res = await h.authFetch(orgPath(orgId) + '/workspace-access/grant', post({ ws: wsId, grantee: account, role: role }));
      if (!res || res.ok === false) throw h.fail(res, 'Failed to grant access');
      return res.data !== undefined ? res.data : res;
    },

    /**
     * Take every role a person holds in the workspace away: POST
     * /v1/organisms/:id/workspace-access/revoke { ws, grantee }. Same permission as grant().
     * @param {string} orgId
     * @param {string} wsId
     * @param {string} account
     * @returns {Promise<{ ws: string, grantee: string, revoked: number }>}
     */
    async revoke(orgId, wsId, account) {
      var res = await h.authFetch(orgPath(orgId) + '/workspace-access/revoke', post({ ws: wsId, grantee: account }));
      if (!res || res.ok === false) throw h.fail(res, 'Failed to revoke access');
      return res.data !== undefined ? res.data : res;
    },

    /**
     * Approve or decline an access request: POST /v1/organisms/:id/workspace-access/decision
     * { ws, requester, decision: 'approve' | 'deny', role }. 'decline' is sent as the node's 'deny'.
     * An approval grants `role`; the node grants 'contributor' when no role or another word is sent.
     * @param {string} orgId
     * @param {string} wsId
     * @param {string} account
     * @param {'approve'|'decline'|'deny'} decision
     * @param {'viewer'|'contributor'} [role]
     * @returns {Promise<any>}  The node's answer: the decision, ws and requester.
     */
    async decide(orgId, wsId, account, decision, role) {
      /** @type {Record<string, any>} */
      var body = { ws: wsId, requester: account, decision: decision === 'decline' ? 'deny' : decision };
      if (role) body.role = role;
      var res = await h.authFetch(orgPath(orgId) + '/workspace-access/decision', post(body));
      if (!res || res.ok === false) throw h.fail(res, 'Failed to decide the request');
      return res.data !== undefined ? res.data : res;
    },

    /**
     * Invite an email address into the organism, with roles in chosen workspaces that apply when the
     * invitation is accepted: POST /v1/organisms/:id/invitations/email. Organism owner or admin only,
     * and the organism:invite scope on an app session. `accept_url` comes back so the link can be
     * shared by hand when the node sends no email (`email_sent: false`).
     * @param {string} orgId
     * @param {string} email
     * @param {{ workspaces?: Array<{ ws: string, role?: 'viewer'|'contributor' }>, ws?: string,
     *   role?: 'viewer'|'contributor', orgRole?: 'member'|'admin', message?: string,
     *   expiresInDays?: number, returnUrl?: string, locale?: 'en'|'fi'|'es' }} [opts]  `ws` + `role`
     *   is the short form for one workspace.
     * @returns {Promise<{ invitation: any, email_sent: boolean, email_locale?: string, accept_url: string }>}
     */
    async inviteByEmail(orgId, email, opts) {
      opts = opts || {};
      var workspaces = Array.isArray(opts.workspaces) ? opts.workspaces.slice() : [];
      if (opts.ws && !workspaces.some(function (w) { return w && w.ws === opts.ws; })) workspaces.push({ ws: opts.ws, role: opts.role || 'viewer' });
      /** @type {Record<string, any>} */
      var body = { email: email, workspaces: workspaces };
      if (opts.orgRole) body.orgRole = opts.orgRole;
      if (opts.message) body.message = opts.message;
      if (opts.expiresInDays) body.expiresInDays = opts.expiresInDays;
      if (opts.returnUrl) body.return_url = opts.returnUrl;
      if (opts.locale) body.locale = opts.locale;
      var res = await h.authFetch(orgPath(orgId) + '/invitations/email', post(body));
      if (!res || res.ok === false) throw h.fail(res, 'Failed to send the invitation');
      return res.data !== undefined ? res.data : res;
    },

    /**
     * The organism's open email invitations: GET /v1/organisms/:id/invitations/email. Organism owner
     * or admin only, and the organism:invite scope on an app session; anyone else gets the node's
     * refusal (ACCESS_DENIED). The route also lists the provisioned-code invitations, which are left
     * out here: a code invitation carries an account and is cancelled through its own route.
     * `ws` (one workspace id or a list) keeps the invitations that name at least one of them.
     * @param {string} orgId
     * @param {{ ws?: string|string[] }} [opts]
     * @returns {Promise<EmailInvitation[]>}
     */
    async invitations(orgId, opts) {
      opts = opts || {};
      var res = await h.authFetch(orgPath(orgId) + '/invitations/email');
      if (!res || res.ok === false) throw h.fail(res, 'Failed to list the invitations');
      var d = res.data !== undefined ? res.data : res;
      var only = opts.ws == null ? null : (Array.isArray(opts.ws) ? opts.ws : [opts.ws]).filter(Boolean);
      return ((d && d.invitations) || []).filter(function (i) {
        return i && i.id && (!i.type || i.type === 'link') && (!i.status || i.status === 'pending');
      }).map(invitationRow).filter(function (i) {
        return !only || i.workspaces.some(function (w) { return only.indexOf(w.ws) >= 0; });
      });
    },

    /**
     * Cancel an open email invitation, so its link no longer works: POST
     * /v1/organisms/:id/invitations/email/:invId/cancel. Organism owner or admin only. An invitation
     * already accepted or cancelled is refused by the node (INVALID_STATE).
     * @param {string} orgId
     * @param {string} invId
     * @returns {Promise<{ status: 'cancelled' }>}
     */
    async cancelInvitation(orgId, invId) {
      var res = await h.authFetch(orgPath(orgId) + '/invitations/email/' + encodeURIComponent(invId) + '/cancel', post({}));
      if (!res || res.ok === false) throw h.fail(res, 'Failed to cancel the invitation');
      return res.data !== undefined ? res.data : res;
    },
  };
  return api;
}

/**
 * One open email invitation into an organism.
 * @typedef {Object} EmailInvitation
 * @property {string} id
 * @property {string} email
 * @property {'member'|'admin'} orgRole       The role in the organism the invitation gives.
 * @property {Array<{ ws: string, role: 'viewer'|'contributor' }>} workspaces  The workspace roles it gives.
 * @property {string} status                    'pending' for an open invitation.
 * @property {string|null} invitedBy
 * @property {string|null} message
 * @property {string} [createdAt]               ISO time.
 * @property {string} [expiresAt]               ISO time; the link stops working then.
 */

/**
 * The node's invitation as the library answers it.
 * @param {any} i
 * @returns {EmailInvitation}
 */
function invitationRow(i) {
  return {
    id: i.id, email: i.email || '', orgRole: i.org_role === 'admin' ? 'admin' : 'member',
    workspaces: (Array.isArray(i.workspaces) ? i.workspaces : []).filter(function (w) { return w && w.ws; })
      .map(function (w) { return { ws: w.ws, role: w.role === 'contributor' ? 'contributor' : 'viewer' }; }),
    status: i.status || 'pending', invitedBy: i.invited_by || null, message: i.message || null,
    createdAt: i.created_at || undefined, expiresAt: i.expires_at || undefined,
  };
}
