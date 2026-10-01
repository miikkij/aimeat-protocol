/**
 * @file organism/first-run.js
 * @description An app's first run, for AIMEAT.organism: list the caller's organisms with the role
 *   they hold, find the app's workspace in one of them or create it, and remember the choice in the
 *   owner's memory so the app does not ask again. Five apps wrote this by hand (cadence, lahetin,
 *   lattice, postinjalostamo, suppilo). Every method calls existing node routes: GET /v1/organisms,
 *   POST /v1/organisms, GET and POST /v1/organisms/:id/workspaces, GET /v1/organisms/:id/workspace,
 *   and /v1/memory (through AIMEAT.data when it is loaded). A refusal throws the node's own message.
 * @structure firstRun(h, organism) → { organisms, findOrCreateWorkspace, remember, recall }
 * @usage Object.assign(organism, firstRun({ authFetch, fail, getSession }, organism));
 *   const home = await AIMEAT.organism.recall('cadence', { verify: true })
 *     || await AIMEAT.organism.findOrCreateWorkspace({ org: orgId, name: 'CRM', kind: 'cadence-crm', objectTypes });
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (IAM plan Phase D block 3).
 */

/**
 * @typedef {Object} OrgHttp
 * @property {(path: string, opts?: RequestInit) => Promise<any>} authFetch
 * @property {(res: any, fallback: string) => Error} fail
 * @property {() => any} getSession
 */

/**
 * One organism the caller belongs to.
 * @typedef {Object} MyOrganism
 * @property {string} id
 * @property {string} name
 * @property {'owner'|'admin'|'member'} role  owner: holds the organism; admin: manages it; member: belongs.
 * @property {string} [type]
 * @property {string} [description]
 * @property {boolean} archived
 * @property {any} raw                         The node's organism record, as listed.
 */

/**
 * Where an app's data lives.
 * @typedef {Object} WorkspaceChoice
 * @property {string} orgId
 * @property {string} wsId
 */

/** '/v1/organisms/<id>' with the id encoded. */
function orgPath(orgId) {
  return '/v1/organisms/' + encodeURIComponent(orgId);
}

/** The data of an envelope. */
function dataOf(res) {
  return res && res.data !== undefined ? res.data : res;
}

/** The AIMEAT.data library, when the page loaded it. */
function dataLib() {
  var d = window.AIMEAT && window.AIMEAT.data;
  return d && typeof d.get === 'function' && typeof d.set === 'function' ? d : null;
}

/** The memory key a choice is kept under: `<appKey>.workspace`. */
function choiceKey(appKey) {
  var k = typeof appKey === 'string' ? appKey.trim() : '';
  if (!k || /\s/.test(k)) throw new Error('appKey must be a non-empty key prefix without spaces, e.g. "cadence"');
  return k + '.workspace';
}

/** A stored value that names a workspace, or null. */
function asChoice(v) {
  return v && typeof v === 'object' && typeof v.orgId === 'string' && v.orgId && typeof v.wsId === 'string' && v.wsId
    ? { orgId: v.orgId, wsId: v.wsId } : null;
}

/**
 * The first-run methods, bound to the session helpers and to the organism object they extend
 * (create and createWorkspace are its own).
 * @param {OrgHttp} h
 * @param {{ create: Function, createWorkspace: Function }} organism
 */
