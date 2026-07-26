/**
 * @file views/profile/access-tab/agent-defaults.js
 * @description Agent Defaults section — owner-level default rules and token
 *   budget for agents. Extracted from access-tab.js to satisfy max-file-lines.
 * @version-history
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
    <h3 class="card-h3 access-h3 mt-section">${t('profile.access.adTitle') || 'Agent Defaults'}</h3>
    <div class="section-desc">${t('profile.access.adDesc') || 'Owner-level defaults that apply to all your agents unless overridden by per-agent directives.'}</div>

    ${!editing ? html`
      <div class="card">
        <div class="flex-between mb-half">
          <div class="card-title">${t('profile.access.adRules') || 'Default Rules'}</div>
          <button class="btn-outline btn-sm" onClick=${startEdit}>
            ${t('profile.access.adEdit') || 'Edit'}
          </button>
        </div>

        ${rules.length === 0
          ? html`<div class="text-meta-sm mb-half">${t('profile.access.adNoRules') || 'No default rules set.'} ${t('profile.access.adRuleExample') || 'Example: "Always answer in Finnish" or "Never spend morsels without asking".'}</div>`
          : rules.map((rule, i) => html`
              <div class="mem-item" key=${i}>
                <span class="mem-key">${escHtml(rule)}</span>
              </div>
            `)
        }

        <div class="mem-item">
          <span class="mem-key">${t('profile.access.adTokenBudget') || 'Token Budget'}</span>
          <button class="pj-linklike" title=${t('profile.access.adEdit') || 'Edit'} onClick=${startEdit}>
            ${budget != null ? budget.toLocaleString() : (t('profile.access.adUnlimited') || 'Unlimited')} ✎
          </button>
        </div>
      </div>
    ` : html`
      <div class="create-form">
        <h4 class="card-h3 mb-half">${t('profile.access.adEditTitle') || 'Edit Agent Defaults'}</h4>
        <div class="flex-col">
          <div class="form-row">
            <label>${t('profile.access.adRules') || 'Rules'}</label>
            ${editRules.map((rule, i) => html`
              <div class="mem-item" key=${i}>
                <span class="mem-key">${escHtml(rule)}</span>
                <button class="btn-ghost btn-danger btn-sm" onClick=${() => removeRule(i)}>
                  ${t('profile.access.adRemoveRule') || 'Remove'}
                </button>
              </div>
            `)}
            <div class="flex-row">
              <input type="text" class="input-field input-sm"
                placeholder=${t('profile.access.adRulePlaceholder') || 'Add a rule...'}
                value=${newRule} onInput=${e => setNewRule(e.target.value)}
                onKeyDown=${e => e.key === 'Enter' && addRule()} />
              <button class="btn-outline btn-sm" onClick=${addRule}>
                ${t('profile.access.adAddRule') || 'Add'}
              </button>
            </div>
          </div>

          <div class="form-row">
            <label>${t('profile.access.adTokenBudget') || 'Token Budget'}</label>
            <input type="number" class="input-field input-sm" min="0"
              placeholder=${t('profile.access.adBudgetPlaceholder') || 'Leave empty for unlimited'}
              value=${editBudget} onInput=${e => setEditBudget(e.target.value)} />
          </div>

          <div class="form-actions">
            <button class="btn-primary btn-sm" onClick=${handleSave} disabled=${saving}>
              ${saving ? '...' : (t('profile.access.adSave') || 'Save')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${() => setEditing(false)}>
              ${t('profile.access.adCancel') || 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    `}
  `;
}
