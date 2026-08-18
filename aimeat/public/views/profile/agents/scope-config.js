/**
 * @file public/views/profile/agents/scope-config.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
  knownScopes, unknownScopes,
} from './scope-model.js';

export function templateLabel(name) {
  const map = { readonly: 'readOnly', standard: 'standard', full: 'fullAccess', custom: 'custom' };
  return t(`profile.agents.scopeUi.${map[name] || 'custom'}`);
}

export function domainLabel(domain) {
  const cap = domain.charAt(0).toUpperCase() + domain.slice(1);
  return t(`profile.agents.scopeUi.domain${cap}`);
}

/**
 * The label for one checkbox.
 *
 * Prefers a per-SCOPE sentence (`scopeText.finance.write` → "Write and send invoices in your
 * name") over the shared per-permission word. "Write" told an owner nothing: the same word sat on
 * a row that saves a note and on a row that books an accounting entry, and the only way to tell
 * them apart was the technical string beside it. Falls back to the old label when a scope has no
 * sentence yet, and t() returning the key unchanged is what "no sentence yet" looks like.
 */
export function permLabel(perm, domain) {
  if (domain) {
    const key = `profile.agents.scopeUi.scopeText.${domain}.${perm}`;
    const text = t(key);
    if (text && text !== key) return text;
  }
  const cap = perm.charAt(0).toUpperCase() + perm.slice(1);
  return t(`profile.agents.scopeUi.perm${cap}`);
}
