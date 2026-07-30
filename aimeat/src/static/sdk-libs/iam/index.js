/**
 * @file iam/index.js
 * @description The aimeat-iam client library. Exposes AIMEAT.iam — one surface for an app's OWN
 *   member model, whichever of the six in-app IAM extensions on this node it installed.
 *
 *   Why this exists: six apps needed the same thing and each built it, so the same six concepts were
 *   written six times and disagreed six ways. The extension stays the gate — a browser cannot
 *   enforce anything — and this library owns the part every app hand-rolled anyway: asking who the
 *   caller is, painting the affordances, and refusing before attempting.
 *
 *   The one thing to remember: `can()` is a HINT. It reads a cached list and exists so a user is not
 *   shown a control that will refuse them. `guard()` asks the server. Enforcement lives in the
 *   extension action that mutates data, and nothing in this file changes that.
 * @structure init() · me() · refresh() · check() · can/gate/guard (gate.js) · request() · roster() ·
 *   admin() · adminFetch() · MemberAdmin/JoinPanel (panel.js) · normalise() · attach('iam', …)
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-iam.js"></script>
 *   await AIMEAT.iam.init({ ext: 'nuotta-iam' });
 *   if (AIMEAT.iam.can('analyse')) showTab();            // hint
 *   await AIMEAT.iam.guard('bid', () => runScoring());   // asks the server
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 1): dialect adapter + normalised me() + gate
 *     helpers, against the six live extensions unchanged.
 */
import { makeSession } from '../_core/session.js';
import { resolveNodeUrl } from '../_core/config.js';
import { attach } from '../_core/namespace.js';
import { detectDialect, callCheck, callAdmin, callRequest } from './dialect.js';
import { makeGate } from './gate.js';
import { mountMemberAdmin, mountJoinPanel } from './panel.js';
import { nodeMe, nodeState, nodeAssign, nodeRevoke, nodeDecline, nodeRequest } from './node-roster.js';

const { authFetch } = makeSession('aimeat-iam.js');

/**
 * @typedef {Object} IamMe
 * @property {boolean} member    Does the caller hold a role beyond the default?
 * @property {boolean} isOwner   May the caller drive the admin surface?
 * @property {string|null} role  Role key, or null when the app has no role for this caller.
 * @property {number|null} level BBS ordinal, LOWER is more power. Null when the app has no ladder.
 * @property {string[]} caps     Capabilities the role holds. `['*']` means all.
 * @property {string|null} mode  open | members-only | invite-only, when the app has a mode.
 * @property {string|null} via   owner | agent | none — WHY the role resolved. Null on older forks.
 * @property {string|null} subject owner | gaii | both, when the app declares it.
 * @property {string|null} since When the caller became a member, when the app records it.
 */

/** @typedef {import('./dialect.js').Dialect} Dialect */

/** @type {{ ext: string|null, app: string|null, roleNames: string[], dialect: Dialect, gateDialect: Dialect|null, hasRequest: boolean, me: IamMe|null, roles: Record<string,string[]> }} */
const state = { ext: null, app: /** @type {string|null} */ (null), roleNames: /** @type {string[]} */ ([]),
  dialect: /** @type {Dialect} */ ('op'),
  // Which dialect the CAPABILITY gate speaks, when the roster is the node's and the vocabulary an
  // extension's. Null means there is no extension to ask, not that the app is ungated.
  gateDialect: /** @type {Dialect|null} */ (null),
  hasRequest: false, me: null, roles: {} };

/**
 * Turn one dialect's answer into the shape every app can read. The `op` family answers per
 * capability and carries the role; the `command` family answers with the whole capability list at
 * once; a level registry answers with an ordinal and no vocabulary at all. The differences are
 * absorbed here so nothing above has to branch.
 * @param {any} raw            The gate action's payload.
 * @param {Record<string, string[]>} roles  role → capabilities, when the app exposes it.
 * @param {string} dialect
 * @returns {IamMe}
 */
