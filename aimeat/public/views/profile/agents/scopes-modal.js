/**
 * @file public/views/profile/agents/scopes-modal.js
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
  wildcardScopes, bulkScopes, expandScopes, collapseScopes, detectTemplate,
  templateLabel, domainLabel, permLabel,
} from './scope-config.js';

export default function ScopesModal({ agent, session, onSave, onCancel }) {
  const scopes = agent.default_scopes ?? ['*'];

  const [checked, setChecked] = useState(() => expandScopes(scopes));
  const [advanced, setAdvanced] = useState(() => detectTemplate(scopes) === 'custom');
  const [saving, setSaving] = useState(false);
  // Read from what would be SAVED, not from the expanded checkbox set — otherwise a fully-ticked
  // editor never matches a template and "Full access" stays unlit while being exactly what it is.
  const currentTemplate = detectTemplate(collapseScopes(checked));

  function applyTemplate(name) {
    if (name === 'full') setChecked(wildcardScopes());
    else setChecked(new Set(SCOPE_TEMPLATES[name] || []));
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
    await onSave(agent.name, collapseScopes(checked));
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
                            <span class="scope-friendly">${permLabel(p)}</span>
                            <span class="scope-technical">${scope}</span>
                            ${isLocked && html`<span class="scope-lock" title=${t('profile.agents.scopeUi.alwaysOn')}>🔒</span>`}
                            ${isExtra && html`<span class="scope-extra-note">${t('profile.agents.scopeUi.notInFullAccess')}</span>`}
                          </label>
                        </div>`;
                    })}
                  </div>`;
              })}
            </div>
          `}

          <div class="form-actions mt-1">
            <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
              ${saving ? t('profile.agents.scopeUi.saving') : t('profile.agents.scopeUi.save')}
            </button>
            <button class="btn-outline" onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}</button>
          </div>
        `}
    <//>`;
}
