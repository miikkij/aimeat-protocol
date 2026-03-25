/**
 * @file generator-debug-tab.js
 * @description Admin Dashboard — Generator Debug tab. Lists all generator projects
 *   with debug data saved to disk, allows browsing files per project, and viewing
 *   content with syntax highlighting.
 * @version-history
 *   v1.0.0 — 2026-03-23 — Initial implementation
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiDelete } from '/js/api.js';

export default function GeneratorDebugTab() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const resp = await apiGet('/v1/generator/debug/projects');
      setProjects(resp?.data?.projects || []);
    } catch { setProjects([]); }
    setLoading(false);
  }

  async function selectProject(projectId) {
    setSelectedProject(projectId);
    setSelectedFile(null);
    setFileContent(null);
    try {
      const resp = await apiGet(`/v1/generator/debug/${projectId}/files`);
      setFiles(resp?.data?.files || []);
    } catch { setFiles([]); }
  }

  async function loadFile(path) {
    setSelectedFile(path);
    setLoadingFile(true);
    try {
      const resp = await apiGet(`/v1/generator/debug/${selectedProject}/file?path=${encodeURIComponent(path)}`);
      setFileContent(resp?.data?.content || null);
    } catch { setFileContent('(Error loading file)'); }
    setLoadingFile(false);
  }

  async function handleDeleteProject(projectId) {
    if (!confirm(`Delete all debug data for ${projectId}?`)) return;
    try {
      await apiDelete(`/v1/generator/debug/${projectId}`);
      setProjects(prev => prev.filter(p => p.projectId !== projectId));
      if (selectedProject === projectId) {
        setSelectedProject(null);
        setFiles([]);
        setSelectedFile(null);
        setFileContent(null);
      }
    } catch { /* */ }
  }

  const [copying, setCopying] = useState(false);

  async function handleCopyAll(projId) {
    setCopying(true);
    try {
      const resp = await apiGet(`/v1/generator/debug/${projId}/files`);
      const allFiles = resp?.data?.files || [];
      const sorted = [...allFiles].sort((a, b) => {
        const order = (f) => {
          if (f.startsWith('project') || f.startsWith('interview') || f.startsWith('blueprint')) return '0_' + f;
          if (f.includes('logs/')) return '9_' + f;
          const phaseOrder = { 'prompt.txt': 1, 'generated.txt': 2, 'validation.json': 3, 'test-prompt.txt': 4, 'test-code.js': 5, 'test-result.json': 6 };
          const name = f.split('/').pop();
          return '5_' + f.replace(name, String(phaseOrder[name] || 7).padStart(2, '0'));
        };
        return order(a).localeCompare(order(b));
      });
      const parts = [`=== GENERATOR DEBUG DUMP — ${projId} ===`, `Date: ${new Date().toISOString()}`, `Files: ${allFiles.length}`, ''];
      for (const f of sorted) {
        try {
          const r = await apiGet(`/v1/generator/debug/${projId}/file?path=${encodeURIComponent(f)}`);
          parts.push('='.repeat(60), `FILE: ${f}`, '='.repeat(60), r?.data?.content || '(empty)', '');
        } catch { parts.push(`--- ${f}: (failed to load) ---`); }
      }
      await navigator.clipboard.writeText(parts.join('\n'));
      setCopying('done');
      setTimeout(() => setCopying(false), 2000);
    } catch (e) {
      setCopying(false);
    }
  }

  // Group files by directory
  const grouped = {};
  for (const f of files) {
    const parts = f.split('/');
    const group = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(f);
  }

  function fileName(path) { return path.split('/').pop(); }
  function fileIcon(path) {
    if (path.endsWith('.json')) return '\uD83D\uDCC4';
    if (path.endsWith('.js')) return '\uD83D\uDCDC';
    if (path.endsWith('.txt')) return '\uD83D\uDCDD';
    if (path.endsWith('.jsonl')) return '\uD83D\uDCCA';
    return '\uD83D\uDCC1';
  }

  if (loading) return html`<div class="adm-section"><p>${t('profile.loading')}</p></div>`;

  return html`
    <div class="adm-section">
      <h3>Generator Debug Files</h3>
      <p class="adm-desc">Debug artifacts from generator autopilot runs — prompts, generated code, test results.</p>

      ${projects.length === 0 && html`
        <p class="adm-empty">No debug data found. Run the generator autopilot to create debug artifacts.</p>
      `}

      <!-- Project list -->
      ${!selectedProject && projects.length > 0 && html`
        <div class="adm-card-grid">
          ${projects.map(p => html`
            <div class="adm-card adm-card-clickable" onClick=${() => selectProject(p.projectId)}>
              <div class="adm-card-header">
                <strong>${p.projectId}</strong>
                <button class="btn-primary btn-sm" onClick=${e => { e.stopPropagation(); handleCopyAll(p.projectId); }}>
                  ${copying === 'done' ? '\u2705 Copied!' : copying ? '...' : 'Copy All'}
                </button>
                <button class="btn-ghost btn-sm" onClick=${e => { e.stopPropagation(); handleDeleteProject(p.projectId); }}>
                  Delete
                </button>
              </div>
              <div class="adm-card-meta">
                ${p.createdAt ? new Date(p.createdAt).toLocaleString() : 'Unknown date'}
                ${' · '}${p.fileCount} files
              </div>
            </div>
          `)}
        </div>
      `}

      <!-- File browser -->
      ${selectedProject && html`
        <div>
          <div class="adm-breadcrumb">
            <button class="btn-ghost btn-sm" onClick=${() => { setSelectedProject(null); setFiles([]); setSelectedFile(null); }}>
              ← Back to projects
            </button>
            <strong>${selectedProject}</strong>
            <button class="btn-primary btn-sm" onClick=${() => handleCopyAll(selectedProject)}>
              ${copying === 'done' ? '\u2705 Copied!' : copying ? '...' : 'Copy All Debug'}
            </button>
            <span class="adm-count">${files.length} files</span>
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
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid var(--border)">
                  <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:0.85rem">${selectedFile}</span>
                  <button class="btn-outline btn-sm" style="flex-shrink:0" onClick=${() => {
                    navigator.clipboard.writeText(fileContent).catch(() => {});
                  }}>Copy File</button>
                </div>
                ${loadingFile
                  ? html`<p>${t('profile.loading')}</p>`
                  : html`<pre class="pf-gen-debug-pre">${fileContent}</pre>`
                }
              ` : html`<p class="pf-gen-debug-hint">Select a file to view its content</p>`}
            </div>
          </div>
        </div>
      `}
    </div>
  `;
}
