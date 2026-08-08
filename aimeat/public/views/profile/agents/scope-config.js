/**
 * @file public/views/profile/agents/scope-config.js
 * @description Agent scope labels for the agents tab and the scope-management modal, over the
 *   pure scope model in ./scope-model.js (re-exported here so both consumers keep one import).
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/agents-tab.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — memory:write-as-owner, so an owner can let one agent write into their own
 *     namespace. Deliberately absent from readonly/standard; '*' carries it, as it does for
 *     messages:send-as-owner.
 *   v1.2.0 — 2026-08-08 — The constants and the expand/collapse pair moved to ./scope-model.js,
 *     which imports nothing and so can be unit-tested; this file is now the t()-dependent half.
 */
import { t } from '/js/i18n.js';

export {
  SCOPE_DOMAINS, SCOPE_TEMPLATES, NOT_IN_WILDCARD,
  wildcardScopes, bulkScopes, expandScopes, collapseScopes, detectTemplate,
} from './scope-model.js';

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
