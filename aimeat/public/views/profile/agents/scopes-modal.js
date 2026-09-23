/**
 * @file public/views/profile/agents/scopes-modal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Scope-management modal for an agent: template presets + advanced per-domain
 *   permission checkboxes, read-only view for non-owners. Extracted from ../agents-tab.js
 *   to satisfy max-file-lines.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared set (components/poster-parts.js): the shared
 *     dialog, the presets as tab actions, the advanced list a Fold of domains whose permissions are
 *     list rows (the words, the scope string in mono, a checkbox Field), each inside its label. The domain header toggles through its
 *     "all" action. No class of its own.
 *   v1.0.1 — 2026-09-13 — The large dialog size; Cancel and Save sit in the footer, where they stay in
 *     view while the advanced list scrolls.
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/agents-tab.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — The editor stopped treating `*` as "every box". It expanded the wildcard
 *     into all of them, so memory:write-reserved — which the server grants on the exact string
 *     only — showed as already granted on a full-access agent, and then collapsed a fully-ticked
 *     editor back to ['*'] on save, dropping it again. Ticking it therefore could never take
 *     effect, which is exactly what production showed: the grant looked on, the write was refused.
 *   v1.2.0 — 2026-08-08 — Each row says what it does ("Write and send invoices, and book accounting
 *     entries in your name") instead of sharing one word with every other domain's row; a scope the
 *     editor has no row for is listed under "other permissions" so it can be seen and removed
 *     rather than silently kept; and the dialog states that a change takes effect on the agent's
 *     next connection, which is what the session-scope snapshot actually does.
 *   v1.3.0 — 2026-08-29 — The poster face (profile.css "Scope Management UI"): the envelope is an
 *     inline SVG, the always-on mark and the "all" toggle are words in a mono chip, no emoji.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { InboxLink } from '/components/InboxLink.js';
import { Dialog, Stack, Fold, ListRow, Field, Chip, Action, Text } from '/components/poster-parts.js';
import {
  SCOPE_DOMAINS, SCOPE_TEMPLATES, NOT_IN_WILDCARD,
  wildcardScopes, bulkScopes, expandScopes, collapseScopes, detectTemplate, unknownScopes,
  templateLabel, domainLabel, permLabel,
} from './scope-config.js';

// The envelope beside the agent's address: the door to its inbox thread.
const MAIL_ICON = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14"/><path d="M3 7l9 6 9-6"/></svg>`;

export default function ScopesModal({ agent, session, onSave, onCancel }) {
  const scopes = agent.default_scopes ?? ['*'];
  // Scopes with no row of their own. Rendered anyway, at the bottom: one the owner cannot see is
  // one they cannot revoke.
  const unknown = unknownScopes(scopes);

  const [checked, setChecked] = useState(() => expandScopes(scopes));
  const [advanced, setAdvanced] = useState(() => detectTemplate(scopes) === 'custom');
  const [saving, setSaving] = useState(false);
  // Read from what would be SAVED, not from the expanded checkbox set — otherwise a fully-ticked
  // editor never matches a template and "Full access" stays unlit while being exactly what it is.
  const currentTemplate = detectTemplate(collapseScopes(checked, scopes));

  function applyTemplate(name) {
    // Templates replace the editable rows; a scope with no row is not something a preset can
    // decide about, so it is carried through rather than silently dropped.
    const carried = [...checked].filter(s => unknown.includes(s));
    const next = name === 'full' ? wildcardScopes() : new Set(SCOPE_TEMPLATES[name] || []);
    carried.forEach(s => next.add(s));
    setChecked(next);
  }

  function toggleScope(scope) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function toggleDomain(domain) {
    const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
    if (!domDef) return;
    const domScopes = bulkScopes(domDef);
    const allChecked = domScopes.every(s => checked.has(s));
    setChecked(prev => {
      const next = new Set(prev);
      domScopes.forEach(s => allChecked ? next.delete(s) : next.add(s));
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    await onSave(agent.name, collapseScopes(checked, scopes));
    setSaving(false);
  }

  const isReadOnly = !(session.roles?.includes('owner') || session.roles?.includes('operator'));

  const cancel = html`<${Action} onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}<//>`;

  /**
   * One permission as a row: its plain words, the scope string in mono, its notes, and the checkbox
   * at the right. The row is wrapped in a label, as the old row was, so the words name the checkbox
   * and a press anywhere on the row toggles it.
   */
  const scopeRow = (scope, label, { locked = false, extra = false } = {}) => html`
    <label key=${scope}>
      <${ListRow} density="compact" name=${label ?? scope} detail=${label != null ? scope : null}
        actions=${html`<${Field} type="checkbox"
          value=${checked.has(scope) || locked}
          onChange=${() => !locked && toggleScope(scope)}
          disabled=${locked} />`}>
        ${(locked || extra) && html`<${Stack} direction="wrap" align="center" density="compact">
          ${locked && html`<${Chip} tone="muted">${t('profile.agents.scopeUi.alwaysOn')}<//>`}
          ${extra && html`<${Text} kind="caption" tone="coral">${t('profile.agents.scopeUi.notInFullAccess')}<//>`}
        <//>`}
      <//>
    </label>`;

  return html`
    <${Dialog} open=${true} onClose=${onCancel} size="large" title=${`${t('profile.agents.scopeUi.scopeProfile')}: ${agent.display_name || agent.name}`}
      actions=${isReadOnly ? cancel : html`
        ${cancel}
        <${Action} kind="primary" onClick=${handleSave} disabled=${saving}>
          ${saving ? t('profile.agents.scopeUi.saving') : t('profile.agents.scopeUi.save')}
        <//>`}>
      <${Stack}>
        <${Stack} direction="horizontal" align="center" density="compact">
          <${Text} kind="mono">${escHtml(agent.gaii || '')}<//>
          ${agent.gaii ? html`<${InboxLink} to=${agent.gaii} title=${t('inbox.messageThis')}>${MAIL_ICON}</${InboxLink}>` : null}
        <//>

        ${isReadOnly ? html`
          <${Text} kind="caption" tone="muted">${t('profile.agents.scopeUi.readOnlyView')}<//>
          <${Stack} direction="wrap" density="compact">
            ${scopes.map(s => html`<${Chip} key=${s}>${escHtml(s)}<//>`)}
          <//>
        ` : html`
          <${Stack} direction="wrap">
            ${['readonly', 'standard', 'full'].map(tpl => html`
              <${Action} kind="tab" key=${tpl} selected=${currentTemplate === tpl} onClick=${() => applyTemplate(tpl)}>
                ${templateLabel(tpl)}
              <//>
            `)}
          <//>

          <${Fold} title=${t('profile.agents.scopeUi.advanced')} open=${advanced} onToggle=${() => setAdvanced(!advanced)}>
            ${SCOPE_DOMAINS.map(d => {
              const allChecked = bulkScopes(d).every(s => checked.has(s));
              const isCatalogue = d.key === 'catalogue';
              return html`
                <${Stack} density="compact" key=${d.key}>
                  <${Stack} direction="horizontal" align="between">
                    <${Text} kind="label">${domainLabel(d.key)}<//>
                    ${!isCatalogue && html`<${Action} kind="tab" selected=${allChecked} onClick=${() => toggleDomain(d.key)}>${allChecked ? '✓ ' : ''}${t('profile.agents.scopeUi.all')}<//>`}
                  <//>
                  ${d.permissions.map(p => {
                    const scope = `${d.key}:${p}`;
                    return scopeRow(scope, permLabel(p, d.key), {
                      locked: isCatalogue && p === 'read',
                      extra: NOT_IN_WILDCARD.includes(scope),
                    });
                  })}
                <//>`;
            })}

            ${unknown.length > 0 && html`
              <${Stack} density="compact">
                <${Text} kind="label">${t('profile.agents.scopeUi.domainOther')}<//>
                <${Text} kind="caption" tone="muted">${t('profile.agents.scopeUi.otherScopesHint')}<//>
                ${unknown.map(scope => scopeRow(scope, null))}
              <//>
            `}
          <//>

          <${Text} kind="caption" tone="muted">${t('profile.agents.scopeUi.reconnectNote')}<//>
        `}
      <//>
    <//>`;
}
