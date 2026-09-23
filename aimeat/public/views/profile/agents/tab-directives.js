/**
 * @file tab-directives.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Directives tab -- structured text editor for behavioral instructions.
 *   View mode shows formatted text; edit mode uses a single textarea.
 *   Memory areas, knowledge packages, and config files live in their own tabs.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: one small Section with Edit in its
 *     actions, the purpose as a label over body text, the directives in a code Surface (it keeps
 *     their line breaks), the editor two Fields with Save as the one primary action. No class of its
 *     own is left. Same words, data and handlers.
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
import { Section, Stack, Field, Action, Surface, Text } from '/components/poster-parts.js';

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
    return html`<${Text} tone="muted">${t('profile.loading')}<//>`;
  }

  if (error) {
    return html`<${Text} tone="muted">${error}<//>`;
  }

  const hasContent = purpose || content;
  const footer = html`<${Text} kind="caption" tone="muted">${t('profile.agents.detail.directives.footer')}<//>`;

  if (!editing) {
    return html`
      <${Section} size="small" density="compact" title=${t('profile.agents.directives.title')}
        actions=${html`<${Action} onClick=${(e) => { e.stopPropagation(); startEditing(); }}>
          ${t('profile.agents.directives.edit')}
        <//>`}>
        <${Stack} density="compact">
          ${purpose && html`
            <${Stack} density="compact">
              <${Text} kind="label">${t('profile.agents.directives.purpose')}<//>
              <${Text}>${purpose}<//>
            <//>
          `}

          ${content ? html`<${Surface} kind="code">${content}<//>` : ''}

          ${!hasContent && html`<${Text} tone="muted">${t('profile.agents.directives.empty')}<//>`}

          ${footer}
        <//>
      <//>
    `;
  }

  return html`
    <${Section} size="small" density="compact" title=${t('profile.agents.directives.editing')}>
      <${Stack} density="compact">
        <${Field} type="textarea" rows=${3} label=${t('profile.agents.directives.purpose')}
          value=${editPurpose} onInput=${(e) => setEditPurpose(e.target.value)}
          placeholder=${t('profile.agents.directives.purposePlaceholder')} />

        <${Field} type="textarea" rows=${10} label=${t('profile.agents.detail.directives.contentLabel')}
          value=${editContent} onInput=${(e) => setEditContent(e.target.value)}
          placeholder=${t('profile.agents.detail.directives.contentPlaceholder')} />

        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" onClick=${(e) => { e.stopPropagation(); handleSave(); }} disabled=${saving}>
            ${saving ? t('profile.agents.directives.saving') : t('profile.agents.directives.save')}
          <//>
          <${Action} onClick=${(e) => { e.stopPropagation(); cancelEditing(); }}>
            ${t('profile.agents.scopeUi.cancel')}
          <//>
        <//>

        ${footer}
      <//>
    <//>
  `;
}
