/**
 * @file tab-directives.js
 * @description Directives tab -- structured text editor for behavioral instructions.
 *   View mode shows formatted text; edit mode uses a single textarea.
 *   Memory areas, knowledge packages, and config files live in their own tabs.
 * @version-history
 *   v2.0.0 -- 2026-05-24 -- C5: rewrite as full structured text editor; M6: no SSE listener (owner-initiated only)
 *   v2.1.0 -- 2026-05-31 -- Fix: behavioral directives were sent as `content` (a
 *     field the API/storage doesn't have) so they silently vanished on save.
 *     Now stored as the agent-level `rules` and reconstructed from agent-source
 *     rules on load; relies on the PUT merge so memory_areas/resources survive.
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { getDirectives, upsertDirectives } from '/js/services/agent-directives.js';

const html = htm.bind(h);

/**
 * Extract the AGENT-level behavioral directives text from the merged rules
 * array returned by GET. The merged list also contains system/owner rules
 * (each tagged with `source`); the editor only owns the `agent` ones, which we
 * store as a single freeform blob. Falls back to any untagged rule so older
 * records still render.
 */
function agentDirectivesToText(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return '';
  return rules
    .filter(r => r && (r.source === 'agent' || r.source === undefined))
    .map(r => (typeof r === 'string' ? r : (r.description || r.text || r.rule || '')))
    .filter(Boolean)
    .join('\n');
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
      // Behavioral directives are stored as the agent-level rules; reconstruct
      // the freeform text from them (data.content kept as a defensive fallback).
      setContent(data.content || agentDirectivesToText(data.rules));
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
      // Store the freeform behavioral directives as the agent-level rules (the
      // server merges, so this does NOT touch memory_areas/resources set in
      // other tabs). The agent receives `rules` as its behavioral constraints.
      const trimmed = editContent.trim();
      const payload = {
        purpose: editPurpose.trim(),
        rules: trimmed ? [{ id: 'behavioral', description: trimmed }] : [],
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
