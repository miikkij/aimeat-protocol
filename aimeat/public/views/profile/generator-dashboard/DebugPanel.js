/**
 * @file DebugPanel.js
 * @description Debug panel sub-component for the generator dashboard — shows all
 *   debug artifacts (prompts, generated code, test code, test results) saved to disk
 *   during the autopilot run. Fetches from the debug API and renders files with
 *   syntax-aware formatting.
 *
 *   Part of the hook-per-domain architecture. Standalone panel toggled from the
 *   lifecycle toolbar. Fetches its own data via API calls.
 *
 * @structure
 *   - DebugPanel({ projectId }): fetches and renders debug files for a project
 * @usage
 *   import { DebugPanel } from './generator-dashboard/DebugPanel.js';
 *   ${showDebug && html`<${DebugPanel} projectId=${projectId} />`}
 * @version-history
 *   v1.0.0 — 2026-03-23 — Initial implementation
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiDelete } from '/js/api.js';

export function DebugPanel({ projectId }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    loadFiles();
  }, [projectId]);

  async function loadFiles() {
    setLoading(true);
    try {
      const resp = await apiGet(`/v1/generator/debug/${projectId}/files`);
      setFiles(resp?.data?.files || []);
    } catch {
      setFiles([]);
    }
    setLoading(false);
  }

  async function loadFile(path) {
    setSelectedFile(path);
    setLoadingFile(true);
    try {
      const resp = await apiGet(`/v1/generator/debug/${projectId}/file?path=${encodeURIComponent(path)}`);
      setFileContent(resp?.data?.content || null);
    } catch {
      setFileContent('(Error loading file)');
    }
    setLoadingFile(false);
  }

  async function handleDelete() {
    if (!confirm('Delete all debug data for this project?')) return;
    try {
      await apiDelete(`/v1/generator/debug/${projectId}`);
      setFiles([]);
      setSelectedFile(null);
      setFileContent(null);
    } catch { /* */ }
  }

  // Group files by component
  const grouped = {};
  for (const f of files) {
    const parts = f.split('/');
    const group = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(f);
  }

  // Determine file type for display
  function fileIcon(path) {
    if (path.endsWith('.json')) return '\uD83D\uDCC4';
    if (path.endsWith('.js')) return '\uD83D\uDCDC';
    if (path.endsWith('.txt')) return '\uD83D\uDCDD';
    if (path.endsWith('.jsonl')) return '\uD83D\uDCCA';
    return '\uD83D\uDCC1';
  }

  function fileName(path) {
    return path.split('/').pop();
  }

  if (loading) return html`<div class="pf-gen-debug-panel"><p>${t('profile.loading')}</p></div>`;

  if (files.length === 0) {
    return html`<div class="pf-gen-debug-panel">
      <h4>Debug</h4>
      <p class="pf-gen-debug-empty">No debug data yet. Run the autopilot to generate debug artifacts.</p>
    </div>`;
  }

  return html`<div class="pf-gen-debug-panel">
    <div class="pf-gen-debug-header">
      <h4>Debug Artifacts</h4>
      <span class="pf-gen-debug-count">${files.length} files</span>
      <button class="btn-ghost btn-sm" onClick=${() => loadFiles()}>Refresh</button>
      <button class="btn-ghost btn-sm pf-gen-debug-delete" onClick=${handleDelete}>Delete all</button>
    </div>
    <div class="pf-gen-debug-body">
      <div class="pf-gen-debug-tree">
        ${Object.entries(grouped).map(([group, groupFiles]) => html`
          <div class="pf-gen-debug-group">
            <div class="pf-gen-debug-group-label">${group === 'root' ? 'Project' : group}</div>
            ${groupFiles.map(f => html`
              <div class="pf-gen-debug-file ${selectedFile === f ? 'active' : ''}"
                onClick=${() => loadFile(f)}>
                <span class="pf-gen-debug-icon">${fileIcon(f)}</span>
                <span class="pf-gen-debug-name">${fileName(f)}</span>
              </div>
            `)}
          </div>
        `)}
      </div>
      <div class="pf-gen-debug-content">
        ${selectedFile ? html`
          <div class="pf-gen-debug-content-header">
            <span class="pf-gen-debug-path">${selectedFile}</span>
          </div>
          ${loadingFile
            ? html`<p>${t('profile.loading')}</p>`
            : html`<pre class="pf-gen-debug-pre">${fileContent}</pre>`
          }
        ` : html`<p class="pf-gen-debug-hint">Select a file to view its content</p>`}
      </div>
    </div>
  </div>`;
}
