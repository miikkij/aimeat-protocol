/**
 * @file public/views/profile/agents/scopes-modal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Scope-management modal for an agent: template presets + advanced per-domain
 *   permission checkboxes, read-only view for non-owners. Extracted from ../agents-tab.js
 *   to satisfy max-file-lines.
 * @version-history
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
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { InboxLink } from '/components/InboxLink.js';
import { Modal } from '/components/Modal.js';
import {
  SCOPE_DOMAINS, SCOPE_TEMPLATES, NOT_IN_WILDCARD,
  wildcardScopes, bulkScopes, expandScopes, collapseScopes, detectTemplate, unknownScopes,
  templateLabel, domainLabel, permLabel,
} from './scope-config.js';

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

  return html`
    <${Modal} open=${true} onClose=${onCancel} className="scope-modal" title=${`${t('profile.agents.scopeUi.scopeProfile')}: ${agent.display_name || agent.name}`}>
        <div class="scope-agent-info">${escHtml(agent.gaii || '')}
          ${agent.gaii ? html`<${InboxLink} to=${agent.gaii} title=${t('inbox.messageThis')} className="scope-agent-msg">✉️</${InboxLink}>` : null}
        </div>

        ${isReadOnly ? html`
          <p class="text-caption mb-1">${t('profile.agents.scopeUi.readOnlyView')}</p>
          <div class="scope-readonly-list">
            ${scopes.map(s => html`<span class="scope-tag">${escHtml(s)}</span>`)}
          </div>
          <div class="form-actions mt-section">
            <button class="btn-outline" onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}</button>
          </div>
        ` : html`
          <div class="scope-templates">
            ${['readonly', 'standard', 'full'].map(tpl => html`
              <button class="scope-tpl-btn ${currentTemplate === tpl ? 'active' : ''}"
                      onClick=${() => applyTemplate(tpl)}>
                ${templateLabel(tpl)}
              </button>
            `)}
          </div>

          <button class="scope-advanced-toggle" onClick=${() => setAdvanced(!advanced)}>
            <span>${t('profile.agents.scopeUi.advanced')}</span>
            <span class="pf-chevron ${advanced ? 'pf-chevron-open' : ''}">▼</span>
          </button>

          ${advanced && html`
            <div class="scope-domains">
              ${SCOPE_DOMAINS.map(d => {
                const allChecked = bulkScopes(d).every(s => checked.has(s));
                const isCatalogue = d.key === 'catalogue';
                return html`
                  <div class="scope-domain">
                    <div class="scope-domain-header" onClick=${() => !isCatalogue && toggleDomain(d.key)}>
                      <span class="domain-label">${domainLabel(d.key)}</span>
                      ${!isCatalogue && html`<span class="domain-toggle">${allChecked ? '☑ all' : '☐'}</span>`}
                    </div>
                    ${d.permissions.map(p => {
                      const scope = `${d.key}:${p}`;
                      const isLocked = isCatalogue && p === 'read';
                      const isExtra = NOT_IN_WILDCARD.includes(scope);
                      return html`
                        <div class="scope-row ${isLocked ? 'disabled' : ''}">
                          <label>
                            <input type="checkbox"
                              checked=${checked.has(scope) || isLocked}
                              onChange=${() => !isLocked && toggleScope(scope)}
                              disabled=${isLocked}
                            />
                            <span class="scope-friendly">${permLabel(p, d.key)}</span>
                            <span class="scope-technical">${scope}</span>
                            ${isLocked && html`<span class="scope-lock" title=${t('profile.agents.scopeUi.alwaysOn')}>🔒</span>`}
                            ${isExtra && html`<span class="scope-extra-note">${t('profile.agents.scopeUi.notInFullAccess')}</span>`}
                          </label>
                        </div>`;
                    })}
                  </div>`;
              })}

              ${unknown.length > 0 && html`
                <div class="scope-domain">
                  <div class="scope-domain-header">
                    <span class="domain-label">${t('profile.agents.scopeUi.domainOther')}</span>
                  </div>
                  <p class="scope-domain-desc">${t('profile.agents.scopeUi.otherScopesHint')}</p>
                  ${unknown.map(scope => html`
                    <div class="scope-row">
                      <label>
                        <input type="checkbox"
                          checked=${checked.has(scope)}
                          onChange=${() => toggleScope(scope)}
                        />
                        <span class="scope-technical">${escHtml(scope)}</span>
                      </label>
                    </div>`)}
                </div>
              `}
            </div>
          `}

          <p class="scope-reconnect-note">${t('profile.agents.scopeUi.reconnectNote')}</p>

          <div class="form-actions mt-1">
            <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
              ${saving ? t('profile.agents.scopeUi.saving') : t('profile.agents.scopeUi.save')}
            </button>
            <button class="btn-outline" onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}</button>
          </div>
        `}
    <//>`;
}