function normalise(raw, roles, dialect) {
  const r = raw || {};
  if (dialect === 'command') {
    return {
      member: !!(r.member || r.isOwner),
      isOwner: !!r.isOwner,
      role: r.role || null,
      level: typeof r.level === 'number' ? r.level : null,
      caps: Array.isArray(r.may) ? r.may : [],
      mode: r.mode || null,
      via: null,
      subject: null,
      since: r.since || null,
    };
  }
  if (dialect === 'level') {
    // A level registry holds no capability vocabulary, so `caps` is empty BY NATURE. Saying so is
    // better than inventing a list an app would then gate on.
    return {
      member: typeof r.level === 'number',
      isOwner: !!r.isOwner,
      role: r.role || r.key || null,
      level: typeof r.level === 'number' ? r.level : null,
      caps: [],
      mode: null,
      via: null,
      subject: null,
      since: r.since || null,
    };
  }
  const role = r.role || null;
  return {
    member: !!role && role !== (r.defaultRole || null),
    isOwner: !!r.isOwner,
    role: role,
    level: typeof r.level === 'number' ? r.level : null,
    caps: (role && roles[role]) || [],
    mode: r.mode || null,
    via: r.via || null,
    subject: r.subject || null,
    since: r.since || null,
  };
}

const iam = {
  /**
   * Learn how this app's gate is shaped, then read the caller's standing. One detection round-trip,
   * after which nothing guesses. Pass `dialect` to skip detection entirely.
   * @param {Object} opts
   * @param {string} [opts.app]   `owner/file.html` — use the NODE's roster (preferred for anything new).
   * @param {string} [opts.ext]   An installed IAM extension, when the gate lives there.
   * @param {string[]} [opts.roles] The app's role vocabulary. The node deliberately does not own it.
   * @param {'node'|'op'|'command'|'level'} [opts.dialect] Skip detection.
   * @returns {Promise<IamMe>}
   */
  async init(opts) {
    if (!opts || (!opts.ext && !opts.app)) {
      throw new Error('aimeat-iam: init needs { app } for the node roster, or { ext } for an extension gate');
    }
    state.ext = opts.ext || null;
    state.app = opts.app || null;
    state.roleNames = Array.isArray(opts.roles) ? opts.roles : [];
    // An app id means the NODE keeps the roster: it notifies, keeps the list private and moves the
    // free access with the role, none of which an extension can do. An extension may still be named
    // alongside it, and then it holds only the capability vocabulary.
    if (state.app) {
      state.dialect = /** @type {Dialect} */ ('node');
      state.hasRequest = true;
      // The roster is the node's, but the CAPABILITY question still belongs to the extension when
      // one is named — and naming both is the recommended shape, not an exotic one. Without this the
      // gate action resolved to the node dialect's `null` and every check() posted to an action
      // called "null", which 404s. The app's own hand-written fetch kept working, so the library
      // looked fine right up until an app actually used it.
      state.gateDialect = null;
      if (state.ext) {
        try {
          const d = await detectDialect(resolveNodeUrl(), state.ext);
          state.gateDialect = d.dialect;
        } catch {
          // A gate that cannot be described is a gate this library will not guess at: can() then
          // answers from the roster role alone, which is the truthful narrower answer.
          state.gateDialect = null;
        }
      }
      return iam.refresh();
    }
    if (opts.dialect) {
      state.dialect = opts.dialect;
      state.hasRequest = opts.dialect === 'command';
    } else {
      const d = await detectDialect(resolveNodeUrl(), opts.ext);
      state.dialect = d.dialect;
      state.hasRequest = d.hasRequest;
    }
    return iam.refresh();
  },

  /**
   * Re-read the caller's standing from the server. Call this after anything that could change it,
   * and on the `aimeat-live-update` event if the host page listens for one.
   * @returns {Promise<IamMe>}
   */
  async refresh() {
    requireInit();
    // The role→capability map lives on the admin surface, which answers a redacted view to a
    // non-owner: the vocabulary is public, the roster is not. A fork that refuses it outright is
    // not an error — it just means capabilities cannot be listed, and `caps` stays empty.
    if (state.dialect === 'node') {
      const raw = await nodeMe(authFetch, /** @type {string} */ (state.app));
      state.me = {
        member: raw.member, isOwner: raw.isOwner, role: raw.role, level: raw.level,
        caps: raw.isOwner ? ['*'] : (state.roles[raw.role] || []),
        mode: null, via: raw.via, subject: 'owner', since: raw.since,
      };
      return state.me;
    }
    let adminState = null;
    if (state.dialect !== 'command') {
      adminState = await callAdmin(authFetch, state.ext, state.dialect, 'state').catch(() => null);
      if (adminState && adminState.roles) state.roles = adminState.roles;
    }
    const probe = state.dialect === 'op' ? { permission: ' probe' } : {};
    const raw = await callCheck(authFetch, state.ext, state.dialect, probe);
    state.me = normalise(raw, state.roles, state.dialect);
    // In the `op` family the GATE never says whether the caller may administer: only the admin
    // surface does, and it answers a redacted view rather than an error to everyone else. Reading
    // isOwner off the check response left every owner looking like a stranger to their own panel.
    if (adminState && typeof adminState.isOwner === 'boolean') state.me.isOwner = adminState.isOwner;
    return state.me;
  },

  /**
   * The caller's standing as last read. Null until init() has run.
   * @returns {IamMe|null}
   */
  me() { return state.me; },

  /** The dialect in use, for an app that wants to explain itself. @returns {string} */
  dialect() { return state.dialect; },

  /**
   * Ask the gate directly. This is the call an app should mirror server-side before it mutates
   * anything; the answer carries the mutation tier when a command id is passed, so an agent knows
   * when to seek human confirmation.
   * @param {{ permission?: string, command?: string }} input
   * @returns {Promise<{ allowed: boolean, role?: string, tier?: string, needsConfirmation?: boolean, via?: string }>}
   */
  async check(input) {
    requireInit();
    // With the roster on the node and the vocabulary in an extension, the gate is the extension's.
    if (state.dialect === 'node') {
      if (!state.gateDialect) {
        // No extension to ask: answer from the roster role, which is all there is to know.
        const me = state.me || await iam.refresh();
        const cap = (input && (input.permission || input.command)) || '';
        return { allowed: me.caps.indexOf('*') !== -1 || me.caps.indexOf(cap) !== -1, role: me.role || undefined };
      }
      return callCheck(authFetch, /** @type {string} */ (state.ext), state.gateDialect, input || {});
    }
    if (state.dialect === 'command') {
      // This gate answers with the whole list, so a per-capability question is decided from it
      // rather than by a call the extension does not offer.
      const raw = await callCheck(authFetch, state.ext, state.dialect, {});
      const me = normalise(raw, state.roles, state.dialect);
      const cap = (input && (input.permission || input.command)) || '';
      const allowed = me.caps.indexOf('*') !== -1 || me.caps.indexOf(cap) !== -1;
      return { allowed: allowed, role: me.role || undefined };
    }
    return callCheck(authFetch, state.ext, state.dialect, input || {});
  },

  /**
   * Ask the owner for access. Where the extension has no request action the visit itself is the
   * application, and the answer says so (`passive: true`) instead of reporting a send that did not
   * happen.
   * @param {string} [note]  Who you are and what you need it for.
   * @returns {Promise<{ recorded: boolean, passive: boolean }>}
   */
  request(note) {
    requireInit();
    if (state.dialect === 'node') return nodeRequest(authFetch, /** @type {string} */ (state.app), note);
    return callRequest(authFetch, state.ext, state.dialect, state.hasRequest, note);
  },

  /**
   * The member roster, owner-only. Normalised to one row shape across the dialects that keep a map
   * (`op`) and the one that keeps a list (`command`).
   * @returns {Promise<{ ok: boolean, members: Array<{ id: string, role: string|null, level: number|null, since: string|null, grants: string[] }>, error?: string }>}
   */
  async roster() {
    requireInit();
    if (state.dialect === 'node') {
      const st = await nodeState(authFetch, /** @type {string} */ (state.app), state.roleNames);
      if (st && st.ok === false) return { ok: false, members: [], error: st.error };
      return {
        ok: true,
        members: (st.members || []).map((m) => ({
          id: m.owner, role: m.role || null,
          level: typeof m.level === 'number' ? m.level : null,
          since: m.since || null, grants: m.offerings || [],
        })),
      };
    }
    const st = await callAdmin(authFetch, state.ext, state.dialect, 'state');
    if (st && st.ok === false) return { ok: false, members: [], error: st.error };
    if (state.dialect === 'command') {
      const rows = (st && st.members) || [];
      return {
        ok: true,
        members: rows.map((m) => ({
          id: m.owner, role: m.role || null,
          level: typeof m.level === 'number' ? m.level : null,
          since: m.since || null, grants: m.grants || [],
        })),
      };
    }
    const map = (st && st.assignments) || {};
    const levels = (st && st.levels) || {};
    return {
      ok: true,
      members: Object.keys(map).map((id) => ({
        id: id, role: map[id],
        level: typeof levels[map[id]] === 'number' ? levels[map[id]] : null,
        since: null, grants: [],
      })),
    };
  },

  /**
   * Drive the admin surface in this app's own dialect. `op` is a logical name (state | assign |
   * revoke) that the adapter translates, so a caller never learns which key its fork multiplexes on.
   * @param {string} op
   * @param {Record<string, unknown>} [args]
   * @returns {Promise<any>}
   */
  admin(op, args) {
    requireInit();
    if (state.dialect === 'node') {
      const app = /** @type {string} */ (state.app);
      if (op === 'state') return nodeState(authFetch, app, state.roleNames);
      if (op === 'assign') return nodeAssign(authFetch, app, args || {});
      if (op === 'revoke') return nodeRevoke(authFetch, app, args || {});
      if (op === 'decline') return nodeDecline(authFetch, app, args || {});
      // The node keeps WHO is a member, not what a role permits, so the vocabulary ops belong to the
      // extension. Refusing by name beats a silent no-op that looks like it worked.
      return Promise.resolve({ ok: false, error: `"${op}" is not a node-roster operation; the capability vocabulary lives in the app's extension` });
    }
    return callAdmin(authFetch, state.ext, state.dialect, op, args);
  },

  /**
   * An authed GET against the node, for the panel's free-access column. It reads
   * /v1/exchange/grants?app_id=, which is a NODE surface rather than the extension's, so it works
   * for any app that issues zero-priced grants on approval without that app writing the lookup.
   * @param {string} path
   * @returns {Promise<any>}
   */
  async adminFetch(path) {
    const body = await authFetch(path);
    return body && body.data !== undefined ? body.data : body;
  },

  /**
   * The owner's panel: the union of the six that already exist on this node. See panel.js for what
   * each section is and which app it came from.
   * @param {import('./panel.js').PanelOpts} opts
   */
  MemberAdmin(opts) {
    requireInit();
    return mountMemberAdmin(iam, opts);
  },

  /**
   * The applicant's side.
   * @param {{ target: string|Element, lang?: string, strings?: Record<string,string>, classMap?: Record<string,string>, styles?: boolean }} opts
   */
  JoinPanel(opts) {
    requireInit();
    return mountJoinPanel(iam, opts);
  },
};

/** Guard so a missing init() names itself instead of failing later inside a fetch. */
function requireInit() {
  if (!state.ext && !state.app) throw new Error('aimeat-iam: call AIMEAT.iam.init({ app }) or init({ ext }) first');
}

// can/gate/guard read the cached state and, for guard, the live gate.
const gateApi = makeGate({ me: () => state.me }, (input) => iam.check(input));
iam.can = gateApi.can;
iam.gate = gateApi.gate;
iam.guard = gateApi.guard;

attach('iam', iam);
