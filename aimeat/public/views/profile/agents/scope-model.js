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
 *   v1.0.0 — 2026-08-08 — Split out of scope-config.js so the wildcard round trip is testable.
 */

/**
 * Scopes that `*` deliberately does NOT carry, mirroring the server: hasWriteReserved() in
 * src/routes/memory/owner-target.ts tests the EXACT string, while every other scope check honours
 * the wildcard. "Full access" is one click, and nobody clicking it is deciding that an agent may
 * point their decrypted AI key at a URL of its choosing — so that one costs its own tick.
 */
export const NOT_IN_WILDCARD = ['memory:write-reserved'];

export const SCOPE_DOMAINS = [
  // write-as-owner: write into the OWNER's namespace instead of the agent's own. Same shape as
  // messages:send-as-owner below — an explicit, owner-granted delegation. The agent must ALSO
  // ask for it per call, so granting it changes nothing on its own.
  // write-reserved: ALSO the keys the server itself trusts (openrouter.* / ai-usage.* /
  // profile.*). For an agent that administers the account. Not in '*' on purpose — see
  // WRITE_RESERVED_SCOPE in src/routes/memory/owner-target.ts.
  { key: 'memory',    permissions: ['read', 'write', 'delete', 'write-as-owner', 'write-reserved'] },
  { key: 'storage',   permissions: ['read', 'write'] },
  { key: 'work',      permissions: ['request', 'read', 'accept', 'publish'] },
  { key: 'social',    permissions: ['read', 'write'] },
  { key: 'messages',  permissions: ['send', 'read', 'send-as-owner'] },
  { key: 'wallet',    permissions: ['read'] },
  { key: 'consent',   permissions: ['manage'] },
  { key: 'tunnel',    permissions: ['connect'] },
  { key: 'agent',     permissions: ['register'] },
  { key: 'catalogue', permissions: ['read'] },
  { key: 'generator', permissions: ['read', 'write', 'execute'] },
  { key: 'task', permissions: ['read', 'write', 'manage'] },
  // cortex:write — install/activate/deactivate/delete cortex libraries (browser-side UI)
  // ext:write    — activate/deactivate/delete extensions, manage instances (server-side WASM)
  // Note: extension INSTALL is requireAuth-only at the route (agents can push code that stays
  // inert until ext:write activates it). Cortex INSTALL requires cortex:write.
  { key: 'cortex',    permissions: ['write'] },
  { key: 'ext',       permissions: ['write'] },
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

/** A stored scope array → the set of ticked boxes. */
export function expandScopes(scopeList) {
  // `*` first, then the explicit entries on top: an agent can hold ['*', 'memory:write-reserved'],
  // and the wildcard must not erase the extra that was granted alongside it.
  const set = scopeList.includes('*') ? wildcardScopes() : new Set();
  for (const s of scopeList) {
    if (s === '*') continue;
    const [domain, perm] = s.split(':');
    if (perm === '*') {
      const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
      // A domain wildcard carries no more than the global one does.
      if (domDef) bulkScopes(domDef).forEach(sc => set.add(sc));
    } else {
      set.add(s);
    }
  }
  return set;
}

/**
 * The ticked boxes → the scope array to store. Collapses to `*` only over what the wildcard
 * carries, keeping every out-of-wildcard scope spelled out beside it.
 */
export function collapseScopes(checked) {
  const extras = NOT_IN_WILDCARD.filter(s => checked.has(s));
  if ([...wildcardScopes()].every(s => checked.has(s))) return ['*', ...extras];
  const arr = [...checked];
  return arr.length > 0 ? arr : ['catalogue:read'];
}

export function detectTemplate(scopes) {
  if (!scopes || scopes.length === 0) return 'full';
  if (scopes.includes('*')) return 'full';
  const sorted = [...scopes].sort();
  for (const [name, tpl] of Object.entries(SCOPE_TEMPLATES)) {
    if (name === 'full') continue;
    const tplSorted = [...tpl].sort();
    if (sorted.length === tplSorted.length && sorted.every((s, i) => s === tplSorted[i])) return name;
  }
  return 'custom';
}
