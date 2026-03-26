/**
 * @file DebugPanel.js
 * @description Debug panel sub-component for the foundry dashboard — shows all
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
 *   import { DebugPanel } from './foundry-dashboard/DebugPanel.js';
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
      const resp = await apiGet(`/v1/foundry/debug/${projectId}/files`);
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
      const resp = await apiGet(`/v1/foundry/debug/${projectId}/file?path=${encodeURIComponent(path)}`);
      setFileContent(resp?.data?.content || null);
    } catch {
      setFileContent('(Error loading file)');
    }
    setLoadingFile(false);
  }

  async function handleDelete() {
    if (!confirm('Delete all debug data for this project?')) return;
    try {
      await apiDelete(`/v1/foundry/debug/${projectId}`);
      setFiles([]);
      setSelectedFile(null);
      setFileContent(null);
    } catch { /* */ }
  }

  const [copying, setCopying] = useState(false);

  async function handleCopyAll() {
    setCopying(true);
    try {
      // Sort files in logical order: project meta first, then by component, then logs last
      const sorted = [...files].sort((a, b) => {
        const order = (f) => {
          if (f.startsWith('project') || f.startsWith('interview') || f.startsWith('blueprint')) return '0_' + f;
          if (f.includes('logs/')) return '9_' + f;
          // Components: sort by component ID, then by phase
          const phaseOrder = { 'prompt.txt': 1, 'generated.txt': 2, 'validation.json': 3, 'test-prompt.txt': 4, 'test-code.js': 5, 'test-result.json': 6 };
          const name = f.split('/').pop();
          return '5_' + f.replace(name, String(phaseOrder[name] || 7).padStart(2, '0'));
        };
        return order(a).localeCompare(order(b));
      });

      const parts = [];
      parts.push(`=== GENERATOR DEBUG DUMP — ${projectId} ===`);
      parts.push(`Date: ${new Date().toISOString()}`);
      parts.push(`Files: ${files.length}`);
      parts.push('');

      for (const f of sorted) {
        try {
          const resp = await apiGet(`/v1/foundry/debug/${projectId}/file?path=${encodeURIComponent(f)}`);
          const content = resp?.data?.content || '(empty)';
          parts.push(`${'='.repeat(60)}`);
          parts.push(`FILE: ${f}`);
          parts.push(`${'='.repeat(60)}`);
          parts.push(content);
          parts.push('');
        } catch {
          parts.push(`--- ${f}: (failed to load) ---`);
        }
      }

      await navigator.clipboard.writeText(parts.join('\n'));
      // Brief visual feedback
      setCopying('done');
      setTimeout(() => setCopying(false), 2000);
    } catch (e) {
      setCopying(false);
      alert('Copy failed: ' + e.message);
    }
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

  if (loading) return html`<div class="fnd-debug-panel"><p>${t('profile.loading')}</p></div>`;

  if (files.length === 0) {
    return html`<div class="fnd-debug-panel">
      <h4>Debug</h4>
      <p class="fnd-debug-empty">No debug data yet. Run the autopilot to generate debug artifacts.</p>
    </div>`;
  }

  return html`<div class="fnd-debug-panel">
    <div class="fnd-debug-header">
      <h4>Debug Artifacts</h4>
      <span class="fnd-debug-count">${files.length} files</span>
      <button class="btn-primary btn-sm" onClick=${handleCopyAll} disabled=${copying}>
        ${copying === 'done' ? '\u2705 Copied!' : copying ? 'Copying...' : 'Copy All Debug'}
      </button>
      <button class="btn-ghost btn-sm" onClick=${() => loadFiles()}>Refresh</button>
      <button class="btn-ghost btn-sm fnd-debug-delete" onClick=${handleDelete}>Delete all</button>
    </div>
    <div class="fnd-debug-body">
      <div class="fnd-debug-tree">
        ${Object.entries(grouped).map(([group, groupFiles]) => html`
          <div class="fnd-debug-group">
            <div class="fnd-debug-group-label">${group === 'root' ? 'Project' : group}</div>
            ${groupFiles.map(f => html`
              <div class="fnd-debug-file ${selectedFile === f ? 'active' : ''}"
                onClick=${() => loadFile(f)}>
                <span class="fnd-debug-icon">${fileIcon(f)}</span>
                <span class="fnd-debug-name">${fileName(f)}</span>
              </div>
            `)}
          </div>
        `)}
      </div>
      <div class="fnd-debug-content">
        ${selectedFile ? html`
          <div class="fnd-debug-content-header">
            <span class="fnd-debug-path">${selectedFile}</span>
            <button class="btn-outline btn-sm fnd-debug-copy-file" onClick=${() => {
              if (fileContent) {
                navigator.clipboard.writeText(fileContent);
                // TODO: visual feedback
              }
            }}>Copy File</button>
          </div>
          ${loadingFile
            ? html`<p>${t('profile.loading')}</p>`
            : html`<pre class="fnd-debug-pre">${fileContent}</pre>`
          }
        ` : html`<p class="fnd-debug-hint">Select a file to view its content</p>`}
      </div>
    </div>
  </div>`;
}
