/**
 * @file public/views/profile/agents/scope-model.js
 * @description What an agent's scope set IS and how the checkbox editor converts to and from it —
 *   the pure half of scope-config.js, with no imports, so it can be executed by a unit test.
 *
 *   It is separate for one reason: the editor's expand/collapse pair is a round trip, and a round
 *   trip that silently loses a member is invisible in every screenshot. `*` used to expand into
 *   every checkbox and a fully-ticked editor used to collapse back to `['*']`, so
 *   `memory:write-reserved` — which the server grants on the exact string only — always LOOKED
 *   granted and could never be SAVED. Both halves have to agree about what the wildcard carries,
 *   and now they agree here, once, under test/unit/agent-scope-model.test.ts.
 * @structure NOT_IN_WILDCARD · SCOPE_DOMAINS · SCOPE_TEMPLATES · wildcardScopes · expandScopes ·
 *   collapseScopes · bulkScopes · detectTemplate
 * @usage
 *   import { expandScopes, collapseScopes } from './scope-model.js';
 *   const checked = expandScopes(agent.default_scopes ?? ['*']);
 *   await save(collapseScopes(checked));
 * @version-history
 *   v1.1.0 — 2026-08-10 — Three new domains (agent, app, capability) plus organism:write,
 *     organism:invite and ext:invoke. These name things an agent could already do with no
 *     permission at all, because the MCP scope table read silence as consent.
 *   v1.0.0 — 2026-08-08 — Split out of scope-config.js so the wildcard round trip is testable.
 *   v1.1.0 — 2026-08-08 — The vocabulary caught up with the node, and the round trip stopped losing
 *     things. 17 scopes the node enforces had no row — bookkeeping, outgoing email, automations,
 *     connected accounts, the marketplace — so unticking one unrelated box dropped the agent out of
 *     '*' and revoked every one of them at once, none of them named anywhere in the dialog. Four
 *     boxes granted nothing (generator:*, agent:register) and one more (task:manage) was dead too.
 *     Anything the editor does not recognise is now carried through instead of discarded, an
 *     unknown domain wildcard no longer collapses the whole grant to ['catalogue:read'], a domain
 *     wildcard the agent already held is re-emitted when that domain was untouched, and an empty
 *     scope list no longer reports itself as full access.
 */

/**
 * Scopes that `*` deliberately does NOT carry, mirroring the server: hasWriteReserved() in
 * src/routes/memory/owner-target.ts tests the EXACT string, while every other scope check honours
 * the wildcard. "Full access" is one click, and nobody clicking it is deciding that an agent may
 * point their decrypted AI key at a URL of its choosing — so that one costs its own tick.
 */
export const NOT_IN_WILDCARD = ['memory:write-reserved'];

/**
 * The vocabulary of the checkbox editor.
 *
 * The rule for what belongs here: **ticking or unticking it must change what THIS AGENT can do.**
 * That is stricter than "the node reads the string somewhere", and the difference is not academic —
 * an audit of all 49 scope strings the node checks found eight where the tick binds someone else or
 * nobody:
 *
 *   contract:spend      only an app session is ever refused (services/metered-access.ts:151)
 *   events:emit         requireRole('ecosystem') runs first, so never an agent
 *   organism:write      requireRoleOrScope('agent', …) — an agent passes by ROLE, tick or no tick
 *   task:manage         nothing in src/ reads it at all
 *   agent:register      nothing in src/ reads it at all
 *   generator:*         the Generator was removed 2026-07-18; three dead strings
 *
 * A box that grants nothing is worse than a missing box: it answers the owner's question wrongly.
 * The dead ones were removed rather than relabelled; an agent that still holds one now shows it in
 * the editor's "other permissions" section, where it can be unticked (see unknownScopes).
 */
