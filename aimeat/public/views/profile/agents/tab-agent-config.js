/**
 * @file tab-agent-config.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent Config tab -- platform-specific config files with preview
 *   and two-way sync. Shows files pushed by the agent (soul.md, AGENTS.md, etc).
 *   Supports edit, copy, download, and upload actions.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Add edit/copy/download buttons (F8), edit mode (F9), upload (F10), file metadata (F11)
 *   v1.2.0 -- 2026-06-02 -- Component unification: route handleCopy through the shared
 *     copyToClipboard (/js/utils.js) instead of raw navigator.clipboard.writeText, so the
 *     insecure-context fallback applies; toast preserved (TIER 3, stays a handler)
 *   v1.4.0 -- 2026-07-17 -- Style unification: budget-guards card uses the canonical
 *     agent-detail section title (pf-agd-section-title) instead of the profile-level
 *     red section-title.
 *   v1.3.0 -- 2026-06-10 -- AgentDangerZone at the tab bottom: typed-agent-name gate +
 *     the shared confirm — replaces the Delete button that sat on every tab's footer.
 *   v1.5.0 -- 2026-08-08 -- Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { apiGet, apiPut, apiPatch } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/** Opt-in budget guards applied as defaults to schedules created for this agent. */
function ScheduleBudgetSection({ agent, agentName, showToast }) {
  const defaults = Array.isArray(agent?.schedule_constraint_defaults) ? agent.schedule_constraint_defaults : [];
  const findC = (type) => defaults.find(c => c.type === type);
  const [maxRuns, setMaxRuns] = useState({ enabled: !!findC('max_runs')?.enabled, limit: findC('max_runs')?.params?.limit ?? 7 });
  const [dailyLimit, setDailyLimit] = useState({ enabled: !!findC('daily_limit')?.enabled, limit: agent?.daily_spend_limit ?? findC('daily_limit')?.params?.limit ?? 1 });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const constraints = [];
    if (maxRuns.enabled) constraints.push({ type: 'max_runs', enabled: true, params: { limit: Number(maxRuns.limit) } });
    if (dailyLimit.enabled) constraints.push({ type: 'daily_limit', enabled: true, params: { limit: Number(dailyLimit.limit) } });
    setSaving(true);
    try {
      await apiPatch(`/v1/agents/${encodeURIComponent(agentName)}/schedule-constraints`, {
        constraints,
        daily_spend_limit: dailyLimit.enabled ? Number(dailyLimit.limit) : null,
      });
      showToast?.(t('profile.scheduler.budgetSaved'));
    } catch (e) { showToast?.(e.message, true); }
    finally { setSaving(false); }
  };

  return html`
    <div class="sch-form sch-budget-section">
      <div class="pf-agd-section-title">${t('profile.scheduler.budgetTitle')}</div>
      <div class="section-desc">${t('profile.scheduler.budgetDesc')}</div>
      <div class="sch-constraints">
        <label class="sch-check">
          <input type="checkbox" checked=${maxRuns.enabled} onChange=${e => setMaxRuns(s => ({ ...s, enabled: e.target.checked }))} />
          ${t('profile.scheduler.maxRuns')}
          <input type="number" min="1" value=${maxRuns.limit} disabled=${!maxRuns.enabled}
            onInput=${e => setMaxRuns(s => ({ ...s, limit: e.target.value }))} class="sch-num" />
        </label>
        <label class="sch-check">
          <input type="checkbox" checked=${dailyLimit.enabled} onChange=${e => setDailyLimit(s => ({ ...s, enabled: e.target.checked }))} />
          ${t('profile.scheduler.dailyLimit')}
          <input type="number" min="0" step="0.1" value=${dailyLimit.limit} disabled=${!dailyLimit.enabled}
            onInput=${e => setDailyLimit(s => ({ ...s, limit: e.target.value }))} class="sch-num" />
        </label>
      </div>
      <div class="sch-form-actions">
        <button class="btn-primary btn-sm" disabled=${saving} onClick=${save}>${saving ? t('profile.scheduler.saving') : t('profile.scheduler.budgetSave')}</button>
      </div>
    </div>`;
}

