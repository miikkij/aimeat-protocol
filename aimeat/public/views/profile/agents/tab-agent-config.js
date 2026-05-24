/**
 * @file tab-agent-config.js
 * @description Agent Config tab -- platform-specific config files with preview
 *   and two-way sync. Shows files pushed by the agent (soul.md, AGENTS.md, etc).
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';

const html = htm.bind(h);

export default function TabAgentConfig({ agentName, session, showToast }) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);

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
  }

  if (loading) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  if (files.length === 0) {
    return html`<div class="agd-empty">${t('agents.detail.empty.agentConfig')}</div>`;
  }

  return html`
    <div>
      <div class="pf-agd-config-list">
        ${files.map(file => html`
          <div key=${file.key}
               class="pf-agd-config-item ${selectedFile === file.key ? 'pf-agd-config-item--active' : ''}"
               onClick=${() => selectFile(file)}>
            <span class="pf-agd-config-name">${file.filename}</span>
            <span class="pf-agd-config-desc">${file.updatedAt ? `${t('profile.agents.tasks.updated')}: ${new Date(file.updatedAt).toLocaleDateString()}` : ''}</span>
          </div>
        `)}
      </div>

      ${selectedFile && html`
        <div>
          <div class="pf-agd-config-preview-header">
            ${t('agents.detail.agentConfig.viewing')}: ${files.find(f => f.key === selectedFile)?.filename || ''}
          </div>
          <div class="pf-agd-config-preview">${preview}</div>
        </div>
      `}
    </div>
  `;
}
