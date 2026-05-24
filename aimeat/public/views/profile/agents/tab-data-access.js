/**
 * @file tab-data-access.js
 * @description Data Access tab: shared tags, memory areas, knowledge packages,
 *   and effective scope summary.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPatch } from '/js/api.js';
import { getDirectives } from '/js/services/agent-directives.js';

const html = htm.bind(h);

export default function TabDataAccess({ agent, agentName, session, showToast, allAgents }) {
  const [tags, setTags] = useState(agent.tags ?? []);
  const [memoryAreas, setMemoryAreas] = useState([]);
  const [resources, setResources] = useState([]);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    try {
      const resp = await getDirectives(agentName);
      const data = resp?.data || {};
      setMemoryAreas(data.memory_areas || []);
      setResources(data.resources || []);
    } catch {
      setMemoryAreas([]);
      setResources([]);
    }
    setTags(agent.tags ?? []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [agentName]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function handleAddTag() {
    const tag = newTag.trim().toLowerCase();
    if (!tag || tags.includes(tag)) return;
    try {
      const updated = [...tags, tag];
      await apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/tags`, { tags: updated });
      setTags(updated);
      setNewTag('');
      setAddingTag(false);
      showToast(t('agents.detail.dataAccess.tagAdded'));
    } catch (err) {
      showToast(err.message || t('agents.detail.dataAccess.addTagError'), true);
    }
  }

  async function handleRemoveTag(tag) {
    try {
      const updated = tags.filter(t => t !== tag);
      await apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/tags`, { tags: updated });
      setTags(updated);
      showToast(t('agents.detail.dataAccess.tagRemoved'));
    } catch (err) {
      showToast(err.message || t('agents.detail.dataAccess.removeTagError'), true);
    }
  }

  function getSharedWith(tag) {
    if (!allAgents) return [];
    return allAgents.filter(a => a.name !== agentName && (a.tags ?? []).includes(tag));
  }

  if (loading) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  const hasTags = tags.length > 0;
  const hasAreas = memoryAreas.length > 0;
  const hasResources = resources.length > 0;

  if (!hasTags && !hasAreas && !hasResources && !addingTag) {
    return html`
      <div>
        <div class="agd-empty">${t('agents.detail.empty.dataAccess')}</div>
        <div class="agd-form-actions">
          <button class="btn-outline btn-sm" onClick=${() => setAddingTag(true)}>+ ${t('agents.detail.dataAccess.addTag')}</button>
        </div>
      </div>
    `;
  }

  return html`
    <div>
      <!-- SHARED TAGS -->
      <div class="pf-agd-data-section">
        <div class="agd-section-header">
          <span class="agd-section-title">${t('agents.detail.dataAccess.sharedTagsTitle')}</span>
          <button class="btn-outline btn-sm" onClick=${() => setAddingTag(!addingTag)}>+ ${t('agents.detail.dataAccess.addTag')}</button>
        </div>
        ${addingTag && html`
          <div class="agd-form-field pf-agd-tag-input-row">
            <input type="text" value=${newTag} onInput=${(e) => setNewTag(e.target.value)}
                   placeholder=${t('agents.detail.dataAccess.tagPlaceholder')}
                   onKeyDown=${(e) => e.key === 'Enter' && handleAddTag()} />
            <button class="btn-primary btn-sm" onClick=${handleAddTag}>${t('agents.detail.commands.send')}</button>
          </div>
        `}
        ${tags.map(tag => {
          const shared = getSharedWith(tag);
          return html`
            <div key=${tag} class="pf-agd-tag-row">
              <span class="pf-agd-tag-name">[${tag}]</span>
              <span class="pf-agd-tag-prefix">agents.tag.${tag}.*</span>
              <span class="pf-agd-tag-sharing">
                ${shared.length > 0
                  ? `${t('agents.detail.dataAccess.with')}: ${shared.map(a => a.name).join(', ')}`
                  : t('agents.detail.dataAccess.onlyYou')}
              </span>
              <button class="agd-remove-btn" onClick=${() => handleRemoveTag(tag)}>x</button>
            </div>
          `;
        })}
        ${tags.length === 0 && !addingTag && html`
          <div class="agd-empty">${t('agents.detail.dataAccess.noTags')}</div>
        `}
      </div>

      <!-- MEMORY AREAS -->
      ${hasAreas && html`
        <div class="pf-agd-data-section">
          <div class="agd-section-header">
            <span class="agd-section-title">${t('agents.detail.dataAccess.memoryAreasTitle')}</span>
          </div>
          ${memoryAreas.map(area => html`
            <div key=${area.key || area} class="pf-agd-area-row">
              <span class="pf-agd-area-key">${area.key || area}</span>
              <span class="pf-agd-area-desc">${area.description || ''}</span>
              <span class="pf-agd-area-perm ${area.access === 'read' ? 'pf-agd-area-perm--ro' : 'pf-agd-area-perm--rw'}">
                ${area.access || 'read+write'}
              </span>
            </div>
          `)}
        </div>
      `}

      <!-- KNOWLEDGE PACKAGES -->
      ${hasResources && html`
        <div class="pf-agd-data-section">
          <div class="agd-section-header">
            <span class="agd-section-title">${t('agents.detail.dataAccess.knowledgeTitle')}</span>
          </div>
          ${resources.map(res => html`
            <div key=${res.url || res.name || res} class="pf-agd-area-row">
              <span class="pf-agd-area-key">${res.name || res.url || res}</span>
              <span class="pf-agd-area-desc">${res.description || ''}</span>
            </div>
          `)}
        </div>
      `}

      <!-- EFFECTIVE SCOPE SUMMARY -->
      <div class="pf-agd-scope-summary">
        ${t('agents.detail.dataAccess.effectiveScope')}:\n${
          [...memoryAreas.map(a => a.key || a), ...tags.map(tag => `agents.tag.${tag}.*`), 'agents.shared.index'].join(', ')
        }${hasResources ? `\n${t('agents.detail.dataAccess.knowledgeTitle')}: ${resources.map(r => r.name || r.url || r).join(', ')}` : ''}
      </div>
    </div>
  `;
}
