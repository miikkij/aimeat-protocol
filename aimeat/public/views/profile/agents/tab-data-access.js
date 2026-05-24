/**
 * @file tab-data-access.js
 * @description Data Access tab: shared tags, memory areas, knowledge packages,
 *   and effective scope summary. All sections always visible with action buttons.
 * @version-history
 *   v1.1.0 -- 2026-05-24 -- Always show all sections; add area/package action buttons; help text
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPatch } from '/js/api.js';
import { getDirectives, upsertDirectives } from '/js/services/agent-directives.js';

const html = htm.bind(h);

export default function TabDataAccess({ agent, agentName, session, showToast, allAgents }) {
  const [tags, setTags] = useState(agent.tags ?? []);
  const [memoryAreas, setMemoryAreas] = useState([]);
  const [resources, setResources] = useState([]);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingArea, setAddingArea] = useState(false);
  const [newAreaKey, setNewAreaKey] = useState('');
  const [newAreaDesc, setNewAreaDesc] = useState('');
  const [newAreaAccess, setNewAreaAccess] = useState('read+write');
  const [linkingPackage, setLinkingPackage] = useState(false);
  const [availablePackages, setAvailablePackages] = useState([]);

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
      showToast(t('profile.agents.detail.dataAccess.tagAdded'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.dataAccess.addTagError'), true);
    }
  }

  async function handleRemoveTag(tag) {
    try {
      const updated = tags.filter(t => t !== tag);
      await apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/tags`, { tags: updated });
      setTags(updated);
      showToast(t('profile.agents.detail.dataAccess.tagRemoved'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.dataAccess.removeTagError'), true);
    }
  }

  async function handleAddArea() {
    const key = newAreaKey.trim();
    if (!key) return;
    try {
      const updated = [...memoryAreas, { key, description: newAreaDesc.trim(), access: newAreaAccess }];
      await upsertDirectives(agentName, { memory_areas: updated });
      setMemoryAreas(updated);
      setNewAreaKey('');
      setNewAreaDesc('');
      setNewAreaAccess('read+write');
      setAddingArea(false);
      showToast(t('profile.agents.detail.dataAccess.areaAdded'));
    } catch (err) {
      showToast(err.message || t('profile.unknownError'), true);
    }
  }

  async function handleLinkPackage(pkg) {
    try {
      const updated = [...resources, { name: pkg.name, url: pkg.url || pkg.id, description: pkg.description || '' }];
      await upsertDirectives(agentName, { resources: updated });
      setResources(updated);
      setLinkingPackage(false);
      showToast(t('profile.agents.detail.dataAccess.packageLinked'));
    } catch (err) {
      showToast(err.message || t('profile.unknownError'), true);
    }
  }

  async function loadAvailablePackages() {
    try {
      const resp = await apiGet('/v1/knowledge/packages');
      setAvailablePackages(resp?.data?.packages || []);
    } catch { setAvailablePackages([]); }
    setLinkingPackage(true);
  }

  function getSharedWith(tag) {
    if (!allAgents) return [];
    return allAgents.filter(a => a.name !== agentName && (a.tags ?? []).includes(tag));
  }

  if (loading) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  return html`
    <div>
      <!-- SHARED TAGS -->
      <div class="pf-agd-data-section">
        <div class="agd-section-header">
          <span class="agd-section-title">${t('profile.agents.detail.dataAccess.sharedTagsTitle')}</span>
          <button class="btn-outline btn-sm" onClick=${() => setAddingTag(!addingTag)}>+ ${t('profile.agents.detail.dataAccess.addTag')}</button>
        </div>
        <div class="pf-agd-help-text">${t('profile.agents.detail.dataAccess.tagsHelp')}</div>
        ${addingTag && html`
          <div class="agd-form-field pf-agd-tag-input-row">
            <input type="text" value=${newTag} onInput=${(e) => setNewTag(e.target.value)}
                   placeholder=${t('profile.agents.detail.dataAccess.tagPlaceholder')}
                   onKeyDown=${(e) => e.key === 'Enter' && handleAddTag()} />
            <button class="btn-primary btn-sm" onClick=${handleAddTag}>${t('profile.agents.detail.commands.send')}</button>
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
                  ? `${t('profile.agents.detail.dataAccess.with')}: ${shared.map(a => a.name).join(', ')}`
                  : t('profile.agents.detail.dataAccess.onlyYou')}
              </span>
              <button class="agd-remove-btn" onClick=${() => handleRemoveTag(tag)}>x</button>
            </div>
          `;
        })}
        ${tags.length === 0 && !addingTag && html`
          <div class="agd-empty">${t('profile.agents.detail.dataAccess.noTags')}</div>
        `}
      </div>

      <!-- MEMORY AREAS (always visible) -->
      <div class="pf-agd-data-section">
        <div class="agd-section-header">
          <span class="agd-section-title">${t('profile.agents.detail.dataAccess.memoryAreasTitle')}</span>
          <button class="btn-outline btn-sm" onClick=${() => setAddingArea(!addingArea)}>+ ${t('profile.agents.detail.dataAccess.addArea')}</button>
        </div>
        ${addingArea && html`
          <div class="pf-agd-area-form">
            <input type="text" value=${newAreaKey} onInput=${(e) => setNewAreaKey(e.target.value)}
                   placeholder=${t('profile.agents.detail.dataAccess.areaKeyPlaceholder')} />
            <input type="text" value=${newAreaDesc} onInput=${(e) => setNewAreaDesc(e.target.value)}
                   placeholder=${t('profile.agents.detail.dataAccess.areaDescPlaceholder')} />
            <select value=${newAreaAccess} onChange=${(e) => setNewAreaAccess(e.target.value)}>
              <option value="read">read-only</option>
              <option value="read+write">read+write</option>
            </select>
            <button class="btn-primary btn-sm" onClick=${handleAddArea}>${t('common.save')}</button>
            <button class="btn-outline btn-sm" onClick=${() => setAddingArea(false)}>${t('common.cancel')}</button>
          </div>
        `}
        ${memoryAreas.length > 0 ? memoryAreas.map(area => html`
          <div key=${area.key || area} class="pf-agd-area-row">
            <span class="pf-agd-area-key">${area.key || area}</span>
            <span class="pf-agd-area-desc">${area.description || ''}</span>
            <span class="pf-agd-area-perm ${area.access === 'read' ? 'pf-agd-area-perm--ro' : 'pf-agd-area-perm--rw'}">
              ${area.access || 'read+write'}
            </span>
          </div>
        `) : html`
          <div class="agd-empty">${t('profile.agents.detail.dataAccess.noAreas')}</div>
        `}
      </div>

      <!-- KNOWLEDGE PACKAGES (always visible) -->
      <div class="pf-agd-data-section">
        <div class="agd-section-header">
          <span class="agd-section-title">${t('profile.agents.detail.dataAccess.knowledgeTitle')}</span>
          <button class="btn-outline btn-sm" onClick=${loadAvailablePackages}>+ ${t('profile.agents.detail.dataAccess.linkPackage')}</button>
        </div>
        ${linkingPackage && html`
          <div class="pf-agd-package-picker">
            ${availablePackages.length === 0 ? html`
              <div class="agd-empty">${t('profile.agents.detail.dataAccess.noPackagesAvailable')}</div>
            ` : availablePackages.map(pkg => html`
              <div key=${pkg.id || pkg.name} class="pf-agd-package-option" onClick=${() => handleLinkPackage(pkg)}>
                <span class="pf-agd-area-key">${pkg.name}</span>
                <span class="pf-agd-area-desc">${pkg.description || ''}</span>
                ${(pkg.documentCount || pkg.documents?.length) ? html`
                  <span class="pf-agd-package-count">${pkg.documentCount || pkg.documents?.length || 0} docs</span>
                ` : ''}
              </div>
            `)}
            <button class="btn-outline btn-sm" onClick=${() => setLinkingPackage(false)}>${t('common.cancel')}</button>
          </div>
        `}
        ${resources.length > 0 ? resources.map(res => html`
          <div key=${res.url || res.name || res} class="pf-agd-area-row">
            <span class="pf-agd-area-key">${res.name || res.url || res}</span>
            <span class="pf-agd-area-desc">${res.description || ''}</span>
            ${(res.documentCount || res.documents?.length) ? html`
              <span class="pf-agd-package-count">${res.documentCount || res.documents?.length || 0} docs</span>
            ` : ''}
          </div>
        `) : html`
          <div class="agd-empty">${t('profile.agents.detail.dataAccess.noPackages')}</div>
        `}
      </div>

      <!-- EFFECTIVE SCOPE SUMMARY -->
      <div class="pf-agd-scope-summary">
        ${t('profile.agents.detail.dataAccess.effectiveScope')}:\n${
          [...memoryAreas.map(a => a.key || a), ...tags.map(tag => `agents.tag.${tag}.*`), 'agents.shared.index'].join(', ')
        }${resources.length > 0 ? `\n${t('profile.agents.detail.dataAccess.knowledgeTitle')}: ${resources.map(r => r.name || r.url || r).join(', ')}` : ''}
      </div>
      <div class="pf-agd-help-text">${t('profile.agents.detail.dataAccess.scopeNote')}</div>
    </div>
  `;
}
