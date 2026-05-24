/**
 * @file tab-directives.js
 * @description Directives tab -- structured text editor for behavioral instructions.
 *   View mode shows formatted text; edit mode uses a single textarea.
 *   Memory areas, knowledge packages, and config files live in their own tabs.
 * @version-history
 *   v2.0.0 -- 2026-05-24 -- C5: rewrite as full structured text editor; M6: no SSE listener (owner-initiated only)
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { getDirectives, upsertDirectives } from '/js/services/agent-directives.js';

const html = htm.bind(h);

/**
 * Convert legacy rules array to plain text for display/editing.
 */
function rulesToText(rules) {
  if (!rules || rules.length === 0) return '';
  return rules.map(r => {
    if (typeof r === 'string') return r;
    return r.text || r.rule || '';
  }).filter(Boolean).join('\n');
}

export default function TabDirectives({ agentName, session, showToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [purpose, setPurpose] = useState('');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [editPurpose, setEditPurpose] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const resp = await getDirectives(agentName);
      const data = resp?.data || {};
      setPurpose(data.purpose || data.agent_purpose || '');
      // Support both new content format and legacy rules array
      if (data.content) {
        setContent(data.content);
      } else {
        setContent(rulesToText(data.rules));
      }
      setError(null);
    } catch (err) {
      if (err.status === 404) {
        setPurpose('');
        setContent('');
        setError(null);
      } else {
        setError(err.message);
      }
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [agentName]);

  // M6: No SSE listener -- directives are owner-initiated only

  function startEditing() {
    setEditPurpose(purpose);
    setEditContent(content);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        content: editContent.trim() || undefined,
        purpose: editPurpose.trim() || undefined,
      };
      await upsertDirectives(agentName, payload);
      showToast(t('profile.agents.directives.saved'));
      setEditing(false);
      await loadData();
    } catch (err) {
      showToast(err.message || t('profile.agents.directives.saveError'), true);
    }
    setSaving(false);
  }

  if (loading) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  if (error) {
    return html`<div class="pf-agd-empty">${error}</div>`;
  }

  const hasContent = purpose || content;

  return html`
    <div>
      ${!editing ? html`
        <!-- View mode -->
        <div class="pf-agd-section-header">
          <span class="pf-agd-section-title">${t('profile.agents.directives.title')}</span>
          <div>
            <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); startEditing(); }}>
              ${t('profile.agents.directives.edit')}
            </button>
          </div>
        </div>

        ${purpose && html`
          <div class="pf-agd-directive-section">
            <h4>${t('profile.agents.directives.purpose')}</h4>
            <div class="pf-agd-purpose-text">${purpose}</div>
          </div>
        `}

        ${content ? html`
          <div class="pf-agd-directive-section">
            <div class="pf-agd-directives-content">${content}</div>
          </div>
        ` : ''}

        ${!hasContent && html`
          <div class="pf-agd-empty">
            ${t('profile.agents.directives.empty')}
          </div>
        `}

        <div class="pf-agd-directive-footer">
          ${t('profile.agents.detail.directives.footer')}
        </div>
      ` : html`
        <!-- Edit mode -->
        <div class="pf-agd-section-header">
          <span class="pf-agd-section-title">${t('profile.agents.directives.editing')}</span>
        </div>

        <div class="pf-agd-directive-section">
          <h4>${t('profile.agents.directives.purpose')}</h4>
          <div class="pf-agd-form-field">
            <textarea value=${editPurpose} onInput=${(e) => setEditPurpose(e.target.value)}
                      placeholder=${t('profile.agents.directives.purposePlaceholder')}></textarea>
          </div>
        </div>

        <div class="pf-agd-directive-section">
          <h4>${t('profile.agents.detail.directives.contentLabel')}</h4>
          <textarea class="pf-agd-directives-textarea"
                    value=${editContent}
                    onInput=${(e) => setEditContent(e.target.value)}
                    placeholder=${t('profile.agents.detail.directives.contentPlaceholder')}></textarea>
        </div>

        <div class="pf-agd-form-actions">
          <button class="btn-primary btn-sm" onClick=${(e) => { e.stopPropagation(); handleSave(); }} disabled=${saving}>
            ${saving ? t('profile.agents.directives.saving') : t('profile.agents.directives.save')}
          </button>
          <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); cancelEditing(); }}>
            ${t('profile.agents.scopeUi.cancel')}
          </button>
        </div>

        <div class="pf-agd-directive-footer">
          ${t('profile.agents.detail.directives.footer')}
        </div>
      `}
    </div>
  `;
}
