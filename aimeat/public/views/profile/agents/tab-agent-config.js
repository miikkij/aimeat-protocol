/**
 * @file tab-agent-config.js
 * @description Agent Config tab -- platform-specific config files with preview,
 *   copy/download/edit actions, platform tag badges, and file upload.
 * @version-history
 *   v1.1.0 -- 2026-05-24 -- Add Copy/Download/Edit buttons, platform badges, upload
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { copyToClipboard } from '/js/utils.js';

const html = htm.bind(h);

const PLATFORM_TAGS = {
  'CLAUDE.md': 'Claude Code',
  'claude.md': 'Claude Code',
  'AGENTS.md': 'Agents',
  'agents.md': 'Agents',
  'hermes.yaml': 'Hermes',
  'hermes.yml': 'Hermes',
  'soul.md': 'Soul',
  '.cursorrules': 'Cursor',
  'copilot-instructions.md': 'Copilot',
};

function detectPlatformTag(filename) {
  return PLATFORM_TAGS[filename] || null;
}

export default function TabAgentConfig({ agentName, session, showToast }) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);

  async function loadFiles() {
    setLoading(true);
    try {
      const resp = await apiGet(`/v1/memory?prefix=agents.${encodeURIComponent(agentName)}.config.`);
      const items = resp?.data?.items || resp?.data?.memories || [];
      const configFiles = items.map(item => ({
        key: item.key,
        filename: item.key.replace(`agents.${agentName}.config.`, ''),
        content: typeof item.value === 'string' ? item.value : JSON.stringify(item.value, null, 2),
        updatedAt: item.updated_at || item.updatedAt,
      }));
      setFiles(configFiles);
      if (configFiles.length > 0 && !selectedFile) {
        setSelectedFile(configFiles[0].key);
        setPreview(configFiles[0].content);
      }
    } catch {
      setFiles([]);
    }
    setLoading(false);
  }

  useEffect(() => { loadFiles(); }, [agentName]);

  const loadRef = useRef(loadFiles);
  loadRef.current = loadFiles;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  function selectFile(file) {
    setSelectedFile(file.key);
    setPreview(file.content);
    setEditing(false);
  }

  function handleCopy() {
    copyToClipboard(preview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const file = files.find(f => f.key === selectedFile);
    if (!file) return;
    const blob = new Blob([file.content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleEditToggle() {
    if (editing) {
      setEditing(false);
    } else {
      setEditContent(preview);
      setEditing(true);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const file = files.find(f => f.key === selectedFile);
      if (!file) return;
      await apiPut(`/v1/memory/${encodeURIComponent(file.key)}`, { value: editContent });
      setPreview(editContent);
      setEditing(false);
      showToast(t('profile.agents.detail.agentConfig.saved'));
      loadFiles();
    } catch (err) {
      showToast(err.message || t('profile.unknownError'), true);
    }
    setSaving(false);
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const key = `agents.${agentName}.config.${file.name}`;
      await apiPut(`/v1/memory/${encodeURIComponent(key)}`, { value: content });
      showToast(t('profile.agents.detail.agentConfig.uploaded'));
      loadFiles();
    } catch (err) {
      showToast(err.message || t('profile.unknownError'), true);
    }
    e.target.value = '';
  }

  if (loading) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  if (files.length === 0) {
    return html`
      <div>
        <div class="agd-empty">${t('profile.agents.detail.empty.agentConfig')}</div>
        <div class="agd-form-actions">
          <button class="btn-outline btn-sm" onClick=${() => fileInputRef.current?.click()}>
            + ${t('profile.agents.detail.agentConfig.upload')}
          </button>
          <input ref=${fileInputRef} type="file" accept=".md,.yaml,.yml,.json,.txt" style="display:none" onChange=${handleUpload} />
        </div>
      </div>
    `;
  }

  return html`
    <div>
      <div class="pf-agd-config-list">
        ${files.map(file => {
          const tag = detectPlatformTag(file.filename);
          return html`
            <div key=${file.key}
                 class="pf-agd-config-item ${selectedFile === file.key ? 'pf-agd-config-item--active' : ''}"
                 onClick=${() => selectFile(file)}>
              <span class="pf-agd-config-name">${file.filename}</span>
              ${tag && html`<span class="pf-agd-badge pf-agd-badge--platform">${tag}</span>`}
              <span class="pf-agd-config-desc">${file.updatedAt ? `${t('profile.agents.tasks.updated')}: ${new Date(file.updatedAt).toLocaleDateString()}` : ''}</span>
            </div>
          `;
        })}
      </div>

      <div class="agd-form-actions">
        <button class="btn-outline btn-sm" onClick=${() => fileInputRef.current?.click()}>
          + ${t('profile.agents.detail.agentConfig.upload')}
        </button>
        <input ref=${fileInputRef} type="file" accept=".md,.yaml,.yml,.json,.txt" style="display:none" onChange=${handleUpload} />
      </div>

      ${selectedFile && html`
        <div>
          <div class="pf-agd-config-preview-header">
            <span>${t('profile.agents.detail.agentConfig.viewing')}: ${files.find(f => f.key === selectedFile)?.filename || ''}</span>
            <div class="pf-agd-config-actions">
              <button class="btn-ghost btn-sm" onClick=${handleCopy}>
                ${copied ? t('profile.agents.copied') : t('profile.agents.detail.agentConfig.copy')}
              </button>
              <button class="btn-ghost btn-sm" onClick=${handleDownload}>
                ${t('profile.agents.detail.agentConfig.download')}
              </button>
              <button class="btn-ghost btn-sm" onClick=${handleEditToggle}>
                ${editing ? t('profile.agents.detail.agentConfig.cancel') : t('profile.agents.detail.agentConfig.edit')}
              </button>
            </div>
          </div>
          ${editing ? html`
            <div class="pf-agd-config-edit">
              <textarea class="pf-agd-config-textarea" value=${editContent} onInput=${(e) => setEditContent(e.target.value)} />
              <div class="agd-form-actions">
                <button class="btn-primary btn-sm" onClick=${handleSave} disabled=${saving}>
                  ${saving ? '...' : t('profile.agents.detail.agentConfig.save')}
                </button>
                <button class="btn-outline btn-sm" onClick=${() => setEditing(false)}>
                  ${t('profile.agents.detail.agentConfig.cancel')}
                </button>
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
