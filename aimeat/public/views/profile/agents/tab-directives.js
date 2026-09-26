/**
 * @file tab-directives.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Directives tab -- structured text editor for behavioral instructions.
 *   View mode shows formatted text; edit mode uses a single textarea.
 *   Memory areas, knowledge packages, and config files live in their own tabs.
 * @version-history
 *   v2.12.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v2.11.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.10.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v2.9.0 -- 2026-09-26 -- An agent's purpose under its label is the Facts' value, its directives the thing row as it is (a unification: the look most tabs use).
 *   v2.8.0 -- 2026-09-25 -- A field's or a directive's label is the Row label (.poster-label), a unification: Jouni's decision Row label.
 *   v2.7.0 -- 2026-09-25 -- A grey line that explains is the Hint (poster-hint, css/components/hint.css); a place keeps only its margin (a unification: the look most tabs use).
 *   v2.6.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v2.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v2.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v2.2.0 -- 2026-07-17 -- Tab content wrapped in a single pf-agd-card.
 *   v2.0.0 -- 2026-05-24 -- C5: rewrite as full structured text editor; M6: no SSE listener (owner-initiated only)
 *   v2.1.0 -- 2026-05-31 -- Fix: behavioral directives were sent as `content` (a
 *     field the API/storage doesn't have) so they silently vanished on save.
 *     Now stored as the agent-level `rules` and reconstructed from agent-source
 *     rules on load; relies on the PUT merge so memory_areas/resources survive.
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
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

export default function TabDirectives({ agentName, showToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [purpose, setPurpose] = useState('');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [editPurpose, setEditPurpose] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
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
  }, [agentName]);

  useEffect(() => { loadData(); }, [loadData]);

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
    return html`<div class="poster-quiet pf-agd-empty loading-mark">${t('profile.loading')}</div>`;
  }

  if (error) {
    return html`<div class="poster-quiet pf-agd-empty">${error}</div>`;
  }

  const hasContent = purpose || content;

  return html`
    <div class="pf-agd-card poster-row--thing">
      ${!editing ? html`
        <!-- View mode -->
        <div class="pf-agd-section-header">
          <span class="pf-agd-section-title sub-heading">${t('profile.agents.directives.title')}</span>
          <div>
            <button class="poster-action poster-action--small" onClick=${(e) => { e.stopPropagation(); startEditing(); }}>
              ${t('profile.agents.directives.edit')}
            </button>
          </div>
        </div>

        ${purpose && html`
          <div class="pf-agd-directive-section">
            <h4 class="poster-label">${t('profile.agents.directives.purpose')}</h4>
            <div class="facts-v pf-agd-purpose-text">${purpose}</div>
          </div>
        `}

        ${content ? html`
          <div class="pf-agd-directive-section">
            <div class="pf-agd-directives-content poster-row--thing">${content}</div>
          </div>
        ` : ''}

        ${!hasContent && html`
          <div class="poster-quiet pf-agd-empty">
            ${t('profile.agents.directives.empty')}
          </div>
        `}

        <div class="poster-hint pf-agd-directive-footer">
          ${t('profile.agents.detail.directives.footer')}
        </div>
      ` : html`
        <!-- Edit mode -->
        <div class="pf-agd-section-header">
          <span class="pf-agd-section-title sub-heading">${t('profile.agents.directives.editing')}</span>
        </div>

        <div class="pf-agd-directive-section">
          <h4 class="poster-label">${t('profile.agents.directives.purpose')}</h4>
          <div class="pf-agd-form-field">
            <textarea class="og-textarea" value=${editPurpose} onInput=${(e) => setEditPurpose(e.target.value)}
                      placeholder=${t('profile.agents.directives.purposePlaceholder')}></textarea>
          </div>
        </div>

        <div class="pf-agd-directive-section">
          <h4 class="poster-label">${t('profile.agents.detail.directives.contentLabel')}</h4>
          <textarea class="og-textarea pf-agd-directives-textarea"
                    value=${editContent}
                    onInput=${(e) => setEditContent(e.target.value)}
                    placeholder=${t('profile.agents.detail.directives.contentPlaceholder')}></textarea>
        </div>

        <div class="pf-agd-form-actions">
          <button class="poster-slab poster-slab--control" onClick=${(e) => { e.stopPropagation(); handleSave(); }} disabled=${saving}>
            ${saving ? t('profile.agents.directives.saving') : t('profile.agents.directives.save')}
          </button>
          <button class="poster-action poster-action--small" onClick=${(e) => { e.stopPropagation(); cancelEditing(); }}>
            ${t('profile.agents.scopeUi.cancel')}
          </button>
        </div>

        <div class="poster-hint pf-agd-directive-footer">
          ${t('profile.agents.detail.directives.footer')}
        </div>
      `}
    </div>
  `;
}
