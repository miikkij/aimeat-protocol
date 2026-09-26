/**
 * @file tab-agent-config.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent Config tab -- platform-specific config files with preview
 *   and two-way sync. Shows files pushed by the agent (soul.md, AGENTS.md, etc).
 *   Supports edit, copy, download, and upload actions.
 * @version-history
 *   v1.17.1 -- 2026-09-26 -- The file's text scrolls after 300px again, as main's
 *     .pf-agd-config-preview did (Code scroll="medium"; fix pass).
 *   v1.17.0 -- 2026-09-26 -- Onto the components: the budget guards are the section Card with two
 *     Checks (the number stays inside each check line, as on main) and the Loud save in FormActions;
 *     the delete zone is the SettingBox (irreversible) with its SettingRow and SettingConfirm; the
 *     upload is the FileDrop button; the files are the List (a row opens its file in the Panel, the
 *     name a button with aria-expanded), the file's text the scrolling Code block, the editor a
 *     TextArea in the typewriter face again (main drew it mono; the branch had lost it). The page
 *     writes no class.
 *   v1.16.0 -- 2026-09-26 -- The configuration files are the Listing (css/components/listing.css, cut name-state): the name with its date or description on the grey line under it, the green dot beside it, the platform tag at the end; the file you pick opens under its own row in the raised panel, its text the Code block (a unification: Jouni's decision "File pick list").
 *   v1.15.0 -- 2026-09-26 -- The run limits beside their check boxes are the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.14.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A dot that says a state (active, inactive, running, something unseen) is the status dot (css/components/status-dot.css), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip), a unification: Jouni's decision Tag.
 *   v1.9.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Card } from '/components/Card.js';
import { SettingBox, SettingRow, SettingConfirm } from '/components/Box.js';
import { Check } from '/components/Check.js';
import { TextField, TextArea } from '/components/TextField.js';
import { FormActions } from '/components/Field.js';
import { FileDrop } from '/components/FileDrop.js';
import { SubHeading, HeadDesc } from '/components/SubHeading.js';
import { Row as Line, Split, Space } from '/components/Layout.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { AgentAiSection } from './agent-ai-section.js';

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

  // The number sits inside the check line's words, as on main: a press on the number field edits it,
  // a press on the words ticks the box.
  return html`
    <${Card} tone="section" title=${t('profile.scheduler.budgetTitle')}>
      <${HeadDesc}>${t('profile.scheduler.budgetDesc')}<//>
      <${Split} gap="small">
        <${Check} checked=${maxRuns.enabled} onChange=${(on) => setMaxRuns(s => ({ ...s, enabled: on }))}>
          ${t('profile.scheduler.maxRuns')}
          <${TextField} type="number" size="short" min="1" value=${maxRuns.limit} disabled=${!maxRuns.enabled}
            ariaLabel=${t('profile.scheduler.maxRuns')} onInput=${(v) => setMaxRuns(s => ({ ...s, limit: v }))} />
        <//>
        <${Check} checked=${dailyLimit.enabled} onChange=${(on) => setDailyLimit(s => ({ ...s, enabled: on }))}>
          ${t('profile.scheduler.dailyLimit')}
          <${TextField} type="number" size="short" min="0" step="0.1" value=${dailyLimit.limit} disabled=${!dailyLimit.enabled}
            ariaLabel=${t('profile.scheduler.dailyLimit')} onInput=${(v) => setDailyLimit(s => ({ ...s, limit: v }))} />
        <//>
      <//>
      <${FormActions} end>
        <${Loud} control disabled=${saving} onClick=${save}>${saving ? t('profile.scheduler.saving') : t('profile.scheduler.budgetSave')}<//>
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
    <${SettingBox} irreversible label=${t('profile.agents.detail.agent_config.deleteTitle') || 'Delete this agent'}>
      <${SettingRow}>
        <${Note} inline>${t('profile.agents.detail.agent_config.deleteDesc') || 'Removes the agent, its credentials and its task history. This cannot be undone.'}<//>
        <${Action} small tone="danger" expanded=${open} onClick=${() => { setOpen(o => !o); setTyped(''); }}>${t('profile.agents.deleteAgent')}…<//>
      <//>
      ${open && html`
        <${SettingConfirm}>
          <${TextField} label=${(t('profile.agents.detail.agent_config.deleteConfirmLabel') || 'Type the agent’s name to confirm') + ': ' + agentName}
            value=${typed} onInput=${setTyped} placeholder=${agentName} />
          <${Loud} control danger disabled=${typed.trim() !== agentName}
            onClick=${() => onDeleteClick(agent.name)}>${t('profile.agents.deleteAgent')}<//>
        <//>
      `}
    <//>`;
}

export default function TabAgentConfig({ agent, agentName, showToast, onDeleteClick }) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');

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
    return html`<${Note} kind="loading">${t('profile.loading')}<//>`;
  }

  // The upload opens the browser's file window; the chosen file is read here (handleFileUpload).
  const upload = html`
    <${Space} below="large">
      <${FileDrop} button=${'+ ' + t('profile.agents.detail.agent_config.upload')} accept=".md,.yaml,.yml,.json" onChange=${handleFileUpload} />
    <//>`;

  if (files.length === 0) {
    return html`
      <div>
        <${ScheduleBudgetSection} agent=${agent} agentName=${agentName} showToast=${showToast} />
        <${AgentAiSection} agentName=${agentName} showToast=${showToast} />
        ${upload}
        <${Note} kind="quiet">${t('profile.agents.detail.empty.agent_config')}<//>
        <${AgentDangerZone} agent=${agent} agentName=${agentName} onDeleteClick=${onDeleteClick} />
      </div>
    `;
  }

  return html`
    <div>
      <${ScheduleBudgetSection} agent=${agent} agentName=${agentName} showToast=${showToast} />
      <${AgentAiSection} agentName=${agentName} showToast=${showToast} />
      ${upload}

      <${List} cols="name-doors" apart>
        ${files.map(file => html`
          <${Row} key=${file.key} open=${selectedFile === file.key} onToggle=${() => selectFile(file)}
            panel=${selectedFile === file.key ? renderOpened() : null}>
            <${Name} dot=${file.active !== false ? 'active' : undefined}
              meta=${file.description || (file.updatedAt ? `${t('profile.agents.tasks.updated')}: ${fmtDate(file.updatedAt)}` : '')}>${file.filename}<//>
            <${Doors}>${file.platform && html`<${Mark}>${file.platform}<//>`}<//>
          <//>
        `)}
      <//>
      <${AgentDangerZone} agent=${agent} agentName=${agentName} onDeleteClick=${onDeleteClick} />
    </div>
  `;

  /** The file you picked, opened under its own row (the List's opened panel, raised). */
  function renderOpened() {
    return html`
      <${Line} justify="between" wrap>
        <${SubHeading} inline>${t('profile.agents.detail.agent_config.viewing')}: ${files.find(f => f.key === selectedFile)?.filename || ''}<//>
        ${!editing && html`
          <${Actions}>
            <${Action} small onClick=${handleEdit}>${t('profile.agents.detail.agent_config.edit')}<//>
            <${Action} small onClick=${handleCopy}>${t('common.copy')}<//>
            <${Action} small onClick=${handleDownload}>${t('profile.agents.detail.agent_config.download')}<//>
          <//>
        `}
      <//>
      ${editing ? html`
        <${Space} above="small">
          <${TextArea} code rows=${8} value=${editContent} onInput=${setEditContent}
            ariaLabel=${files.find(f => f.key === selectedFile)?.filename || t('profile.agents.detail.agent_config.edit')} />
          <${FormActions}>
            <${Loud} control onClick=${handleSave}>${t('profile.agents.detail.agent_config.save')}<//>
            <${Action} small onClick=${handleCancelEdit}>${t('profile.agents.detail.agent_config.cancel')}<//>
          <//>
        <//>
      ` : html`
        <${Code} block scroll="medium">${preview}<//>
      `}`;
  }
}
