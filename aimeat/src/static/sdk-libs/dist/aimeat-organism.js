// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/organism/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-organism.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/organism/members.js
  var nameCache = /* @__PURE__ */ new Map();
  var NAME_READS_AT_ONCE = 6;
  function nodeOf(session) {
    var g = String(session && (session.ghii || session.owner) || "");
    var at = g.indexOf("@");
    return at >= 0 ? g.slice(at + 1) : "";
  }
  async function displayNames(h, rows) {
    var node = nodeOf(h.getSession());
    var todo = [];
    rows.forEach(function(r) {
      if (r.account && !nameCache.has(r.account) && todo.indexOf(r.account) < 0) todo.push(r.account);
    });
    var next = 0;
    async function worker() {
      while (next < todo.length) {
        var account = todo[next++];
        var ghii = account.indexOf("@") >= 0 || !node ? account : account + "@" + node;
        var name = "";
        try {
          var res = await h.authFetch("/v1/ghii/" + encodeURIComponent(ghii));
          if (res && res.ok !== false) name = String(res.data && res.data.display_name || "");
        } catch {
          name = "";
        }
        nameCache.set(account, name);
      }
    }
    var workers = [];
    for (var w = 0; w < Math.min(NAME_READS_AT_ONCE, todo.length); w++) workers.push(worker());
    await Promise.all(workers);
    rows.forEach(function(r) {
      var n = nameCache.get(r.account);
      if (n) r.displayName = n;
    });
    return rows;
  }
  function post(body) {
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }
  function orgPath(orgId) {
    return "/v1/organisms/" + encodeURIComponent(orgId);
  }
  function workspaceMembers(h) {
    async function readAccess(orgId, wsId) {
      var res = await h.authFetch(orgPath(orgId) + "/workspace-access?ws=" + encodeURIComponent(wsId));
      if (!res || res.ok === false) throw h.fail(res, "Failed to read workspace access");
      return res.data !== void 0 ? res.data : res;
    }
    async function creatorOf(orgId, wsId) {
      var res = await h.authFetch(orgPath(orgId) + "/workspaces");
      if (!res || res.ok === false) throw h.fail(res, "Failed to list workspaces");
      var d = res.data !== void 0 ? res.data : res;
      var row = (d && d.workspaces || []).filter(function(w) {
        return w && w.id === wsId;
      })[0];
      return row ? { account: row.created_by, since: row.created_at } : null;
    }
    function memberRow(m) {
      return { account: m.owner, role: m.role || null, since: m.granted_at || void 0, source: m.source || null, grantedBy: m.granted_by || null };
    }
    function requestRow(r) {
      return { account: r.requester, message: r.message || "", at: r.created_at || void 0, status: r.status || "pending", role: r.role || null };
    }
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
          opts.creator === false ? Promise.resolve(null) : creatorOf(orgId, wsId)
        ]);
        var d = both[0], creator = both[1];
        var members = (d && d.members || []).map(memberRow);
        if (creator && creator.account && !members.some(function(m) {
          return m.account === creator.account;
        })) {
          members.unshift({ account: creator.account, role: "creator", since: creator.since || void 0, source: null, grantedBy: null });
        }
        var requests = (d && d.requests || []).map(requestRow).filter(function(r) {
          return opts.all || r.status === "pending";
        });
        if (opts.names !== false) await displayNames(
          h,
          /** @type {any[]} */
          members.concat(requests)
        );
        return { members, requests };
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
        var waiting = a.requests.filter(function(r) {
          return !a.members.some(function(m) {
            return m.account === r.account;
          });
        }).map(function(r) {
          return (
            /** @type {WorkspaceMember} */
            { account: r.account, displayName: r.displayName, role: null, since: r.at, pending: true }
          );
        });
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
        var res = await h.authFetch(orgPath(orgId) + "/workspace-access/grant", post({ ws: wsId, grantee: account, role }));
        if (!res || res.ok === false) throw h.fail(res, "Failed to grant access");
        return res.data !== void 0 ? res.data : res;
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
        var res = await h.authFetch(orgPath(orgId) + "/workspace-access/revoke", post({ ws: wsId, grantee: account }));
        if (!res || res.ok === false) throw h.fail(res, "Failed to revoke access");
        return res.data !== void 0 ? res.data : res;
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
        var body = { ws: wsId, requester: account, decision: decision === "decline" ? "deny" : decision };
        if (role) body.role = role;
        var res = await h.authFetch(orgPath(orgId) + "/workspace-access/decision", post(body));
        if (!res || res.ok === false) throw h.fail(res, "Failed to decide the request");
        return res.data !== void 0 ? res.data : res;
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
        if (opts.ws && !workspaces.some(function(w) {
          return w && w.ws === opts.ws;
        })) workspaces.push({ ws: opts.ws, role: opts.role || "viewer" });
        var body = { email, workspaces };
        if (opts.orgRole) body.orgRole = opts.orgRole;
        if (opts.message) body.message = opts.message;
        if (opts.expiresInDays) body.expiresInDays = opts.expiresInDays;
        if (opts.returnUrl) body.return_url = opts.returnUrl;
        if (opts.locale) body.locale = opts.locale;
        var res = await h.authFetch(orgPath(orgId) + "/invitations/email", post(body));
        if (!res || res.ok === false) throw h.fail(res, "Failed to send the invitation");
        return res.data !== void 0 ? res.data : res;
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
        var res = await h.authFetch(orgPath(orgId) + "/invitations/email");
        if (!res || res.ok === false) throw h.fail(res, "Failed to list the invitations");
        var d = res.data !== void 0 ? res.data : res;
        var only = opts.ws == null ? null : (Array.isArray(opts.ws) ? opts.ws : [opts.ws]).filter(Boolean);
        return (d && d.invitations || []).filter(function(i) {
          return i && i.id && (!i.type || i.type === "link") && (!i.status || i.status === "pending");
        }).map(invitationRow).filter(function(i) {
          return !only || i.workspaces.some(function(w) {
            return only.indexOf(w.ws) >= 0;
          });
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
        var res = await h.authFetch(orgPath(orgId) + "/invitations/email/" + encodeURIComponent(invId) + "/cancel", post({}));
        if (!res || res.ok === false) throw h.fail(res, "Failed to cancel the invitation");
        return res.data !== void 0 ? res.data : res;
      }
    };
    return api;
  }
  function invitationRow(i) {
    return {
      id: i.id,
      email: i.email || "",
      orgRole: i.org_role === "admin" ? "admin" : "member",
      workspaces: (Array.isArray(i.workspaces) ? i.workspaces : []).filter(function(w) {
        return w && w.ws;
      }).map(function(w) {
        return { ws: w.ws, role: w.role === "contributor" ? "contributor" : "viewer" };
      }),
      status: i.status || "pending",
      invitedBy: i.invited_by || null,
      message: i.message || null,
      createdAt: i.created_at || void 0,
      expiresAt: i.expires_at || void 0
    };
  }

  // src/static/sdk-libs/organism/first-run.js
  function orgPath2(orgId) {
    return "/v1/organisms/" + encodeURIComponent(orgId);
  }
  function dataOf(res) {
    return res && res.data !== void 0 ? res.data : res;
  }
  function dataLib() {
    var d = window.AIMEAT && window.AIMEAT.data;
    return d && typeof d.get === "function" && typeof d.set === "function" ? d : null;
  }
  function choiceKey(appKey) {
    var k = typeof appKey === "string" ? appKey.trim() : "";
    if (!k || /\s/.test(k)) throw new Error('appKey must be a non-empty key prefix without spaces, e.g. "cadence"');
    return k + ".workspace";
  }
  function asChoice(v) {
    return v && typeof v === "object" && typeof v.orgId === "string" && v.orgId && typeof v.wsId === "string" && v.wsId ? { orgId: v.orgId, wsId: v.wsId } : null;
  }
  function isPrivate(v) {
    return !!v && typeof v === "object" && v.private === true && !asChoice(v);
  }
  function listOf(v) {
    var raw = v && typeof v === "object" && Array.isArray(v.list) ? v.list : [v];
    var out = [];
    raw.forEach(function(x) {
      var c = asChoice(x);
      if (c && !out.some(function(o) {
        return o.orgId === c.orgId && o.wsId === c.wsId;
      })) out.push(c);
    });
    return out;
  }
  function firstRun(h, organism2) {
    function myAccounts() {
      var s = h.getSession();
      var owner = String(s.owner || s.user && s.user.owner || "");
      var ghii = String(s.ghii || "");
      var out = [owner];
      var at = owner.indexOf("@");
      if (at >= 0 && ghii && ghii.slice(ghii.indexOf("@")) === owner.slice(at)) out.push(owner.slice(0, at));
      if (at < 0 && ghii) out.push(ghii);
      return out.filter(Boolean);
    }
    async function store(appKey, value) {
      var key = choiceKey(appKey);
      var lib = dataLib();
      if (lib) {
        await lib.set(key, value, { visibility: "owner" });
        return;
      }
      var res = await h.authFetch("/v1/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value, visibility: "owner" })
      });
      if (!res || res.ok === false) throw h.fail(res, "Failed to save the workspace choice");
    }
    async function stored(appKey) {
      var key = choiceKey(appKey);
      var lib = dataLib();
      if (lib) return lib.get(key);
      var res = await h.authFetch("/v1/memory/" + encodeURIComponent(key) + "?soft=1");
      if (!res || res.ok === false) throw h.fail(res, "Failed to read the workspace choice");
      var d = dataOf(res);
      return d ? d.value : null;
    }
    async function readableIn(orgId) {
      var listed = await h.authFetch(orgPath2(orgId) + "/workspaces");
      if (!listed || listed.ok === false) {
        var code = listed && listed.error && listed.error.code;
        if (code === "ACCESS_DENIED" || code === "NOT_FOUND") return null;
        throw h.fail(listed, "Failed to list workspaces");
      }
      var lw = dataOf(listed);
      var ids = /* @__PURE__ */ new Set();
      (lw && lw.workspaces || []).forEach(function(w) {
        if (w && w.id && !w.archived && w.access !== "none") ids.add(w.id);
      });
      return ids;
    }
    async function listWorkspaces(orgId) {
      var res = await h.authFetch(orgPath2(orgId) + "/workspaces");
      if (!res || res.ok === false) throw h.fail(res, "Failed to list workspaces");
      var d = dataOf(res);
      return d && d.workspaces || [];
    }
    async function manifestKind(orgId, wsId) {
      var res = await h.authFetch(orgPath2(orgId) + "/workspace?ws=" + encodeURIComponent(wsId));
      if (!res || res.ok === false) return null;
      var d = dataOf(res);
      return d && d.manifest && d.manifest.kind || null;
    }
    async function resolveOrg(org) {
      if (typeof org === "string" && org) return { id: org, created: false };
      if (org && typeof org === "object" && typeof org.id === "string" && org.id) return { id: org.id, created: false };
      if (org && typeof org === "object" && typeof org.name === "string" && org.name.trim()) {
        var made = await organism2.create(org.name.trim(), { type: org.type, visibility: org.visibility, join_policy: org.join_policy, description: org.description });
        if (!made || !made.id) throw new Error("The node created no organism id");
        return { id: made.id, created: true };
      }
      throw new Error("org must be an organism id, or { name } to create a new organism");
    }
    var api = {
      /**
       * The organisms the caller belongs to, with the role they hold: GET
       * /v1/organisms?member=<account>&per_page=100. Archived organisms are left out unless
       * `{ archived: true }`. Unlike list(), a refusal throws instead of falling back to the public list.
       * @param {{ archived?: boolean }} [opts]
       * @returns {Promise<MyOrganism[]>}
       */
      async organisms(opts) {
        opts = opts || {};
        var mine = myAccounts();
        var res = await h.authFetch("/v1/organisms?member=" + encodeURIComponent(mine[0] || "") + "&per_page=100");
        if (!res || res.ok === false) throw h.fail(res, "Failed to list organisms");
        var d = dataOf(res);
        var list = d && (d.organisms || d.items) || (Array.isArray(d) ? d : []);
        function holds(arr) {
          return Array.isArray(arr) && arr.some(function(a) {
            return mine.indexOf(a) >= 0;
          });
        }
        return list.filter(function(o) {
          return o && o.id && (opts.archived || !o.archived);
        }).map(function(o) {
          var role = holds(o.owners) || mine.indexOf(o.creatorGhii) >= 0 ? "owner" : holds(o.admins) ? "admin" : "member";
          return { id: o.id, name: o.name || o.id, role, type: o.type, description: o.description, archived: !!o.archived, raw: o };
        });
      },
      /**
       * Find the app's workspace in an organism, or create it.
       *
       * Found means: not archived, readable by the caller, and named `name` (case and outer spaces
       * ignored). With `kind`, the workspace's manifest must also carry that kind, which is the app's
       * marker: a workspace of the same name made by another app is passed over and a new one created.
       * `anyName: true` with `kind` also checks the other readable workspaces, so a renamed one is found;
       * each check is one workspace read. `create: false` answers null instead of creating.
       *
       * Creating calls createWorkspace() with `manifest`, or with { name, kind, summary: purpose,
       * objectTypes } built from the options; the node refuses a manifest without objectTypes, and that
       * refusal is thrown as it is. `org` may be `{ name, type?, visibility?, description? }` to create
       * a new organism first (needs organism:write).
       * @param {{ org: string | { id?: string, name?: string, type?: string, visibility?: string,
       *   join_policy?: string, description?: string }, name: string, kind?: string, purpose?: string,
       *   objectTypes?: any[], manifest?: any, schemas?: Record<string, any>, readme?: string,
       *   anyName?: boolean, create?: boolean }} opts
       * @returns {Promise<(WorkspaceChoice & { name: string, created: boolean, orgCreated: boolean }) | null>}
       */
      async findOrCreateWorkspace(opts) {
        opts = opts || /** @type {any} */
        {};
        var name = String(opts.name || "").trim();
        if (!name) throw new Error("findOrCreateWorkspace needs a workspace name");
        var org = await resolveOrg(opts.org);
        var kind = typeof opts.kind === "string" && opts.kind ? opts.kind : null;
        if (!org.created) {
          var rows = (await listWorkspaces(org.id)).filter(function(w) {
            return w && w.id && !w.archived && w.access !== "none";
          });
          var lower = name.toLowerCase();
          var named = rows.filter(function(w) {
            return String(w.name || "").trim().toLowerCase() === lower;
          });
          var candidates = kind && opts.anyName ? named.concat(rows.filter(function(w) {
            return named.indexOf(w) < 0;
          })) : named;
          for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (kind && await manifestKind(org.id, c.id) !== kind) continue;
            return { orgId: org.id, wsId: c.id, name: c.name || name, created: false, orgCreated: false };
          }
        }
        if (opts.create === false) return null;
        var manifest = opts.manifest && typeof opts.manifest === "object" ? Object.assign({}, opts.manifest) : { name, objectTypes: opts.objectTypes };
        if (kind && !manifest.kind) manifest.kind = kind;
        if (opts.purpose && !manifest.summary) manifest.summary = String(opts.purpose);
        var readme = opts.readme || (opts.purpose ? "# " + name + "\n\n" + String(opts.purpose) : void 0);
        var made = await organism2.createWorkspace(org.id, name, manifest, opts.schemas, readme);
        if (!made || !made.ws) throw new Error("The node created no workspace id");
        return { orgId: org.id, wsId: made.ws, name, created: true, orgCreated: org.created };
      },
      /**
       * Keep the app's workspace choice in the owner's memory under `<appKey>.workspace`, as
       * { orgId, wsId } with visibility 'owner' (the owner and their own agents read it). `{ private:
       * true }` keeps the choice of no shared workspace instead. Writes through AIMEAT.data.set when
       * aimeat-data is loaded, else POST /v1/memory.
       * @param {string} appKey  The app's key prefix, e.g. 'cadence'.
       * @param {WorkspaceChoice | { private: true }} choice
       * @returns {Promise<WorkspaceChoice | { private: true }>}
       */
      async remember(appKey, choice) {
        choiceKey(appKey);
        var value = asChoice(choice) || (isPrivate(choice) ? { private: true } : null);
        if (!value) throw new Error("remember needs { orgId, wsId } or { private: true }");
        await store(appKey, value);
        return value;
      },
      /**
       * The choice remember() kept, or null. Reads through AIMEAT.data.get when aimeat-data is loaded,
       * else GET /v1/memory/<key>?soft=1. With `{ verify: true }` it also lists the organism's
       * workspaces and answers null when the workspace is gone, archived or no longer readable, or the
       * node answers ACCESS_DENIED or NOT_FOUND for the organism; any other refusal is thrown.
       * A kept private choice answers null, or `{ private: true }` when `{ private: true }` is passed.
       * A list kept by rememberList() answers its current workspace.
       * @param {string} appKey
       * @param {{ verify?: boolean, private?: boolean }} [opts]
       * @returns {Promise<WorkspaceChoice | { private: true } | null>}
       */
      async recall(appKey, opts) {
        opts = opts || {};
        var value = await stored(appKey);
        if (isPrivate(value)) return opts.private ? { private: true } : null;
        var choice = asChoice(value);
        if (!choice || !opts.verify) return choice;
        var ids = await readableIn(choice.orgId);
        return ids && ids.has(choice.wsId) ? choice : null;
      },
      /**
       * Keep several workspaces for an app that switches between them, under the same
       * `<appKey>.workspace` key: { orgId, wsId, list } with the current one in orgId and wsId, so
       * recall() and the blocks that follow the app's choice read the current one. `current` may be
       * `{ private: true }` (no shared workspace in use) or null (none in use).
       * @param {string} appKey
       * @param {WorkspaceChoice[]} list
       * @param {WorkspaceChoice | { private: true } | null} [current]  Default: the first of the list.
       * @returns {Promise<WorkspaceList>}
       */
      async rememberList(appKey, list, current) {
        choiceKey(appKey);
        var all = listOf({ list: Array.isArray(list) ? list : [] });
        var now = current === void 0 ? all[0] || null : asChoice(current) || (isPrivate(current) ? { private: true } : null);
        var cur = asChoice(now);
        if (cur && !all.some(function(c) {
          return c.orgId === cur.orgId && c.wsId === cur.wsId;
        })) all.unshift(cur);
        var value = cur ? { orgId: cur.orgId, wsId: cur.wsId } : now ? { private: true } : {};
        value.list = all;
        await store(appKey, value);
        return { list: all, current: cur, private: !cur && !!now };
      },
      /**
       * The list rememberList() kept, or null when the app kept nothing. A single choice kept by
       * remember() reads as a list of one. With `{ verify: true }` each organism's workspaces are listed
       * once, and a workspace that is gone, archived or no longer readable leaves the list (and stops
       * being current); ACCESS_DENIED or NOT_FOUND for an organism drops its workspaces, any other
       * refusal is thrown.
       * @param {string} appKey
       * @param {{ verify?: boolean }} [opts]
       * @returns {Promise<WorkspaceList | null>}
       */
      async recallList(appKey, opts) {
        opts = opts || {};
        var value = await stored(appKey);
        if (!value || typeof value !== "object") return null;
        var list = listOf(value);
        var cur = asChoice(value);
        var priv = isPrivate(value);
        if (!list.length && !cur && !priv) return null;
        if (opts.verify && list.length) {
          var orgs = [];
          list.forEach(function(c) {
            if (orgs.indexOf(c.orgId) < 0) orgs.push(c.orgId);
          });
          var seen = await Promise.all(orgs.map(readableIn));
          list = list.filter(function(c) {
            var ids = seen[orgs.indexOf(c.orgId)];
            return !!ids && ids.has(c.wsId);
          });
          if (cur && !list.some(function(c) {
            return c.orgId === cur.orgId && c.wsId === cur.wsId;
          })) cur = null;
        }
        return { list, current: cur, private: priv };
      }
    };
    return api;
  }

  // src/static/sdk-libs/organism/index.js
  function getSession() {
    if (!window.AIMEAT || !window.AIMEAT.auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before aimeat-organism.js");
    }
    var s = window.AIMEAT.auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  async function authFetch(path, opts) {
    var res = await getSession().fetch(path, opts);
    if (res && typeof res.json === "function") res = await res.json();
    return res;
  }
  function fail(res, fallback) {
    var e = (
      /** @type {Error & { code?: string, details?: unknown, envelope?: unknown }} */
      new Error(res && res.error && (res.error.message || res.error.code) || fallback)
    );
    e.code = res && res.error && res.error.code;
    e.details = res && res.error && res.error.details;
    e.envelope = res;
    return e;
  }
  function withWarnings(res) {
    var d = res && res.data !== void 0 ? res.data : res;
    if (d && Array.isArray(d.warnings)) {
      d.warnings.forEach(function(w) {
        console.warn("[AIMEAT.organism]", w && w.code, w && w.message);
      });
    }
    return d;
  }
  var TITLE_FIELDS = ["title", "name", "subject", "label"];
  var BODY_FIELDS = ["content", "body", "markdown", "text", "md", "description", "summary"];
  function pickField(obj, names) {
    if (!obj || typeof obj !== "object") return null;
    for (var i = 0; i < names.length; i++) if (typeof obj[names[i]] === "string") return names[i];
    return null;
  }
  function isMetaField(k) {
    return typeof k === "string" && k.charAt(0) === "_";
  }
  function stripMeta(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    var out = {};
    Object.keys(v).forEach(function(k) {
      if (!isMetaField(k)) out[k] = v[k];
    });
    return out;
  }
  function slugify(s) {
    return String(s || "untitled").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "untitled";
  }
  function titleOf(value, fallbackId) {
    var v = value || {};
    var f = pickField(v, TITLE_FIELDS);
    if (f && v[f]) return v[f];
    if (typeof v.id === "string" && v.id) return v.id;
    var bf = pickField(v, BODY_FIELDS);
    if (bf && typeof v[bf] === "string" && v[bf]) return String(v[bf]).replace(/\s+/g, " ").slice(0, 48);
    return fallbackId || "Untitled";
  }
  function bodyFieldOf(value) {
    return pickField(value, BODY_FIELDS);
  }
  function isDocLike(value) {
    var bf = bodyFieldOf(value);
    if (!bf || !value || typeof value[bf] !== "string") return false;
    return bf === "markdown" || bf === "content" || value[bf].length > 120 || /\n/.test(value[bf]);
  }
  function valueUpdatedAt(v) {
    if (v && typeof v === "object" && (v._updatedAt || v._createdAt)) {
      var t = new Date(v._updatedAt || v._createdAt).getTime();
      return isNaN(t) ? 0 : t;
    }
    return 0;
  }
  function wsRoot(orgId, wsId) {
    return "organism." + orgId + (wsId ? ".w." + wsId : "");
  }
  function draftKey(orgId, wsId, namespace2, id) {
    return wsRoot(orgId, wsId) + "." + namespace2 + "." + id + ".draft";
  }
  function normalizeWorkspace(data) {
    var manifest = data && data.manifest || null;
    var otList = manifest && (manifest.objectTypes || manifest.object_types || manifest.types) || [];
    if (!Array.isArray(otList) && otList && typeof otList === "object") {
      otList = Object.keys(otList).map(function(k) {
        var o = otList[k];
        o = o && typeof o === "object" ? o : {};
        if (!o.name) o.name = k;
        return o;
      });
    }
    var byName = {};
    otList.forEach(function(ot) {
      var n = ot.name || ot.id || ot.type;
      if (n) byName[n] = ot;
    });
    var objects = data && data.objects || {};
    var draftsMap = data && data.drafts || {};
    var typeNames = [];
    otList.forEach(function(ot) {
      var n = ot.name || ot.id || ot.type;
      if (n && typeNames.indexOf(n) < 0) typeNames.push(n);
    });
    Object.keys(objects).forEach(function(n) {
      if (typeNames.indexOf(n) < 0) typeNames.push(n);
    });
    Object.keys(draftsMap).forEach(function(n) {
      if (typeNames.indexOf(n) < 0) typeNames.push(n);
    });
    return typeNames.map(function(typeName) {
      var ot = byName[typeName] || {};
      var instances = {};
      var order = [];
      var seq = 0;
      function instIdOf(v) {
        if (v && typeof v === "object" && typeof v.id === "string" && v.id) return { id: v.id, real: true };
        if (v && typeof v === "object") {
          var tf = pickField(v, TITLE_FIELDS);
          if (tf && v[tf]) return { id: "t-" + slugify(v[tf]), real: false };
        }
        return { id: "item-" + seq++, real: false };
      }
      function add(v, slot) {
        if (v == null) return;
        var m = instIdOf(v);
        if (!instances[m.id]) {
          instances[m.id] = { id: m.id, hasRealId: m.real, draft: null, latest: null };
          order.push(m.id);
        }
        if (slot === "draft") instances[m.id].draft = v;
        else instances[m.id].latest = instances[m.id].latest || v;
      }
      var pub = objects[typeName] || [];
      if (!Array.isArray(pub)) pub = [pub];
      pub.forEach(function(v) {
        add(v, "latest");
      });
      var dr = draftsMap[typeName] || [];
      if (!Array.isArray(dr)) dr = [dr];
      dr.forEach(function(v) {
        add(v, "draft");
      });
      var items = order.map(function(id) {
        var inst = instances[id];
        var best = inst.draft || inst.latest;
        inst.value = best;
        inst.title = titleOf(best, id);
        inst.updatedAt = Math.max(valueUpdatedAt(inst.draft), valueUpdatedAt(inst.latest));
        inst.status = inst.draft && inst.latest ? "draft+published" : inst.draft ? "draft" : "published";
        return inst;
      });
      return {
        name: typeName,
        namespace: ot.namespace || ot.ns || typeName,
        kind: ot.kind || ot.type || null,
        schemaRef: ot.schemaRef || null,
        writeRole: ot.writeRole || null,
        items
      };
    });
  }
  function readmeText(readme) {
    if (readme == null) return "";
    if (typeof readme === "string") return readme;
    if (typeof readme === "object") return readme.content || readme.text || readme.markdown || JSON.stringify(readme, null, 2);
    return String(readme);
  }
  var organism = {
    // List organisms the signed-in owner is a member of.
    async list() {
      var s = getSession();
      var owner = s.owner || s.user && s.user.owner || "";
      var res;
      try {
        res = await authFetch("/v1/organisms?member=" + encodeURIComponent(owner) + "&per_page=100");
      } catch {
        res = null;
      }
      if (!res || res.ok === false) res = await authFetch("/v1/organisms");
      if (res.ok === false) throw fail(res, "Failed to list organisms");
      var d = res.data !== void 0 ? res.data : res;
      return d && (d.organisms || d.items) || (Array.isArray(d) ? d : []);
    },
    async get(orgId) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId));
      if (res.ok === false) throw fail(res, "Failed to load organism");
      return res.data !== void 0 ? res.data : res;
    },
    // Create a NEW organism (the signed-in owner becomes creator/member). Needs the organism:write app
    // scope (declare it in <meta name="aimeat-scopes">). Returns { id, name, ... }. Use this + createWorkspace
    // to let a multi-tenant app provision its own data space for each user on first use.
    async create(name, opts) {
      opts = opts || {};
      var res = await authFetch("/v1/organisms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: opts.type || "project",
          visibility: opts.visibility || "private",
          join_policy: opts.join_policy || "invite_only",
          description: opts.description
        })
      });
      if (res.ok === false) throw fail(res, "Failed to create organism");
      var d = res.data !== void 0 ? res.data : res;
      return d && d.organism ? d.organism : d;
    },
    // Create a NEW schema-locked workspace inside an organism from a manifest + per-namespace JSON schemas.
    // manifest = { manifestVersion:'1', name, kind, objectTypes:[{ name, namespace, mode:'records',
    // backing:'memory', writeRole:'member', schemaRef? }] }; schemas = { '<namespace>': <JSON Schema> }.
    // Needs organism:write. Returns { ws, types, schemas_locked }.
    async createWorkspace(orgId, name, manifest, schemas, readme) {
      var m = manifest && typeof manifest === "object" ? JSON.parse(JSON.stringify(manifest)) : manifest;
      var sc = schemas && typeof schemas === "object" ? Object.assign({}, schemas) : {};
      if (m && Array.isArray(m.objectTypes)) {
        for (var oi = 0; oi < m.objectTypes.length; oi++) {
          var ot = m.objectTypes[oi];
          if (ot && !ot.schemaRef) {
            var slug = String(ot.name || "type" + oi).replace(/[^a-zA-Z0-9_-]/g, "-");
            ot.schemaRef = "schema:" + name + "-" + slug + "@1";
          }
          if (ot && ot.namespace && sc[ot.namespace] === void 0 && (ot.backing || "memory") === "memory" && (ot.mode || "records") === "records") {
            sc[ot.namespace] = { type: "object", patternProperties: { "^.*$": {} } };
          }
        }
      }
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, manifest: m, schemas: sc, readme })
      });
      if (res.ok === false) throw fail(res, "Failed to create workspace");
      return res.data !== void 0 ? res.data : res;
    },
    // List workspaces (access + enrichment counts included).
    async workspaces(orgId) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspaces?include=enrichment");
      if (res.ok === false) throw fail(res, "Failed to list workspaces");
      var d = res.data !== void 0 ? res.data : res;
      return d && (d.workspaces || d.items) || (Array.isArray(d) ? d : []);
    },
    // Read one workspace, normalized: { manifest, readme, readmeText, spaces, raw }.
    // spaces[].items[]: { id, hasRealId, draft, latest, value, title, updatedAt, status }.
    async read(orgId, wsId) {
      var q = wsId ? "?ws=" + encodeURIComponent(wsId) : "";
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspace" + q);
      if (res.ok === false) throw fail(res, "Failed to read workspace");
      var d = res.data !== void 0 ? res.data : res;
      return {
        manifest: d && d.manifest || null,
        readme: d && d.readme || null,
        readmeText: readmeText(d && d.readme),
        spaces: normalizeWorkspace(d),
        raw: d
      };
    },
    // Write/overwrite an object's draft. Embeds the instance id into the value (SPA convention)
    // unless opts.embedId === false (needed for locked schemas that reject an id property).
    // Throws UNDECLARED_SPACE when the workspace manifest does not declare `namespace` (nothing is
    // written): declare the space in the workspace first, then write.
    async writeDraft(orgId, wsId, namespace2, id, value, opts) {
      opts = opts || {};
      var v = stripMeta(value);
      if (opts.embedId !== false && v && typeof v === "object" && !Array.isArray(v)) {
        v = Object.assign({}, v, { id });
      }
      var body = (
        /** @type {Record<string, any>} */
        { key: draftKey(orgId, wsId, namespace2, id), value: v, visibility: opts.visibility || "private" }
      );
      if (opts.group_id) body.group_id = opts.group_id;
      if (Array.isArray(opts.tags) && opts.tags.length) body.tags = opts.tags;
      var res = await authFetch("/v1/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok === false) throw fail(res, "Failed to save draft");
      return withWarnings(res);
    },
    // Publish a draft -> new .version.N + .latest (or a pending approval when the workspace gates publishes).
    async publish(orgId, wsId, namespace2, id) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: wsId || void 0, namespace: namespace2, id })
      });
      if (res.ok === false) throw fail(res, "Failed to publish");
      return withWarnings(res);
    },
    // BULK publish MANY records in ONE request (data-access redesign). Two shapes:
    //   • ids: ['id', ...]                → publish each record's existing DRAFT (the edit → publish flow)
    //   • records: [{ id, value }, ...]   → DRAFT-LESS: publish the supplied values directly (imports —
    //     one request for a whole CSV migration, no per-record draft write). optional expectedVersions.
    // Replaces a loop of publish() (each a server-side scan + 2 writes + draft delete). Returns
    // { published, skipped, failed, results }. create_only 409s; a publish review gate refuses the batch.
    async publishRecords(orgId, wsId, namespace2, idsOrRecords, expectedVersions) {
      var body = (
        /** @type {Record<string, any>} */
        { ws: wsId || void 0, namespace: namespace2 }
      );
      var arr = idsOrRecords || [];
      if (arr.length && typeof arr[0] === "object") body.records = arr;
      else body.instances = arr;
      if (expectedVersions && typeof expectedVersions === "object") body.expected_versions = expectedVersions;
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspace/records/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok === false) throw fail(res, "Failed to publish records");
      return withWarnings(res);
    },
    // BULK delete MANY record families in ONE request (data-access redesign) — ids: [id,...]. Removes each
    // record's bare/.draft/.latest/.version.N owned by the caller's own identity in one batched call
    // (needs memory:delete scope). Replaces a loop of deleteObject() (a scan + per-key delete each).
    // Returns { deleted:[{id,keys}], failed:[{id,reason}], rows_removed }.
    async deleteRecords(orgId, wsId, namespace2, ids) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspace/records/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: wsId || void 0, namespace: namespace2, ids: ids || [] })
      });
      if (res.ok === false) throw fail(res, "Failed to delete records");
      return res.data !== void 0 ? res.data : res;
    },
    // Reopen a published record for editing (server copies .latest -> .draft; 409 if a draft exists).
    async revertToDraft(orgId, wsId, namespace2, id) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: wsId || void 0, namespace: namespace2, id })
      });
      if (res.ok === false) throw fail(res, "Failed to revert to draft");
      return res.data !== void 0 ? res.data : res;
    },
    // Delete one object: bare key + .draft + .latest + all .version.N history (re-run for huge
    // histories). NOTE: needs the memory:delete scope — app-grant tokens don't get it by default,
    // declare it via <meta name="aimeat-scopes" content="memory:read memory:write memory:delete">.
    async deleteObject(orgId, wsId, namespace2, id) {
      var base = wsRoot(orgId, wsId) + "." + namespace2 + "." + id;
      var res = await authFetch("/v1/memory?prefix=" + encodeURIComponent(base) + "&limit=200");
      if (res.ok === false) throw fail(res, "Failed to list object keys");
      var items = res.data && res.data.items || [];
      var deleted = 0, attempted = 0, lastErr = null;
      for (var i = 0; i < items.length; i++) {
        var key = items[i].key;
        if (key !== base && key.indexOf(base + ".") !== 0) continue;
        attempted++;
        var dres = await authFetch("/v1/memory/" + encodeURIComponent(key), { method: "DELETE" });
        if (dres.ok !== false) deleted++;
        else lastErr = dres;
      }
      if (attempted > 0 && deleted === 0 && lastErr) throw fail(lastErr, "Failed to delete object keys");
      return { deleted, attempted };
    },
    // Save the workspace README (creator/org-admin only — the server enforces it).
    async saveReadme(orgId, wsId, readme) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/workspace?ws=" + encodeURIComponent(wsId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readme })
      });
      if (res.ok === false) throw fail(res, "Failed to save README");
      return res.data !== void 0 ? res.data : res;
    },
    // Organism-wide server-side search.
    async search(orgId, q) {
      var res = await authFetch("/v1/organisms/" + encodeURIComponent(orgId) + "/search?q=" + encodeURIComponent(q));
      if (res.ok === false) throw fail(res, "Search failed");
      var d = res.data !== void 0 ? res.data : res;
      return d && (d.results || d.hits || d.items) || (Array.isArray(d) ? d : []);
    },
    util: {
      stripMeta,
      isMetaField,
      titleOf,
      bodyFieldOf,
      isDocLike,
      updatedAt: valueUpdatedAt,
      wsRoot,
      draftKey,
      normalizeWorkspace,
      readmeText,
      TITLE_FIELDS: TITLE_FIELDS.slice(),
      BODY_FIELDS: BODY_FIELDS.slice()
    }
  };
  var http = { authFetch, fail, getSession };
  Object.assign(organism, workspaceMembers(http), firstRun(http, organism));
  attach("organism", organism);
})();
