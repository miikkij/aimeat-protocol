/**
 * @file agents-directives-subtab.js
 * @description Directives sub-tab for agent detail view.
 *   Shows merged directives with source badges (system/owner/agent),
 *   editable agent-level rules, and read-only memory areas and resources.
 * @structure
 *   - AgentDirectivesSubtab (default export) -- main component
 *   - RulesList -- displays rules with source badges
 *   - EditableRules -- editable agent-level rules in edit mode
 * @version-history
 *   v1.1.0 -- 2026-05-24 -- Remove memory areas/resources (moved to Data Access); add footer note
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getDirectives, upsertDirectives, deleteDirectives } from '/js/services/agent-directives.js';

function tFallback(key, fallback) {
  const val = t(key);
  return val !== key ? val : fallback;
}

function sourceLabel(source) {
  return tFallback(`profile.agents.directives.source.${source}`, source.charAt(0).toUpperCase() + source.slice(1));
}

function sourceClass(source) {
  if (source === 'system') return 'agd-source-system';
  if (source === 'owner') return 'agd-source-owner';
  if (source === 'agent') return 'agd-source-agent';
  return 'agd-source-system';
}

function RulesList({ rules }) {
  if (!rules || rules.length === 0) {
    return html`<div class="agd-empty">${tFallback('profile.agents.directives.noRules', 'No rules defined')}</div>`;
  }
  return html`
    <div>
      ${rules.map((rule, i) => html`
        <div class="agd-rule-item" key=${i}>
          <span class="agd-rule-source ${sourceClass(rule.source || 'system')}">${sourceLabel(rule.source || 'system')}</span>
          <span class="agd-rule-text">${rule.text || rule.rule || rule}</span>
        </div>
      `)}
    </div>
  `;
}

function EditableRules({ rules, onChange }) {
  function handleChange(index, value) {
    const updated = [...rules];
    updated[index] = value;
    onChange(updated);
  }

  function handleRemove(index) {
    const updated = rules.filter((_, i) => i !== index);
    onChange(updated);
  }

  function handleAdd() {
    onChange([...rules, '']);
  }

  return html`
    <div>
      ${rules.map((rule, i) => html`
        <div class="agd-rule-edit-row" key=${i}>
          <input type="text" value=${rule} onInput=${(e) => handleChange(i, e.target.value)}
                 placeholder=${tFallback('profile.agents.directives.rulePlaceholder', 'Enter a rule or guideline...')} />
          <button class="agd-remove-btn" onClick=${() => handleRemove(i)} title=${tFallback('profile.agents.directives.removeRule', 'Remove')}>
            ×
          </button>
        </div>
      `)}
      <button class="agd-add-btn" onClick=${handleAdd}>
        + ${tFallback('profile.agents.directives.addRule', 'Add rule')}
      </button>
    </div>
  `;
}

export default function AgentDirectivesSubtab({ agentName, session, showToast }) {
  const [directives, setDirectives] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editPurpose, setEditPurpose] = useState('');
  const [editRules, setEditRules] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function loadDirectives() {
    try {
      const resp = await getDirectives(agentName);
      setDirectives(resp?.data || null);
      setError(null);
    } catch (err) {
      // 404 means no directives set yet -- that is fine
      if (err.status === 404) {
        setDirectives({ purpose: '', rules: [], memory_areas: [], resources: [] });
        setError(null);
      } else {
        setError(err.message);
        setDirectives(null);
      }
    }
  }

  useEffect(() => {
    loadDirectives();
  }, [agentName]);

  // Live update listener
  const loadRef = useRef(loadDirectives);
  loadRef.current = loadDirectives;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  function startEditing() {
    // Extract agent-level rules for editing
    const agentRules = (directives?.rules || [])
      .filter(r => (r.source || 'agent') === 'agent')
      .map(r => r.text || r.rule || r);
    setEditPurpose(directives?.agent_purpose || directives?.purpose || '');
    setEditRules(agentRules.length > 0 ? agentRules : ['']);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditPurpose('');
    setEditRules([]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const cleanRules = editRules.filter(r => r.trim());
      await upsertDirectives(agentName, {
        purpose: editPurpose.trim() || undefined,
        rules: cleanRules.length > 0 ? cleanRules : undefined,
      });
      showToast(tFallback('profile.agents.directives.saved', 'Directives saved'));
      setEditing(false);
      await loadDirectives();
    } catch (err) {
      showToast(err.message || tFallback('profile.agents.directives.saveError', 'Failed to save'), true);
    }
    setSaving(false);
  }

  async function handleReset() {
    setSaving(true);
    try {
      await deleteDirectives(agentName);
      showToast(tFallback('profile.agents.directives.reset', 'Directives reset to defaults'));
      setEditing(false);
      await loadDirectives();
    } catch (err) {
      showToast(err.message || tFallback('profile.agents.directives.resetError', 'Failed to reset'), true);
    }
    setSaving(false);
  }

  if (directives === null && !error) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  if (error) {
    return html`<div class="agd-empty">${error}</div>`;
  }

  const purpose = directives?.purpose || '';
  const rules = directives?.rules || [];
  const memoryAreas = directives?.memory_areas || [];
  const resources = directives?.resources || [];

  // Separate rules by source for display
  const systemRules = rules.filter(r => r.source === 'system');
  const ownerRules = rules.filter(r => r.source === 'owner');
  const agentRules = rules.filter(r => r.source === 'agent' || (!r.source && typeof r === 'string'));

  return html`
    <div>
      ${!editing ? html`
        <!-- View mode -->
        <div class="agd-section-header">
          <span class="agd-section-title">${tFallback('profile.agents.directives.title', 'Directives')}</span>
          <div>
            <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); startEditing(); }}>
              ${tFallback('profile.agents.directives.edit', 'Edit')}
            </button>
          </div>
        </div>

        ${purpose && html`
          <div class="agd-directive-section">
            <h4>${tFallback('profile.agents.directives.purpose', 'Purpose')}</h4>
            <div class="agd-purpose-text">${purpose}</div>
          </div>
        `}

        <div class="agd-directive-section">
          <h4>${tFallback('profile.agents.directives.rules', 'Rules')}</h4>
          ${rules.length > 0 ? html`<${RulesList} rules=${rules} />` : html`
            <div class="agd-empty">${tFallback('profile.agents.directives.noRules', 'No rules defined')}</div>
          `}
        </div>

        <div class="agd-directive-footer">
          ${t('profile.agents.detail.directives.footer')}
        </div>

        ${!purpose && rules.length === 0 && html`
          <div class="agd-empty">
            ${tFallback('profile.agents.directives.empty', 'No directives configured for this agent. Click Edit to add rules and purpose.')}
          </div>
        `}
      ` : html`
        <!-- Edit mode -->
        <div class="agd-section-header">
          <span class="agd-section-title">${tFallback('profile.agents.directives.editing', 'Editing Directives')}</span>
        </div>

        <div class="agd-directive-section">
          <h4>${tFallback('profile.agents.directives.purpose', 'Purpose')}</h4>
          <div class="agd-form-field">
            <textarea value=${editPurpose} onInput=${(e) => setEditPurpose(e.target.value)}
                      placeholder=${tFallback('profile.agents.directives.purposePlaceholder', 'What is this agent for?')}></textarea>
          </div>
        </div>

        ${systemRules.length > 0 && html`
          <div class="agd-directive-section">
            <h4>${tFallback('profile.agents.directives.systemRules', 'System Rules')} (${tFallback('profile.agents.directives.readOnly', 'read-only')})</h4>
            <${RulesList} rules=${systemRules} />
          </div>
        `}

        ${ownerRules.length > 0 && html`
          <div class="agd-directive-section">
            <h4>${tFallback('profile.agents.directives.ownerRules', 'Owner Rules')} (${tFallback('profile.agents.directives.readOnly', 'read-only')})</h4>
            <${RulesList} rules=${ownerRules} />
          </div>
        `}

        <div class="agd-directive-section">
          <h4>${tFallback('profile.agents.directives.agentRules', 'Agent Rules')}</h4>
          <${EditableRules} rules=${editRules} onChange=${setEditRules} />
        </div>

        <div class="agd-form-actions">
          <button class="btn-primary btn-sm" onClick=${(e) => { e.stopPropagation(); handleSave(); }} disabled=${saving}>
            ${saving ? tFallback('profile.agents.directives.saving', 'Saving...') : tFallback('profile.agents.directives.save', 'Save')}
          </button>
          <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); cancelEditing(); }}>
            ${t('profile.agents.scopeUi.cancel')}
          </button>
          <button class="btn-danger btn-sm" onClick=${(e) => { e.stopPropagation(); handleReset(); }} disabled=${saving}>
            ${tFallback('profile.agents.directives.resetDefaults', 'Reset to Defaults')}
          </button>
        </div>
      `}
    </div>
  `;
}
