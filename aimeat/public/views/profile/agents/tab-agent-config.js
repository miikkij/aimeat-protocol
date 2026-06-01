/**
 * @file tab-agent-config.js
 * @description Agent Config tab -- platform-specific config files with preview
 *   and two-way sync. Shows files pushed by the agent (soul.md, AGENTS.md, etc).
 *   Supports edit, copy, download, and upload actions.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Add edit/copy/download buttons (F8), edit mode (F9), upload (F10), file metadata (F11)
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';

const html = htm.bind(h);

export default function TabAgentConfig({ agent, agentName, session, showToast }) {
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
    } catch {
      if (showSpinner) setFiles([]); // keep old files on a transient live-update refetch
    }
    setLoading(false);
  }

  useEffect(() => { loadFiles(); }, [agentName]);

  const loadRef = useRef(loadFiles);
  loadRef.current = loadFiles;
  useEffect(() => {
    // Silent on live-update so the tab doesn't flash blank; first mount shows the spinner.
    const handler = () => loadRef.current({ showSpinner: false });
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
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
    navigator.clipboard.writeText(preview).then(() => {
      showToast(t('profile.agents.detail.agent_config.copy'));
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
        <div class="pf-agd-config-upload">
          <button class="btn-outline btn-sm" onClick=${handleUploadClick}>+ ${t('profile.agents.detail.agent_config.upload')}</button>
          <input ref=${fileInputRef} type="file" accept=".md,.yaml,.yml,.json" class="pf-agd-hidden-input" onChange=${handleFileUpload} />
        </div>
        <div class="pf-agd-empty">${t('profile.agents.detail.empty.agent_config')}</div>
      </div>
    `;
  }

  return html`
    <div>
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
                <button class="btn-outline btn-sm" onClick=${handleCopy}>${t('profile.agents.detail.agent_config.copy')}</button>
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
    </div>
  `;
}
