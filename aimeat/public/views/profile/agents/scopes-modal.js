/**
 * @file public/views/profile/agents/scopes-modal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Scope-management modal for an agent: template presets + advanced per-domain
 *   permission checkboxes, read-only view for non-owners. Extracted from ../agents-tab.js
 *   to satisfy max-file-lines.
 * @version-history
 *   v1.15.0 — 2026-09-26 — Every part is a component that takes data (page group G1a): the dialog's
 *     width is its md size (the page's 620px override goes), the address is Code with the envelope as
 *     the Icon link to the inbox thread, the presets are Tabs, "Advanced" a fold Tab, each area a
 *     part under the heavy rule (Split heavy) with its row label and the "All" Filter that ticks the area, its permissions the
 *     List's pick rows (the one always on cannot be unticked: pickOff), the notes Note.
 *   v1.14.0 — 2026-09-26 — A permission beside its check box is the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.13.0 — 2026-09-26 — The scope dialog's permission groups stand under the section rule (.poster-row--thing) instead of their own 3px ink border (a unification: the look most tabs use).
 *   v1.12.0 — 2026-09-26 — A scope group's all switch is the Tab's filter tone (.poster-tab--filter, is-on while every permission of the group is ticked); .domain-toggle's rules go (a unification: Jouni's decision Tabs and filters).
 *   v1.11.0 — 2026-09-26 — The agent's GAII and a permission's technical name are the inline code (.code-inline); their own typewriter looks go (a unification: the look most tabs use).
 *   v1.10.0 — 2026-09-26 — A permission's always-on and not-in-full-access marks are the Tag (.poster-chip, coral for the one to act on); their own rules go (a unification: Jouni's decision Tag).
 *   v1.9.0 — 2026-09-26 — A control that opens a panel below it is the Tab's fold tone (.poster-tab--fold, is-on while open), and the parameters section that is one row until opened is the FoldSection; their own toggles, carets and arrows go (a unification: Jouni's decision Tabs and filters, and the look most tabs use).
 *   v1.8.0 — 2026-09-26 — The classic AI settings' why-lines are the lead and the Hint, and the scope dialog's reconnect note is the Hint under the section rule; their own looks go (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — The last labels over a field or a group wear .poster-label: the classic AI settings, the presence dialog, the scope groups, the ecosystem's trigger and sample, the scheduler's edit form, P&L's fields, the task runner's name; a place keeps its layout (Jouni's decision "Row label", a unification).
 *   v1.6.0 — 2026-09-25 — The model's page link (↗) and the agent's mail link are the small icon button (.poster-icon--small); their look goes, the mail icon keeps its drawing size (Jouni's decision "Icon button", a unification).
 *   v1.4.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
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
 *   v1.4.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { inboxLinkHref } from '/components/InboxLink.js';
import { Modal } from '/components/Modal.js';
import {
  SCOPE_DOMAINS, SCOPE_TEMPLATES, NOT_IN_WILDCARD,
  wildcardScopes, bulkScopes, expandScopes, collapseScopes, detectTemplate, unknownScopes,
  templateLabel, domainLabel, permLabel,
} from './scope-config.js';
import { Note } from '/components/Note.js';
import { Action, Icon, Loud } from '/components/Action.js';
import { Code, Label, Mark, Marks } from '/components/Mark.js';
import { Tabs, Tab } from '/components/Tabs.js';
import { List, Row as ListRow, Name, Cell, Filter } from '/components/List.js';
import { Row, Space, Split } from '/components/Layout.js';

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

  return html`
    <${Modal} open=${true} onClose=${onCancel} size="md" title=${`${t('profile.agents.scopeUi.scopeProfile')}: ${agent.display_name || agent.name}`}
      footer=${isReadOnly ? html`
        <${Action} onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}<//>` : html`
        <${Action} onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}<//>
        <${Loud} control onClick=${handleSave} disabled=${saving}>
          ${saving ? t('profile.agents.scopeUi.saving') : t('profile.agents.scopeUi.save')}
        <//>`}>
        <${Row} gap="medium" below="large">
          <${Code}>${escHtml(agent.gaii || '')}<//>
          ${agent.gaii ? html`<${Icon} small href=${inboxLinkHref(agent.gaii)} label=${t('inbox.messageThis')}>${MAIL_ICON}<//>` : null}
        <//>

        ${isReadOnly ? html`
          <${Note}>${t('profile.agents.scopeUi.readOnlyView')}<//>
          <${Marks}>
            ${scopes.map(s => html`<${Mark} key=${s}>${escHtml(s)}<//>`)}
          <//>
        ` : html`
          <${Space} below="large">
            <${Tabs} label=${t('profile.agents.scopeUi.scopeProfile')} value=${currentTemplate} onSelect=${applyTemplate}
              items=${['readonly', 'standard', 'full'].map(tpl => ({ value: tpl, key: tpl, label: templateLabel(tpl) }))} />
          <//>

          <${Space} below="large">
            <${Tab} tone="fold" on=${advanced} pressed=${advanced} onClick=${() => setAdvanced(!advanced)}>
              ${t('profile.agents.scopeUi.advanced')}
            <//>
          <//>

          ${advanced && html`
            ${SCOPE_DOMAINS.map(d => {
              const allChecked = bulkScopes(d).every(s => checked.has(s));
              const isCatalogue = d.key === 'catalogue';
              return html`
                <${Split} heavy key=${d.key}>
                  <${Row} gap="small" justify="between" below="tight">
                    <${Label}>${domainLabel(d.key)}<//>
                    ${!isCatalogue && html`<${Filter} on=${allChecked} onClick=${() => toggleDomain(d.key)}>${allChecked ? '✓ ' : ''}${t('profile.agents.scopeUi.all')}<//>`}
                  <//>
                  <${List} cols="check-name-desc" keepCols dense>
                    ${d.permissions.map(p => {
                      const scope = `${d.key}:${p}`;
                      const isLocked = isCatalogue && p === 'read';
                      const isExtra = NOT_IN_WILDCARD.includes(scope);
                      return html`
                        <${ListRow} key=${scope} picked=${checked.has(scope) || isLocked} pickOff=${isLocked}
                          pickLabel=${permLabel(p, d.key)} onPick=${() => !isLocked && toggleScope(scope)}>
                          <${Name}>${permLabel(p, d.key)}<//>
                          <${Cell} line>
                            <${Code}>${scope}<//>
                            ${isLocked && html`<${Mark}>${t('profile.agents.scopeUi.alwaysOn')}<//>`}
                            ${isExtra && html`<${Mark} tone="coral">${t('profile.agents.scopeUi.notInFullAccess')}<//>`}
                          <//>
                        <//>`;
                    })}
                  <//>
                <//>`;
            })}

            ${unknown.length > 0 && html`
              <${Split} heavy>
                <${Label} block>${t('profile.agents.scopeUi.domainOther')}<//>
                <${Note}>${t('profile.agents.scopeUi.otherScopesHint')}<//>
                <${List} cols="check-name-desc" keepCols dense>
                  ${unknown.map(scope => html`
                    <${ListRow} key=${scope} picked=${checked.has(scope)} pickLabel=${scope} onPick=${() => toggleScope(scope)}>
                      <${Name} code>${escHtml(scope)}<//>
                      <${Cell} />
                    <//>`)}
                <//>
              <//>
            `}
          `}

          <${Split} heavy above="large">
            <${Note}>${t('profile.agents.scopeUi.reconnectNote')}<//>
          <//>
        `}
    <//>`;
}