export const SCOPE_DOMAINS = [
  // write-as-owner: write into the OWNER's namespace instead of the agent's own. Same shape as
  // messages:send-as-owner below — an explicit, owner-granted delegation. The agent must ALSO
  // ask for it per call, so granting it changes nothing on its own.
  // write-reserved: ALSO the keys the server itself trusts (openrouter.* / ai-usage.* /
  // profile.*). For an agent that administers the account. Not in '*' on purpose — see
  // WRITE_RESERVED_SCOPE in src/routes/memory/owner-target.ts. It is a MODIFIER on write-as-owner:
  // on its own it lifts a block on writes the agent is not making.
  { key: 'memory',    permissions: ['read', 'write', 'delete', 'write-as-owner', 'write-reserved'] },
  { key: 'storage',   permissions: ['read', 'write'] },
  { key: 'ai',        permissions: ['use'] },
  { key: 'work',      permissions: ['request', 'read', 'accept', 'publish'] },
  { key: 'social',    permissions: ['read', 'write'] },
  { key: 'messages',  permissions: ['send', 'read', 'send-as-owner'] },
  { key: 'wallet',    permissions: ['read'] },
  { key: 'consent',   permissions: ['manage'] },
  { key: 'tunnel',    permissions: ['connect'] },
  { key: 'catalogue', permissions: ['read'] },
  { key: 'task',      permissions: ['read', 'write'] },
  { key: 'workflow',  permissions: ['read', 'write'] },
  // The money and the outside world. These were enforced by the node with no row in this editor,
  // so an owner could neither grant nor revoke them here while an agent used them daily.
  { key: 'finance',   permissions: ['read', 'write'] },
  { key: 'outbound',  permissions: ['send'] },
  { key: 'company',   permissions: ['read', 'write'] },
  { key: 'connections', permissions: ['read', 'write', 'use'] },
  { key: 'notifications', permissions: ['send'] },
  { key: 'exchange',  permissions: ['read', 'write', 'grant', 'beneficiary'] },
  { key: 'commerce',  permissions: ['sell', 'buy'] },
  // organism:read   — see the organisms and workspaces this agent's owner belongs to
  // organism:write  — create a workspace, write and publish documents in one, comment, revert
  // organism:invite — hand somebody else access: invite a member, grant or revoke a workspace role.
  //                   Separate from write because it changes WHO ELSE can read the owner's knowledge,
  //                   which is a different promise than changing the knowledge.
  { key: 'organism',  permissions: ['read', 'write', 'invite'] },
  { key: 'provenance', permissions: ['write'] },
  // cortex:write — install/activate/deactivate/delete cortex libraries (browser-side UI)
  // ext:write    — activate/deactivate/delete extensions, manage instances (server-side WASM)
  // Note: extension INSTALL is requireAuth-only at the route (agents can push code that stays
  // inert until ext:write activates it). Cortex INSTALL requires cortex:write.
  { key: 'cortex',    permissions: ['write'] },
  { key: 'ext',       permissions: ['write', 'invoke'] },

  // ── Added 2026-08-10 (August 2026 audit, step 3a) ────────────────────────────────────────────
  // These name things an agent could already do with no permission at all, because the MCP surface
  // reads a missing entry in its scope table as permission rather than as an omission. Adding the
  // words is what lets an owner see them and take them away.
  //
  // agent:write — reconfigure ANOTHER of the owner's agents: its mode, its tags. Not its own
  //               record, which needs nothing — an agent describing itself is answering about
  //               itself. This is the one that reaches sideways, at a sibling principal with its
  //               own identity and its own trust score.
  // app:write   — publish or update an app under the owner's account, and save or publish a draft.
  // app:manage  — the destructive half: delete an app, fork one, remove a template. Split from
  //               write because publishing an update and deleting the thing are different risks.
  // capability:write — create, update, delete or vouch for a published capability. A capability is
  //               how this account offers work to others, so writing one speaks in the owner's name.
  { key: 'agent',      permissions: ['write'] },
  { key: 'app',        permissions: ['write', 'manage'] },
  { key: 'capability', permissions: ['write'] },
];

export const SCOPE_TEMPLATES = {
  readonly:  ['memory:read', 'storage:read', 'catalogue:read', 'social:read'],
  standard:  ['memory:read', 'memory:write', 'storage:read', 'storage:write', 'catalogue:read', 'social:read', 'work:request', 'work:read'],
  full:      ['*'],
};

/** Every scope `*` actually carries — each box in the editor except the out-of-wildcard ones. */
export function wildcardScopes() {
  const set = new Set();
  for (const d of SCOPE_DOMAINS) {
    for (const p of d.permissions) {
      const s = `${d.key}:${p}`;
      if (!NOT_IN_WILDCARD.includes(s)) set.add(s);
    }
  }
  return set;
}

