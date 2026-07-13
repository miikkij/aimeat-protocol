/**
 * @file public/views/profile/agents/scope-config.js
 * @description Agent scope-management constants (domains, templates) + label helpers
 *   shared by the agents tab and the scope-management modal. Extracted from
 *   ../agents-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/agents-tab.js (max-file-lines)
 */
import { t } from '/js/i18n.js';

// === Scope Management Constants ===
export const SCOPE_DOMAINS = [
  { key: 'memory',    permissions: ['read', 'write', 'delete'] },
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

export function templateLabel(name) {
  const map = { readonly: 'readOnly', standard: 'standard', full: 'fullAccess', custom: 'custom' };
  return t(`profile.agents.scopeUi.${map[name] || 'custom'}`);
}

export function domainLabel(domain) {
  const cap = domain.charAt(0).toUpperCase() + domain.slice(1);
  return t(`profile.agents.scopeUi.domain${cap}`);
}

export function permLabel(perm) {
  const cap = perm.charAt(0).toUpperCase() + perm.slice(1);
  return t(`profile.agents.scopeUi.perm${cap}`);
}
