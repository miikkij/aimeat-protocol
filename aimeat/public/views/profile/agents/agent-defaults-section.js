/**
 * @file views/profile/agents/agent-defaults-section.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent Defaults section — owner-level default rules and token
 *   budget for agents. Mounted at the foot of the Your agents page.
 * @version-history
 *   2026-09-22 -- Composed from the shared parts (Section, ListRow, KeyValue, Field, Action, Surface,
 *     Text) instead of the card, memory-row and form classes; the pencil glyph after the budget goes.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.1.0 — 2026-09-05 — Moved from access-tab/agent-defaults.js to the agents' own folder and
 *     mounted on the Your agents page: the rules are about the agents, not about who holds a key.
 *     Self-loads now (no composite slice to seed from). Nothing else changed.
 *   v1.0.0 — 2026-07-13 — Extracted from access-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { getOwnerDefaults, upsertOwnerDefaults } from '/js/services/agent-directives.js';
import { swallowed } from '/js/swallowed.js';
import { num } from '/js/format.js';
import { Section, Stack, Columns, ListRow, KeyValue, Field, Action, Surface, Text } from '/components/poster-parts.js';

export function AgentDefaultsSection({ showToast, initial }) {
  const [defaults, setDefaults] = useState(initial?.defaults ?? null);   // seeded from /v1/access/overview; else self-loads
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editRules, setEditRules] = useState([]);
  const [editBudget, setEditBudget] = useState('');
  const [newRule, setNewRule] = useState('');

  const loadDefaults = useCallback(async () => {
    try {
      const resp = await getOwnerDefaults();
      setDefaults(resp?.data?.defaults || null);
    } catch (err) {
      swallowed('agent-defaults: AgentDefaultsSection', err);
      setDefaults(null);
    }
  }, []);

  useEffect(() => { if (!initial) loadDefaults(); }, [loadDefaults]);   // eslint-disable-line react-hooks/exhaustive-deps -- seed once from `initial`; fetch only when unseeded

  // Live update listener
  const liveRef = useRef(loadDefaults);
  liveRef.current = loadDefaults;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const startEdit = useCallback(() => {
    const rules = defaults?.rules || [];
    const budget = defaults?.default_token_budget;
    setEditRules([...rules]);
    setEditBudget(budget != null ? String(budget) : '');
    setNewRule('');
    setEditing(true);
  }, [defaults]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const budgetVal = editBudget.trim() ? parseInt(editBudget, 10) : undefined;
      if (editBudget.trim() && (isNaN(budgetVal) || budgetVal < 0)) {
        showToast(t('profile.access.adInvalidBudget') || 'Token budget must be a non-negative number');
        setSaving(false);
        return;
      }
      await upsertOwnerDefaults({
        rules: editRules,
        default_token_budget: budgetVal,
        default_memory_areas: defaults?.default_memory_areas || [],
      });
      showToast(t('profile.access.adSaved') || 'Agent defaults saved');
      setEditing(false);
      loadDefaults();
    } catch (e) {
      showToast(e.message || (t('profile.access.adSaveError') || 'Failed to save defaults'));
    } finally {
      setSaving(false);
    }
  }, [editRules, editBudget, defaults, showToast, loadDefaults]);

  const addRule = useCallback(() => {
    if (!newRule.trim()) return;
    setEditRules(prev => [...prev, newRule.trim()]);
    setNewRule('');
  }, [newRule]);

  const removeRule = useCallback((idx) => {
    setEditRules(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const rules = defaults?.rules || [];
  const budget = defaults?.default_token_budget;

  return html`
    <${Section} title=${t('profile.access.adTitle') || 'Agent Defaults'}
      description=${t('profile.access.adDesc') || 'Owner-level defaults that apply to all your agents unless overridden by per-agent directives.'}
      actions=${!editing && html`<${Action} onClick=${startEdit}>${t('profile.access.adEdit') || 'Edit'}<//>`}>
      ${!editing ? html`
        <${Stack} density="compact">
          <${Text} kind="label">${t('profile.access.adRules') || 'Default Rules'}<//>
          ${rules.length === 0
            ? html`<${Text} tone="muted">${t('profile.access.adNoRules') || 'No default rules set.'} ${t('profile.access.adRuleExample') || 'Example: "Always answer in Finnish" or "Never spend morsels without asking".'}<//>`
              : rules.map((rule, i) => html`<${ListRow} key=${i} density="compact" name=${escHtml(rule)} />`)
          }
          <${KeyValue} label=${t('profile.access.adTokenBudget') || 'Token Budget'}
            value=${html`<${Action} kind="text" title=${t('profile.access.adEdit') || 'Edit'} onClick=${startEdit}>
              ${budget != null ? num(budget) : (t('profile.access.adUnlimited') || 'Unlimited')}
            <//>`} />
        <//>
      ` : html`
        <${Surface} kind="box">
          <${Stack}>
            <${Text} kind="label">${t('profile.access.adEditTitle') || 'Edit Agent Defaults'}<//>
            <${Stack} density="compact">
              <${Text} kind="label">${t('profile.access.adRules') || 'Rules'}<//>
              ${editRules.map((rule, i) => html`
                <${ListRow} key=${i} density="compact" name=${escHtml(rule)}
                  actions=${html`<${Action} kind="text" onClick=${() => removeRule(i)}>${t('profile.access.adRemoveRule') || 'Remove'}<//>`} />
              `)}
              <${Columns} layout="leading" density="compact" collapse="560">
                <${Field} placeholder=${t('profile.access.adRulePlaceholder') || 'Add a rule...'}
                  value=${newRule} onInput=${e => setNewRule(e.target.value)}
                  onKeyDown=${e => e.key === 'Enter' && addRule()} />
                <${Stack} direction="horizontal" density="compact">
                  <${Action} onClick=${addRule}>${t('profile.access.adAddRule') || 'Add'}<//>
                <//>
              <//>
            <//>
            <${Field} type="number" min="0" label=${t('profile.access.adTokenBudget') || 'Token Budget'}
              placeholder=${t('profile.access.adBudgetPlaceholder') || 'Leave empty for unlimited'}
              value=${editBudget} onInput=${e => setEditBudget(e.target.value)} />
            <${Stack} direction="horizontal" density="compact">
              <${Action} kind="primary" onClick=${handleSave} disabled=${saving}>
                ${saving ? '...' : (t('profile.access.adSave') || 'Save')}
              <//>
              <${Action} kind="text" onClick=${() => setEditing(false)}>${t('profile.access.adCancel') || 'Cancel'}<//>
            <//>
          <//>
        <//>
      `}
    <//>
  `;
}
