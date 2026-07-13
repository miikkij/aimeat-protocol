/**
 * @file generator-debug-tab.js
 * @description Admin Dashboard — Generator Debug tab. Lists all generator projects
 *   with debug data saved to disk, allows browsing files per project, and viewing
 *   content with syntax highlighting.
 * @version-history
 *   v1.0.0 — 2026-03-23 — Initial implementation
 *   v1.1.0 — 2026-06-02 — Admin design unification: main btn-* classes → adm-btn* (btn-primary→adm-btn, btn-ghost→adm-btn-action, btn-outline→adm-btn-action).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiDelete } from '/js/api.js';
import { copyToClipboard } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';

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
      // Load generator debug projects
      const genResp = await apiGet('/v1/generator/debug/projects').catch(() => ({ data: { projects: [] } }));
      const genProjects = (genResp?.data?.projects || []).map(p => ({ ...p, source: 'generator' }));
      setProjects([...genProjects]);
    } catch { setProjects([]); }
    setLoading(false);
  }

  function getDebugBase(_projectId) {
    return '/v1/generator/debug';
  }

  async function selectProject(projectId) {
    setSelectedProject(projectId);
    setSelectedFile(null);
    setFileContent(null);
    try {
      const base = getDebugBase(projectId);
      const resp = await apiGet(`${base}/${projectId}/files`);
      setFiles(resp?.data?.files || []);
    } catch { setFiles([]); }
  }

  async function loadFile(path) {
    setSelectedFile(path);
    setLoadingFile(true);
    try {
      const base = getDebugBase(selectedProject);
      const resp = await apiGet(`${base}/${selectedProject}/file?path=${encodeURIComponent(path)}`);
      setFileContent(resp?.data?.content || null);
    } catch { setFileContent('(Error loading file)'); }
    setLoadingFile(false);
  }

  async function handleDeleteProject(projectId) {
    if (!confirm(`Delete all debug data for ${projectId}?`)) return;
    try {
      const base = getDebugBase(projectId);
      await apiDelete(`${base}/${projectId}`);
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
      const base = getDebugBase(projId);
      const resp = await apiGet(`${base}/${projId}/files`);
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
      // First pass: load all files and count lines
      const loaded = [];
      for (const f of sorted) {
        try {
          const r = await apiGet(`${base}/${projId}/file?path=${encodeURIComponent(f)}`);
          loaded.push({ path: f, content: r?.data?.content || '(empty)' });
        } catch { loaded.push({ path: f, content: '(failed to load)' }); }
      }

      // Build Table of Contents with line numbers
      const toc = ['TABLE OF CONTENTS', '-'.repeat(40)];
      let lineNum = 1;
      // Header takes 4 lines + blank + TOC itself — calculate after TOC is built
      const tocHeaderLines = 4; // header lines before TOC
      // Pre-calculate TOC size: header(1) + separator(1) + entries + blank(1) + separator(1)
      const tocSize = tocHeaderLines + 2 + loaded.length + 2;
      lineNum = tocSize + 1;
      for (const { path, content } of loaded) {
        const contentLines = content.split('\n').length;
        toc.push(`  ${path}  (lines ${lineNum}–${lineNum + contentLines + 2})`);
        lineNum += contentLines + 4; // separator(1) + FILE header(1) + separator(1) + content + blank(1)
      }
      toc.push('');

      const parts = [`=== GENERATOR DEBUG DUMP — ${projId} ===`, `Date: ${new Date().toISOString()}`, `Files: ${loaded.length}`, '', ...toc];
      for (const { path, content } of loaded) {
        parts.push('='.repeat(60), `FILE: ${path}`, '='.repeat(60), content, '');
      }
      await copyToClipboard(parts.join('\n'));
      setCopying('done');
      setTimeout(() => setCopying(false), 2000);
    } catch {
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
                <strong>🔴 ${p.projectId}</strong>
                <button class="adm-btn" onClick=${e => { e.stopPropagation(); handleCopyAll(p.projectId); }}>
                  ${copying === 'done' ? '\u2705 Copied!' : copying ? '...' : 'Copy All'}
                </button>
                <button class="adm-btn-action" onClick=${e => { e.stopPropagation(); handleDeleteProject(p.projectId); }}>
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
            <button class="adm-btn-action" onClick=${() => { setSelectedProject(null); setFiles([]); setSelectedFile(null); }}>
              ← Back to projects
            </button>
            <strong>${selectedProject}</strong>
            <button class="adm-btn" onClick=${() => handleCopyAll(selectedProject)}>
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
                  <span style="flex-shrink:0"><${CopyButton} text=${fileContent}
                    className="adm-btn-action" label="Copy File" copiedLabel="Copy File" /></span>
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