/** Danger zone — deleting the agent lives HERE (not on every tab's footer): a red-bordered box
 *  whose Delete needs the agent's name typed first; the final confirm dialog still applies. */
function AgentDangerZone({ agent, agentName, onDeleteClick }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  if (!onDeleteClick) return null;
  return html`
    <div class="pj-danger pj-danger-box">
      <div class="pj-danger-row">
        <div class="pj-danger-text">
          <div class="pj-danger-title">${t('profile.agents.detail.agent_config.deleteTitle') || 'Delete this agent'}</div>
          <div class="pj-danger-sub">${t('profile.agents.detail.agent_config.deleteDesc') || 'Removes the agent, its credentials and its task history. This cannot be undone.'}</div>
        </div>
        <button class="btn-danger btn-sm" onClick=${() => { setOpen(o => !o); setTyped(''); }}>${t('profile.agents.deleteAgent')}…</button>
      </div>
      ${open && html`
        <div class="pj-danger-confirm">
          <label class="pj-field"><span>${(t('profile.agents.detail.agent_config.deleteConfirmLabel') || 'Type the agent’s name to confirm') + ': ' + agentName}</span>
            <input type="text" class="input-field input-sm" value=${typed} onInput=${(e) => setTyped(e.target.value)} placeholder=${agentName} /></label>
          <button class="btn-danger btn-sm" disabled=${typed.trim() !== agentName}
            onClick=${() => onDeleteClick(agent.name)}>${t('profile.agents.deleteAgent')}</button>
        </div>
      `}
    </div>`;
}