export function firstRun(h, organism) {
  /** The caller's account in both forms: as the session holds it, and bare when it is on this node. */
  function myAccounts() {
    var s = h.getSession();
    var owner = String(s.owner || (s.user && s.user.owner) || '');
    var ghii = String(s.ghii || '');
    var out = [owner];
    var at = owner.indexOf('@');
    if (at >= 0 && ghii && ghii.slice(ghii.indexOf('@')) === owner.slice(at)) out.push(owner.slice(0, at));
    if (at < 0 && ghii) out.push(ghii);
    return out.filter(Boolean);
  }

  /** GET /v1/organisms/:id/workspaces → the rows, refusal thrown. */
  async function listWorkspaces(orgId) {
    var res = await h.authFetch(orgPath(orgId) + '/workspaces');
    if (!res || res.ok === false) throw h.fail(res, 'Failed to list workspaces');
    var d = dataOf(res);
    return (d && d.workspaces) || [];
  }

  /** The manifest kind of one workspace (GET /v1/organisms/:id/workspace?ws=), or null when unreadable. */
  async function manifestKind(orgId, wsId) {
    var res = await h.authFetch(orgPath(orgId) + '/workspace?ws=' + encodeURIComponent(wsId));
    if (!res || res.ok === false) return null;
    var d = dataOf(res);
    return (d && d.manifest && d.manifest.kind) || null;
  }

  /** `org` as an organism id; an object without an id creates a new organism named by it. */
  async function resolveOrg(org) {
    if (typeof org === 'string' && org) return { id: org, created: false };
    if (org && typeof org === 'object' && typeof org.id === 'string' && org.id) return { id: org.id, created: false };
    if (org && typeof org === 'object' && typeof org.name === 'string' && org.name.trim()) {
      var made = await organism.create(org.name.trim(), { type: org.type, visibility: org.visibility, join_policy: org.join_policy, description: org.description });
      if (!made || !made.id) throw new Error('The node created no organism id');
      return { id: made.id, created: true };
    }
    throw new Error('org must be an organism id, or { name } to create a new organism');
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
      var res = await h.authFetch('/v1/organisms?member=' + encodeURIComponent(mine[0] || '') + '&per_page=100');
      if (!res || res.ok === false) throw h.fail(res, 'Failed to list organisms');
      var d = dataOf(res);
      var list = (d && (d.organisms || d.items)) || (Array.isArray(d) ? d : []);
      function holds(arr) { return Array.isArray(arr) && arr.some(function (a) { return mine.indexOf(a) >= 0; }); }
      return list.filter(function (o) { return o && o.id && (opts.archived || !o.archived); }).map(function (o) {
        /** @type {'owner'|'admin'|'member'} */
        var role = holds(o.owners) || mine.indexOf(o.creatorGhii) >= 0 ? 'owner' : (holds(o.admins) ? 'admin' : 'member');
        return { id: o.id, name: o.name || o.id, role: role, type: o.type, description: o.description, archived: !!o.archived, raw: o };
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
      opts = opts || /** @type {any} */ ({});
      var name = String(opts.name || '').trim();
      if (!name) throw new Error('findOrCreateWorkspace needs a workspace name');
      var org = await resolveOrg(opts.org);
      var kind = typeof opts.kind === 'string' && opts.kind ? opts.kind : null;
      if (!org.created) {
        var rows = (await listWorkspaces(org.id)).filter(function (w) { return w && w.id && !w.archived && w.access !== 'none'; });
        var lower = name.toLowerCase();
        var named = rows.filter(function (w) { return String(w.name || '').trim().toLowerCase() === lower; });
        var candidates = kind && opts.anyName ? named.concat(rows.filter(function (w) { return named.indexOf(w) < 0; })) : named;
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (kind && (await manifestKind(org.id, c.id)) !== kind) continue;
          return { orgId: org.id, wsId: c.id, name: c.name || name, created: false, orgCreated: false };
        }
      }
      if (opts.create === false) return null;
      var manifest = opts.manifest && typeof opts.manifest === 'object'
        ? Object.assign({}, opts.manifest)
        : { name: name, objectTypes: opts.objectTypes };
      if (kind && !manifest.kind) manifest.kind = kind;
      if (opts.purpose && !manifest.summary) manifest.summary = String(opts.purpose);
      var readme = opts.readme || (opts.purpose ? '# ' + name + '\n\n' + String(opts.purpose) : undefined);
      var made = await organism.createWorkspace(org.id, name, manifest, opts.schemas, readme);
      if (!made || !made.ws) throw new Error('The node created no workspace id');
      return { orgId: org.id, wsId: made.ws, name: name, created: true, orgCreated: org.created };
    },

    /**
     * Keep the app's workspace choice in the owner's memory under `<appKey>.workspace`, as
     * { orgId, wsId } with visibility 'owner' (the owner and their own agents read it). Writes
     * through AIMEAT.data.set when aimeat-data is loaded, else POST /v1/memory.
     * @param {string} appKey  The app's key prefix, e.g. 'cadence'.
     * @param {WorkspaceChoice} choice
     * @returns {Promise<WorkspaceChoice>}
     */
    async remember(appKey, choice) {
      var key = choiceKey(appKey);
      var value = asChoice(choice);
      if (!value) throw new Error('remember needs { orgId, wsId }');
      var lib = dataLib();
      if (lib) {
        await lib.set(key, value, { visibility: 'owner' });
        return value;
      }
      var res = await h.authFetch('/v1/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, value: value, visibility: 'owner' }),
      });
      if (!res || res.ok === false) throw h.fail(res, 'Failed to save the workspace choice');
      return value;
    },

    /**
     * The choice remember() kept, or null. Reads through AIMEAT.data.get when aimeat-data is loaded,
     * else GET /v1/memory/<key>?soft=1. With `{ verify: true }` it also lists the organism's
     * workspaces and answers null when the workspace is gone, archived or no longer readable, or the
     * node answers ACCESS_DENIED or NOT_FOUND for the organism; any other refusal is thrown.
     * @param {string} appKey
     * @param {{ verify?: boolean }} [opts]
     * @returns {Promise<WorkspaceChoice | null>}
     */
    async recall(appKey, opts) {
      opts = opts || {};
      var key = choiceKey(appKey);
      var lib = dataLib();
      var stored;
      if (lib) {
        stored = await lib.get(key);
      } else {
        var res = await h.authFetch('/v1/memory/' + encodeURIComponent(key) + '?soft=1');
        if (!res || res.ok === false) throw h.fail(res, 'Failed to read the workspace choice');
        var d = dataOf(res);
        stored = d ? d.value : null;
      }
      var choice = asChoice(stored);
      if (!choice || !opts.verify) return choice;
      var listed = await h.authFetch(orgPath(choice.orgId) + '/workspaces');
      if (!listed || listed.ok === false) {
        var code = listed && listed.error && listed.error.code;
        if (code === 'ACCESS_DENIED' || code === 'NOT_FOUND') return null;
        throw h.fail(listed, 'Failed to list workspaces');
      }
      var lw = dataOf(listed);
      var row = ((lw && lw.workspaces) || []).filter(function (w) { return w && w.id === choice.wsId; })[0];
      return row && !row.archived && row.access !== 'none' ? choice : null;
    },
  };
  return api;
}
