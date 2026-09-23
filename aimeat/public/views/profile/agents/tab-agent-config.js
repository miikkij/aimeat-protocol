/**
 * @file tab-agent-config.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent Config tab -- platform-specific config files with preview
 *   and two-way sync. Shows files pushed by the agent (soul.md, AGENTS.md, etc).
 *   Supports edit, copy, download, and upload actions.
 * @version-history
 *   2026-09-22 -- Composed from the shared parts (Section, ListRow, Field, Action, Surface, Text); it no
 *     longer borrows the scheduler's and projects' classes. The danger zone keeps its typed-name gate.
 *   2026-09-20 -- The agent's AI section (agent-ai-section.js): its own keys, cap, gate and numbers.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
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
import { date as fmtDate } from '/js/format.js';
import { AgentAiSection } from './agent-ai-section.js';
import { Section, Stack, Columns, ListRow, Chip, Field, Action, Surface, Text } from '/components/poster-parts.js';

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

  // Each guard is a switch and its number. The number field has no label of its own: the switch's
  // words name both, as the one label around them did before.
  return html`
    <${Section} size="small" density="compact" title=${t('profile.scheduler.budgetTitle')} description=${t('profile.scheduler.budgetDesc')}>
      <${Stack} density="compact">
        <${Columns} layout="leading" density="compact" collapse="560">
          <${Field} type="checkbox" label=${t('profile.scheduler.maxRuns')} value=${maxRuns.enabled}
            onChange=${e => setMaxRuns(s => ({ ...s, enabled: e.target.checked }))} />
          <${Field} type="number" min="1" value=${maxRuns.limit} disabled=${!maxRuns.enabled}
            onInput=${e => setMaxRuns(s => ({ ...s, limit: e.target.value }))} />
        <//>
        <${Columns} layout="leading" density="compact" collapse="560">
          <${Field} type="checkbox" label=${t('profile.scheduler.dailyLimit')} value=${dailyLimit.enabled}
            onChange=${e => setDailyLimit(s => ({ ...s, enabled: e.target.checked }))} />
          <${Field} type="number" min="0" step="0.1" value=${dailyLimit.limit} disabled=${!dailyLimit.enabled}
            onInput=${e => setDailyLimit(s => ({ ...s, limit: e.target.value }))} />
        <//>
        <${Stack} direction="horizontal" density="compact">
          <${Action} disabled=${saving} onClick=${save}>${saving ? t('profile.scheduler.saving') : t('profile.scheduler.budgetSave')}<//>
        <//>
      <//>
    <//>`;
}

/** Danger zone — deleting the agent lives HERE (not on every tab's footer): a red-bordered box
 *  whose Delete needs the agent's name typed first; the final confirm dialog still applies. */
function AgentDangerZone({ agent, agentName, onDeleteClick }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  if (!onDeleteClick) return null;
  return html`
    <${Surface} kind="aside" tone="danger" density="compact">
      <${Stack} density="compact">
        <${Stack} direction="wrap" align="between" density="compact">
          <${Stack} density="compact">
            <${Text} tone="danger"><strong>${t('profile.agents.detail.agent_config.deleteTitle') || 'Delete this agent'}</strong><//>
            <${Text} tone="muted">${t('profile.agents.detail.agent_config.deleteDesc') || 'Removes the agent, its credentials and its task history. This cannot be undone.'}<//>
          <//>
          <${Action} expanded=${open} onClick=${() => { setOpen(o => !o); setTyped(''); }}>${t('profile.agents.deleteAgent')}…<//>
        <//>
        ${open && html`
          <${Stack} direction="wrap" align="end" density="compact">
            <${Field} label=${(t('profile.agents.detail.agent_config.deleteConfirmLabel') || 'Type the agent’s name to confirm') + ': ' + agentName}
              value=${typed} onInput=${(e) => setTyped(e.target.value)} placeholder=${agentName} />
            <${Action} kind="primary" tone="danger" disabled=${typed.trim() !== agentName}
              onClick=${() => onDeleteClick(agent.name)}>${t('profile.agents.deleteAgent')}<//>
          <//>
        `}
      <//>
    <//>`;
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
    return html`<${Text} tone="muted">${t('profile.loading')}<//>`;
  }

  const upload = html`
    <${Stack} direction="horizontal" density="compact">
      <${Action} onClick=${handleUploadClick}>${t('profile.agents.detail.agent_config.upload')}<//>
      <input ref=${fileInputRef} type="file" accept=".md,.yaml,.yml,.json" hidden onChange=${handleFileUpload} />
    <//>`;

  if (files.length === 0) {
    return html`
      <${Stack}>
        <${ScheduleBudgetSection} agent=${agent} agentName=${agentName} showToast=${showToast} />
        <${AgentAiSection} agentName=${agentName} showToast=${showToast} />
        ${upload}
        <${Text} tone="muted">${t('profile.agents.detail.empty.agent_config')}<//>
        <${AgentDangerZone} agent=${agent} agentName=${agentName} onDeleteClick=${onDeleteClick} />
      <//>
    `;
  }

  return html`
    <${Stack}>
      <${ScheduleBudgetSection} agent=${agent} agentName=${agentName} showToast=${showToast} />
      <${AgentAiSection} agentName=${agentName} showToast=${showToast} />
      ${upload}

      <${Stack} density="compact">
        ${files.map(file => html`
          <${ListRow} key=${file.key} density="compact" selected=${selectedFile === file.key}
            marker=${file.active !== false ? 'success' : 'muted'}
            name=${file.filename} onOpen=${() => selectFile(file)}
            detail=${file.description || (file.updatedAt ? `${t('profile.agents.tasks.updated')}: ${fmtDate(file.updatedAt)}` : '')}
            detailKind=${file.description ? 'text' : 'mono'}
            value=${file.platform ? html`<${Chip}>${file.platform}<//>` : null} />
        `)}
      <//>

      ${selectedFile && html`
        <${Section} size="small" density="compact"
          title=${`${t('profile.agents.detail.agent_config.viewing')}: ${files.find(f => f.key === selectedFile)?.filename || ''}`}
          actions=${!editing && html`
            <${Action} kind="text" onClick=${handleEdit}>${t('profile.agents.detail.agent_config.edit')}<//>
            <${Action} kind="text" onClick=${handleCopy}>${t('common.copy')}<//>
            <${Action} kind="text" onClick=${handleDownload}>${t('profile.agents.detail.agent_config.download')}<//>
          `}>
          ${editing ? html`
            <${Stack} density="compact">
              <${Field} type="textarea" rows=${16} value=${editContent} onInput=${(e) => setEditContent(e.target.value)} />
              <${Stack} direction="horizontal" density="compact">
                <${Action} kind="primary" onClick=${handleSave}>${t('profile.agents.detail.agent_config.save')}<//>
                <${Action} onClick=${handleCancelEdit}>${t('profile.agents.detail.agent_config.cancel')}<//>
              <//>
            <//>
          ` : html`
            <${Surface} kind="code">${preview}<//>
          `}
        <//>
      `}
      <${AgentDangerZone} agent=${agent} agentName=${agentName} onDeleteClick=${onDeleteClick} />
    <//>
  `;
}