export default function TabAgentConfig({ agent, agentName, showToast, onDeleteClick }) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const fileInputRef = useRef(null);

  async function loadFiles({ showSpinner = true } = {}) {
    if (showSpinner) setLoading(true);
    try {
      const gaii = agent?.gaii || agentName;
      const resp = await apiGet(`/v1/memory?prefix=agents.config.&agent=${encodeURIComponent(gaii)}`);
      const items = resp?.data?.items || resp?.data?.memories || [];
      const configFiles = items.map(item => ({
        key: item.key,
        filename: item.key.replace(/^agents\.(?:config\.|[^.]+\.config\.)/, ''),
        content: typeof item.value === 'string' ? item.value : JSON.stringify(item.value, null, 2),
        updatedAt: item.updated_at || item.updatedAt,
        description: item.description,
        platform: item.platform,
        active: item.active,
      }));
      setFiles(configFiles);
      if (configFiles.length > 0 && !selectedFile) {
        setSelectedFile(configFiles[0].key);
        setPreview(configFiles[0].content);
      }
    } catch (err) {
      swallowed('tab-agent-config: loadFiles', err);
      if (showSpinner) setFiles([]); // keep old files on a transient live-update refetch
    }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFiles is a loader closing over agent/selectedFile; effect intentionally re-runs only when agentName changes.
  useEffect(() => { loadFiles(); }, [agentName]);

  const loadRef = useRef(loadFiles);
  loadRef.current = loadFiles;
  useEffect(() => {
    // Silent on live-update so the tab doesn't flash blank; first mount shows the spinner.
    return onLiveUpdate(['agents'], () => loadRef.current({ showSpinner: false }));
  }, []);

  function selectFile(file) {
    setSelectedFile(file.key);
    setPreview(file.content);
    setEditing(false);
  }

  function handleEdit() {
    setEditContent(preview);
    setEditing(true);
  }

  function handleCancelEdit() {
    setEditing(false);
  }

  async function handleSave() {
    try {
      await apiPut(`/v1/memory/${encodeURIComponent(selectedFile)}`, { value: editContent });
      setPreview(editContent);
      setEditing(false);
      const updated = files.map(f => f.key === selectedFile ? { ...f, content: editContent } : f);
      setFiles(updated);
      showToast(t('profile.agents.detail.agent_config.saved'));
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.agent_config.saveError'), true);
    }
  }

  function handleCopy() {
    copyToClipboard(preview).then(() => {
      showToast(t('common.copy'));
    });
  }

  function handleDownload() {
    const file = files.find(f => f.key === selectedFile);
    if (!file) return;
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const content = reader.result;
      const key = `agents.${agentName}.config.${file.name}`;
      try {
        await apiPut(`/v1/memory/${encodeURIComponent(key)}`, { value: content });
        showToast(t('profile.agents.detail.agent_config.uploaded'));
        await loadFiles();
        setSelectedFile(key);
        setPreview(content);
      } catch (err) {
        showToast(err.message || t('profile.agents.detail.agent_config.uploadError'), true);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  if (loading) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  if (files.length === 0) {
    return html`
      <div>
        <${ScheduleBudgetSection} agent=${agent} agentName=${agentName} showToast=${showToast} />
        <div class="pf-agd-config-upload">
          <button class="btn-outline btn-sm" onClick=${handleUploadClick}>+ ${t('profile.agents.detail.agent_config.upload')}</button>
          <input ref=${fileInputRef} type="file" accept=".md,.yaml,.yml,.json" class="pf-agd-hidden-input" onChange=${handleFileUpload} />
        </div>
        <div class="pf-agd-empty">${t('profile.agents.detail.empty.agent_config')}</div>
        <${AgentDangerZone} agent=${agent} agentName=${agentName} onDeleteClick=${onDeleteClick} />
      </div>
    `;
  }

  return html`
    <div>
      <${ScheduleBudgetSection} agent=${agent} agentName=${agentName} showToast=${showToast} />
      <div class="pf-agd-config-upload">
        <button class="btn-outline btn-sm" onClick=${handleUploadClick}>+ ${t('profile.agents.detail.agent_config.upload')}</button>
        <input ref=${fileInputRef} type="file" accept=".md,.yaml,.yml,.json" class="pf-agd-hidden-input" onChange=${handleFileUpload} />
      </div>

      <div class="pf-agd-config-list">
        ${files.map(file => html`
          <div key=${file.key}
               class="pf-agd-config-item ${selectedFile === file.key ? 'pf-agd-config-item--active' : ''}"
               onClick=${() => selectFile(file)}>
            ${file.active !== false && html`<span class="pf-agd-status-dot pf-agd-status-dot--active"></span>`}
            <span class="pf-agd-config-name">${file.filename}</span>
            ${file.description && html`<span class="pf-agd-config-desc">${file.description}</span>`}
            ${!file.description && html`<span class="pf-agd-config-desc">${file.updatedAt ? `${t('profile.agents.tasks.updated')}: ${new Date(file.updatedAt).toLocaleDateString()}` : ''}</span>`}
            ${file.platform && html`<span class="pf-agd-config-platform">${file.platform}</span>`}
          </div>
        `)}
      </div>

      ${selectedFile && html`
        <div>
          <div class="pf-agd-config-preview-header">
            <span>${t('profile.agents.detail.agent_config.viewing')}: ${files.find(f => f.key === selectedFile)?.filename || ''}</span>
            <div class="pf-agd-config-actions">
              ${!editing && html`
                <button class="btn-outline btn-sm" onClick=${handleEdit}>${t('profile.agents.detail.agent_config.edit')}</button>
                <button class="btn-outline btn-sm" onClick=${handleCopy}>${t('common.copy')}</button>
                <button class="btn-outline btn-sm" onClick=${handleDownload}>${t('profile.agents.detail.agent_config.download')}</button>
              `}
            </div>
          </div>
          ${editing ? html`
            <div class="pf-agd-config-edit">
              <textarea class="pf-agd-config-textarea" value=${editContent} onInput=${(e) => setEditContent(e.target.value)}></textarea>
              <div class="pf-agd-form-actions">
                <button class="btn-primary btn-sm" onClick=${handleSave}>${t('profile.agents.detail.agent_config.save')}</button>
                <button class="btn-outline btn-sm" onClick=${handleCancelEdit}>${t('profile.agents.detail.agent_config.cancel')}</button>
              </div>
            </div>
          ` : html`
            <div class="pf-agd-config-preview">${preview}</div>
          `}
        </div>
      `}
      <${AgentDangerZone} agent=${agent} agentName=${agentName} onDeleteClick=${onDeleteClick} />
    </div>
  `;
}