/**
 * The scopes a domain's "all" header covers. An out-of-wildcard scope is left out on purpose: it
 * costs an explicit tick precisely so it cannot ride along with a bulk gesture.
 */
export function bulkScopes(domDef) {
  return domDef.permissions.map(p => `${domDef.key}:${p}`).filter(s => !NOT_IN_WILDCARD.includes(s));
}

/** Every scope string the editor has a row for. */
export function knownScopes() {
  const set = new Set();
  for (const d of SCOPE_DOMAINS) for (const p of d.permissions) set.add(`${d.key}:${p}`);
  return set;
}

/**
 * Scopes this agent holds that the editor has no row for — an unknown domain, a scope added to the
 * node before the editor caught up, or a malformed string from a hand-written PATCH.
 *
 * They are surfaced rather than dropped. A scope the owner cannot see is one they cannot revoke,
 * and silently discarding it on save revokes it without telling them — both directions are wrong,
 * and which one hurts depends only on whether the scope was doing something.
 */
export function unknownScopes(scopeList) {
  const known = knownScopes();
  return scopeList.filter(s => s !== '*' && !known.has(s) && !isKnownDomainWildcard(s));
}

function isKnownDomainWildcard(s) {
  const [domain, perm] = s.split(':');
  return perm === '*' && SCOPE_DOMAINS.some(d => d.key === domain);
}

/** A stored scope array → the set of ticked boxes (plus any scope with no box, kept verbatim). */
export function expandScopes(scopeList) {
  // `*` first, then the explicit entries on top: an agent can hold ['*', 'memory:write-reserved'],
  // and the wildcard must not erase the extra that was granted alongside it.
  const set = scopeList.includes('*') ? wildcardScopes() : new Set();
  for (const s of scopeList) {
    if (s === '*') continue;
    const [domain, perm] = s.split(':');
    if (perm === '*') {
      const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
      // A domain wildcard carries no more than the global one does. One for a domain the editor
      // does NOT know is kept as-is: dropping it silently revoked a real grant — `['finance:*']`
      // used to open-and-save into `['catalogue:read']`.
      if (domDef) bulkScopes(domDef).forEach(sc => set.add(sc));
      else set.add(s);
    } else {
      set.add(s);
    }
  }
  return set;
}

/**
 * The ticked boxes → the scope array to store.
 *
 * Collapses to `*` only over what the wildcard carries, keeps every out-of-wildcard scope spelled
 * out beside it, and carries through anything the editor has no row for. `original` is the array
 * the dialog opened with: a domain wildcard the agent already held is re-emitted when that domain
 * was left alone, so looking at an agent and pressing Save does not quietly rewrite `memory:*` into
 * a snapshot that stops covering whatever memory scope the node adds next.
 */
export function collapseScopes(checked, original = []) {
  const known = knownScopes();
  const extras = NOT_IN_WILDCARD.filter(s => checked.has(s));
  const carried = [...checked].filter(s => !known.has(s));
  if ([...wildcardScopes()].every(s => checked.has(s))) return ['*', ...extras, ...carried];

  const out = [];
  const consumed = new Set();
  for (const d of SCOPE_DOMAINS) {
    const domainWildcard = `${d.key}:*`;
    const bulk = bulkScopes(d);
    if (original.includes(domainWildcard) && bulk.every(s => checked.has(s))) {
      out.push(domainWildcard);
      bulk.forEach(s => consumed.add(s));
    }
  }
  for (const s of checked) if (!consumed.has(s)) out.push(s);
  return out.length > 0 ? out : ['catalogue:read'];
}

export function detectTemplate(scopes) {
  // A MISSING scope list is the legacy "everything" default (both call sites read
  // `default_scopes ?? ['*']`). An EMPTY one is not the same thing, and calling it full access
  // labelled a zero-access agent as the maximum grant.
  if (!scopes) return 'full';
  if (scopes.length === 0) return 'custom';
  if (scopes.includes('*')) return 'full';
  const sorted = [...scopes].sort();
  for (const [name, tpl] of Object.entries(SCOPE_TEMPLATES)) {
    if (name === 'full') continue;
    const tplSorted = [...tpl].sort();
    if (sorted.length === tplSorted.length && sorted.every((s, i) => s === tplSorted[i])) return name;
  }
  return 'custom';
}
