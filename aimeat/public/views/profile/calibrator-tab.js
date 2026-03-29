/**
 * @file calibrator-tab.js
 * @description Prompt Calibrator — list and detail views for calibration projects.
 * @structure
 *   - CalibratorTab (root) — view state machine: list | detail
 *   - ProjectListView — shows all calibration projects
 *   - ProjectDetailView — prompt editor, models, results, chart
 *   - CalibrationChart — multiline SVG chart for score tracking
 *   - ModelRow — single candidate model config row
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial implementation
 */

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPut } from '/js/api.js';
import {
  listProjects, createProject, getProject, updateProject,
  listVersions, getVersion, createVersion,
  listRuns, getRun, createRun, updateRun,
} from '/js/services/calibrator.js';

// ── Chart Colors ──
const CHART_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

// ── Multiline Chart (SVG) ──

function CalibrationChart({ runs, dimensions, versions }) {
  const [viewMode, setViewMode] = useState('overall');

  if (!runs.length || !versions.length) return null;

  const modelIds = [...new Set(runs.map(r => r.candidateModelId))];
  const modelLabels = {};
  runs.forEach(r => { modelLabels[r.candidateModelId] = r.candidateModelLabel; });

  const versionNums = versions.map(v => v.version).sort((a, b) => a - b);

  const lines = modelIds.map((modelId, idx) => {
    const points = [];
    for (const v of versionNums) {
      const runsAtVersion = runs.filter(r => r.promptVersion === v && r.candidateModelId === modelId);
      if (runsAtVersion.length === 0) continue;
      const latestRun = runsAtVersion[0];

      let score = null;
      if (viewMode === 'overall') {
        score = latestRun.overallScore;
      } else {
        const dim = (latestRun.dimensions || []).find(d => d.name === viewMode);
        score = dim ? (dim.pass ? 100 : 0) : null;
      }
      if (score != null) points.push({ version: v, score });
    }
    return { modelId, label: modelLabels[modelId] || modelId, color: CHART_COLORS[idx % CHART_COLORS.length], points };
  });

  const W = 600, H = 250, PAD = { top: 20, right: 20, bottom: 30, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xRange = Math.max(1, versionNums[versionNums.length - 1] - versionNums[0]);
  const xScale = (v) => PAD.left + ((v - versionNums[0]) / xRange) * plotW;
  const yScale = (s) => PAD.top + plotH - (s / 100) * plotH;

  const svgLines = lines.map(line => {
    if (line.points.length === 0) return null;
    const pathD = line.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.version).toFixed(1)} ${yScale(p.score).toFixed(1)}`).join(' ');
    return { ...line, pathD };
  }).filter(Boolean);

  return html`
    <div class="fnd-cal-chart">
      <div class="fnd-cal-chart-header">
        <span class="fnd-cal-chart-title">${viewMode === 'overall' ? t('profile.calibrator.chartOverall') : viewMode}</span>
        <select value=${viewMode} onChange=${e => setViewMode(e.target.value)} style="font-size:0.8rem;padding:0.2rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);">
          <option value="overall">${t('profile.calibrator.chartOverall')}</option>
          ${(dimensions || []).map(d => html`<option value=${d.name}>${d.name}</option>`)}
        </select>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;">
        ${[0, 25, 50, 75, 100].map(pct => html`
          <line x1=${PAD.left} y1=${yScale(pct)} x2=${W - PAD.right} y2=${yScale(pct)} stroke="var(--border)" stroke-width="0.5" />
          <text x=${PAD.left - 5} y=${yScale(pct) + 4} text-anchor="end" fill="var(--text-dim)" font-size="10">${pct}%</text>
        `)}
        ${versionNums.map(v => html`
          <text x=${xScale(v)} y=${H - 5} text-anchor="middle" fill="var(--text-dim)" font-size="10">v${v}</text>
        `)}
        ${svgLines.map(line => html`
          <path d=${line.pathD} fill="none" stroke=${line.color} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          ${line.points.map(p => html`
            <circle cx=${xScale(p.version)} cy=${yScale(p.score)} r="4" fill=${line.color} stroke="var(--card)" stroke-width="2">
              <title>${line.label}: ${p.score}% (v${p.version})</title>
            </circle>
          `)}
        `)}
      </svg>
      <div class="fnd-cal-chart-legend">
        ${svgLines.map(line => html`
          <div class="fnd-cal-chart-legend-item">
            <span class="fnd-cal-chart-legend-dot" style=${'background:' + line.color}></span>
            <span>${line.label}</span>
          </div>
        `)}
      </div>
    </div>
  `;
}

// ── LLM Config Editor (provider + key + model) ──

function LlmConfigEditor({ config, onChange, onRemove, label }) {
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [collapsed, setCollapsed] = useState(!!config.modelId);

  const provider = config.provider || 'openrouter';
  const baseUrl = config.baseUrl || '';
  const modelId = config.modelId || '';
  const hasKey = config.apiKeyRef === 'shared' || !!config.hasApiKey;

  useEffect(() => { if (hasKey) loadModels(); }, [provider, baseUrl, hasKey]);

  async function loadModels() {
    setModelsLoading(true);
    try {
      const resp = await apiGet('/v1/openrouter/models');
      if (resp.data?.models) setModels(resp.data.models);
    } catch { setModels([]); }
    setModelsLoading(false);
  }

  function update(fields) {
    onChange({ ...config, ...fields });
  }

  function handleProviderChange(p) {
    const updates = { provider: p };
    if (p === 'lmstudio') updates.baseUrl = 'http://localhost:1234/v1';
    else if (p === 'openrouter') { updates.baseUrl = 'https://openrouter.ai/api/v1'; updates.apiKeyRef = 'shared'; }
    else updates.baseUrl = '';
    update(updates);
  }

  async function handleSaveKey() {
    if (!apiKeyInput.trim()) return;
    try {
      // Save key via shared OpenRouter settings endpoint
      await apiPut('/v1/openrouter/settings', { apiKey: apiKeyInput, provider, baseUrl });
      update({ apiKeyRef: 'shared', hasApiKey: true });
      setApiKeyInput('');
      loadModels();
    } catch (e) {
      console.warn('Failed to save key:', e.message);
    }
  }

  const displayLabel = config.label || modelId || label || t('profile.calibrator.selectModel');

  return html`
    <div class="fnd-cal-model-row" style="flex-direction:column;align-items:stretch;gap:0.5rem;">
      <!-- Header: model name + collapse + remove -->
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <span style="cursor:pointer;font-size:0.8rem;" onClick=${() => setCollapsed(!collapsed)}>${collapsed ? '\u25B6' : '\u25BC'}</span>
        <span class="fnd-cal-model-label" style="flex:1;">${displayLabel}</span>
        <span style="font-size:0.7rem;color:var(--text-dim);">${provider}</span>
        ${onRemove && html`<button class="fnd-cal-model-remove" onClick=${onRemove}>✕</button>`}
      </div>

      ${!collapsed && html`
        <div style="display:flex;flex-direction:column;gap:0.5rem;padding-left:1.25rem;">
          <!-- Provider -->
          <div style="display:flex;gap:0.75rem;font-size:0.8rem;">
            ${['openrouter', 'lmstudio', 'custom'].map(p => html`
              <label style="display:flex;align-items:center;gap:0.25rem;cursor:pointer;">
                <input type="radio" name=${'provider-' + config.id} value=${p}
                  checked=${provider === p}
                  onChange=${() => handleProviderChange(p)} />
                ${p === 'openrouter' ? 'OpenRouter' : p === 'lmstudio' ? 'LM Studio' : 'Custom'}
              </label>
            `)}
          </div>

          <!-- Base URL (non-openrouter) -->
          ${provider !== 'openrouter' && html`
            <input type="url" placeholder="Base URL (e.g. http://localhost:1234/v1)"
              value=${baseUrl}
              onInput=${e => update({ baseUrl: e.target.value })}
              style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:0.8rem;"
            />
          `}

          <!-- API Key -->
          ${!hasKey && html`
            <div style="display:flex;gap:0.35rem;">
              <input type="password" placeholder="API Key" autocomplete="off"
                value=${apiKeyInput}
                onInput=${e => setApiKeyInput(e.target.value)}
                style="flex:1;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:0.8rem;"
              />
              <button class="btn-ghost btn-sm" onClick=${handleSaveKey} disabled=${!apiKeyInput.trim()}>Save key</button>
            </div>
          `}
          ${hasKey && html`<div style="font-size:0.75rem;color:var(--success);">API key configured</div>`}

          <!-- Model dropdown -->
          ${modelsLoading
            ? html`<span style="font-size:0.8rem;color:var(--text-dim);">Loading models...</span>`
            : html`
              <select value=${modelId}
                onChange=${e => update({ modelId: e.target.value, label: e.target.selectedOptions[0]?.text || e.target.value })}
                style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text);font-size:0.8rem;">
                <option value="">${t('profile.calibrator.selectModel')}</option>
                ${models.map(m => html`<option value=${m.id}>${m.name || m.id}</option>`)}
              </select>
            `
          }
        </div>
      `}
    </div>
  `;
}

// ── Project List ──

function ProjectListView({ onSelect, showToast }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try { setProjects(await listProjects()); }
    catch { setProjects([]); }
    setLoading(false);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await createProject(newName.trim());
      setNewName('');
      onSelect(project.projectId);
    } catch (e) {
      showToast?.(e.message, true);
    }
    setCreating(false);
  }

  const filtered = showArchived ? projects : projects.filter(p => p.status !== 'archived');

  return html`
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="margin:0;">${t('profile.calibrator.title')}</h3>
        <label style="font-size:0.8rem;display:flex;align-items:center;gap:0.35rem;cursor:pointer;">
          <input type="checkbox" checked=${showArchived} onChange=${e => setShowArchived(e.target.checked)} />
          ${t('profile.calibrator.showArchived')}
        </label>
      </div>

      <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
        <input type="text"
          placeholder=${t('profile.calibrator.newProjectPlaceholder')}
          value=${newName}
          onInput=${e => setNewName(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && handleCreate()}
          style="flex:1;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);"
        />
        <button class="btn-primary" onClick=${handleCreate} disabled=${creating || !newName.trim()}>
          ${creating ? '...' : t('profile.calibrator.newProject')}
        </button>
      </div>

      ${loading ? html`<div style="text-align:center;padding:2rem;color:var(--text-dim);">...</div>` : ''}
      ${!loading && filtered.length === 0 ? html`<div style="text-align:center;padding:2rem;color:var(--text-dim);">${t('profile.calibrator.empty')}</div>` : ''}

      <div class="fnd-cal-list">
        ${filtered.map(p => html`
          <div class="fnd-cal-card" onClick=${() => onSelect(p.projectId)}>
            <div class="fnd-cal-card-header">
              <span class="fnd-cal-card-name">${p.name}</span>
              <span class="fnd-cal-card-version">v${p.currentVersion || 0}</span>
            </div>
            <div class="fnd-cal-card-meta">
              <span>${p.status}</span>
              <span>${(p.candidateModels || []).length} ${t('profile.calibrator.models')}</span>
              <span>${new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
}

// ── Detail View ──

function ProjectDetailView({ projectId, onBack, showToast }) {
  const [project, setProject] = useState(null);
  const [dimensions, setDimensions] = useState([]);
  const [versions, setVersions] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [targetOutput, setTargetOutput] = useState('');
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [changelog, setChangelog] = useState('');
  const [analysisTemplate, setAnalysisTemplate] = useState('');
  const [templateCollapsed, setTemplateCollapsed] = useState(true);
  const [runs, setRuns] = useState([]);
  const [running, setRunning] = useState(false);
  const [expandedRun, setExpandedRun] = useState(null);
  const [expandedRunDetail, setExpandedRunDetail] = useState(null);

  useEffect(() => { loadProject(); }, [projectId]);

  async function loadProject() {
    try {
      const { project: proj, dimensions: dims } = await getProject(projectId);
      setProject(proj);
      setDimensions(dims || []);
      setAnalysisTemplate(proj.analysisPromptTemplate || '');

      const vers = await listVersions(projectId);
      setVersions(vers);

      if (proj.currentVersion > 0) {
        const ver = await getVersion(projectId, proj.currentVersion);
        setCurrentVersion(ver);
        setPrompt(ver.prompt || '');
        setTargetOutput(ver.targetOutput || '');
        setSelectedVersion(ver.version);
      }

      setRuns(await listRuns(projectId));
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  async function handleSaveVersion() {
    if (!prompt.trim()) return;
    try {
      const ver = await createVersion(projectId, {
        prompt: prompt.trim(),
        targetOutput: targetOutput.trim(),
        changelog: changelog.trim() || 'Updated prompt',
      });
      setCurrentVersion(ver);
      setSelectedVersion(ver.version);
      setChangelog('');
      setVersions(await listVersions(projectId));
      const { project: proj } = await getProject(projectId);
      setProject(proj);
      showToast?.('Version ' + ver.version + ' saved');
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  async function handleVersionChange(v) {
    const ver = await getVersion(projectId, v);
    setCurrentVersion(ver);
    setPrompt(ver.prompt || '');
    setTargetOutput(ver.targetOutput || '');
    setSelectedVersion(ver.version);
  }

  async function handleUpdateProject(updates) {
    try {
      const proj = await updateProject(projectId, updates);
      setProject(proj);
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  function handleAddModel() {
    const newModel = {
      id: 'llm-' + Date.now().toString(36),
      label: '',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      modelId: '',
      apiKeyRef: 'shared',
      apiKey: null,
    };
    const updated = [...(project.candidateModels || []), newModel];
    handleUpdateProject({ candidateModels: updated });
  }

  function handleUpdateModel(index, updatedModel) {
    const updated = [...(project.candidateModels || [])];
    updated[index] = updatedModel;
    handleUpdateProject({ candidateModels: updated });
  }

  function handleRemoveModel(index) {
    const updated = (project.candidateModels || []).filter((_, i) => i !== index);
    handleUpdateProject({ candidateModels: updated });
  }

  async function handleSaveTemplate() {
    await handleUpdateProject({ analysisPromptTemplate: analysisTemplate });
    showToast?.('Analysis template saved');
  }

  function copyToClipboard(text, label) {
    navigator.clipboard.writeText(text).then(() => showToast?.(label + ' copied'));
  }

  async function handleRunAll(withAnalysis = false) {
    if (!project?.candidateModels?.length || !currentVersion) return;
    setRunning(true);

    for (const model of project.candidateModels) {
      if (!model.modelId) continue;
      try {
        const start = Date.now();
        const genResp = await apiPost('/v1/openrouter/complete', {
          projectId,
          prompt: currentVersion.prompt,
          model: model.modelId,
        });
        const durationMs = Date.now() - start;
        const output = genResp.data?.content || '';

        const run = await createRun(projectId, {
          promptVersion: currentVersion.version,
          candidateModelId: model.id,
          candidateModelLabel: model.label || model.modelId,
          output,
          durationMs,
        });

        if (withAnalysis && output && project.analysisPromptTemplate) {
          try {
            const analysisPrompt = project.analysisPromptTemplate
              .replace(/\{TARGET_OUTPUT\}/g, currentVersion.targetOutput || '')
              .replace(/\{CANDIDATE_OUTPUT\}/g, output)
              .replace(/\{MODEL_NAME\}/g, model.label || model.modelId)
              .replace(/\{PROMPT_USED\}/g, currentVersion.prompt || '');

            const reasoningModelId = project.reasoningLlm?.modelId;
            if (reasoningModelId) {
              const analysisResp = await apiPost('/v1/openrouter/complete', {
                projectId,
                prompt: analysisPrompt,
                model: reasoningModelId,
              });
              const analysisText = analysisResp.data?.content || '';

              let parsed = null;
              try {
                const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
                if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
              } catch { /* non-JSON analysis is acceptable */ }

              const dims = parsed?.dimensions || [];
              const score = dims.length > 0
                ? Math.round((dims.filter(d => d.pass).length / dims.length) * 100)
                : null;

              await updateRun(projectId, run.runId, {
                dimensions: dims,
                overallScore: score,
                analysis: parsed?.analysis || analysisText,
                proposals: parsed?.proposals || [],
              });
            }
          } catch (e) {
            console.warn('Analysis failed for', model.label, e.message);
          }
        }
      } catch (e) {
        console.warn('Run failed for', model.label, e.message);
        showToast?.(`${model.label}: ${e.message}`, true);
      }
    }

    setRuns(await listRuns(projectId));
    const { dimensions: dims } = await getProject(projectId);
    setDimensions(dims || []);
    setRunning(false);
    showToast?.('Calibration run complete');
  }

  async function handleApplyFixes(proposals) {
    if (!proposals?.length || !currentVersion) return;
    const reasoningModelId = project?.reasoningLlm?.modelId;
    if (!reasoningModelId) {
      showToast?.('Set a reasoning model first', true);
      return;
    }
    try {
      const fixPrompt = `Here is a prompt that needs improvement:\n\n---\n${currentVersion.prompt}\n---\n\nApply these proposed fixes:\n${proposals.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nReturn ONLY the modified prompt text. Do not add explanations, markdown fences, or commentary. Keep changes generic — do not add project-specific terms.`;

      const resp = await apiPost('/v1/openrouter/complete', {
        projectId,
        prompt: fixPrompt,
        model: reasoningModelId,
      });
      const newPrompt = resp.data?.content || '';
      if (newPrompt) {
        setPrompt(newPrompt);
        setChangelog('Applied proposed fixes: ' + proposals.slice(0, 3).map(p => p.substring(0, 60)).join('; '));
        showToast?.('Fixes applied — review and save as new version');
      }
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  async function toggleRunDetail(runId) {
    if (expandedRun === runId) {
      setExpandedRun(null);
      setExpandedRunDetail(null);
      return;
    }
    setExpandedRun(runId);
    try {
      const detail = await getRun(projectId, runId);
      setExpandedRunDetail(detail);
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  if (!project) return html`<div style="padding:2rem;text-align:center;color:var(--text-dim);">...</div>`;

  const scoreClass = (s) => s >= 80 ? 'pass' : s >= 50 ? 'mixed' : 'fail';

  return html`
    <div class="fnd-cal-detail">
      <button class="btn-ghost" onClick=${onBack}>\u2190 ${t('profile.calibrator.back')}</button>

      <div class="fnd-cal-header">
        <input type="text" value=${project.name}
          onBlur=${e => handleUpdateProject({ name: e.target.value })}
          onKeyDown=${e => e.key === 'Enter' && e.target.blur()}
        />
      </div>

      <!-- Reasoning LLM selector -->
      <div class="fnd-cal-section">
        <div class="fnd-cal-section-title">${t('profile.calibrator.reasoningModel')}</div>
        <div class="fnd-cal-section-body">
          <${LlmConfigEditor}
            config=${project.reasoningLlm || { id: 'reasoning', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyRef: 'shared', modelId: '', label: '' }}
            onChange=${cfg => handleUpdateProject({ reasoningLlm: cfg })}
            label=${t('profile.calibrator.reasoningModel')}
          />
        </div>
      </div>

      <!-- Prompt + Target (side by side) -->
      <div class="fnd-cal-editor">
        <div class="fnd-cal-editor-panel">
          <div class="fnd-cal-editor-label">${t('profile.calibrator.prompt')} (v${selectedVersion || 0})</div>
          <textarea value=${prompt} onInput=${e => setPrompt(e.target.value)} />
          <div class="fnd-cal-version-bar">
            <span>${t('profile.calibrator.version')}:</span>
            <select value=${selectedVersion || ''} onChange=${e => handleVersionChange(parseInt(e.target.value))}>
              ${versions.map(v => html`<option value=${v.version}>v${v.version} — ${v.changelog || ''}</option>`)}
            </select>
          </div>
          <div class="fnd-cal-editor-actions">
            <button class="btn-ghost btn-sm" onClick=${() => copyToClipboard(prompt, 'Prompt')}>${t('profile.calibrator.copy')}</button>
          </div>
        </div>
        <div class="fnd-cal-editor-panel">
          <div class="fnd-cal-editor-label">${t('profile.calibrator.targetOutput')}</div>
          <textarea value=${targetOutput} onInput=${e => setTargetOutput(e.target.value)} />
          <div class="fnd-cal-editor-actions">
            <button class="btn-ghost btn-sm" onClick=${() => copyToClipboard(targetOutput, 'Target')}>${t('profile.calibrator.copy')}</button>
          </div>
        </div>
      </div>

      <!-- Save new version -->
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <input type="text" placeholder=${t('profile.calibrator.changelogPlaceholder')} value=${changelog} onInput=${e => setChangelog(e.target.value)}
          style="flex:1;padding:0.4rem 0.75rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:0.85rem;" />
        <button class="btn-primary btn-sm" onClick=${handleSaveVersion} disabled=${!prompt.trim()}>
          ${t('profile.calibrator.saveNewVersion')}
        </button>
      </div>

      <!-- Analysis Template (collapsible) -->
      <div class=${'fnd-cal-section' + (templateCollapsed ? ' fnd-cal-collapsed' : '')}>
        <div class="fnd-cal-section-title" onClick=${() => setTemplateCollapsed(!templateCollapsed)}>
          ${templateCollapsed ? '\u25B6' : '\u25BC'} ${t('profile.calibrator.analysisTemplate')}
        </div>
        <div class="fnd-cal-section-body">
          <div style="font-size:0.75rem;color:var(--text-dim);margin-bottom:0.5rem;">${t('profile.calibrator.analysisTemplatePlaceholders')}</div>
          <textarea style="min-height:200px;width:100%;font-family:var(--font-mono);font-size:0.8rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:0.75rem;color:var(--text);resize:vertical;"
            value=${analysisTemplate} onInput=${e => setAnalysisTemplate(e.target.value)} />
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
            <button class="btn-primary btn-sm" onClick=${handleSaveTemplate}>${t('profile.calibrator.save')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => copyToClipboard(analysisTemplate, 'Template')}>${t('profile.calibrator.copy')}</button>
          </div>
        </div>
      </div>

      <!-- Candidate Models -->
      <div class="fnd-cal-section">
        <div class="fnd-cal-section-title">
          ${t('profile.calibrator.candidateModels')}
          <button class="btn-ghost btn-sm" onClick=${handleAddModel}>${t('profile.calibrator.addModel')}</button>
        </div>
        <div class="fnd-cal-section-body">
          <div class="fnd-cal-models">
            ${(project.candidateModels || []).map((m, i) => html`
              <${LlmConfigEditor}
                config=${m}
                onChange=${updated => handleUpdateModel(i, updated)}
                onRemove=${() => handleRemoveModel(i)}
              />
            `)}
          </div>
          ${(project.candidateModels || []).length > 0 && currentVersion ? html`
            <div class="fnd-cal-actions">
              <button class="btn-primary" onClick=${() => handleRunAll(false)} disabled=${running}>
                ${running ? t('profile.calibrator.running') : t('profile.calibrator.runAll')}
              </button>
              <button class="btn-primary" onClick=${() => handleRunAll(true)} disabled=${running}>
                ${running ? t('profile.calibrator.analyzing') : t('profile.calibrator.runAllAnalyze')}
              </button>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Results: Chart + Run History -->
      <div class="fnd-cal-section">
        <div class="fnd-cal-section-title">${t('profile.calibrator.results')}</div>
        <div class="fnd-cal-section-body">
          ${runs.length === 0 ? html`
            <div style="text-align:center;padding:1rem;color:var(--text-dim);">${t('profile.calibrator.noRuns')}</div>
          ` : html`
            <${CalibrationChart} runs=${runs} dimensions=${dimensions} versions=${versions} />

            <div class="fnd-cal-runs" style="margin-top:1rem;">
              ${runs.map(r => html`
                <div class="fnd-cal-run">
                  <div class="fnd-cal-run-header" onClick=${() => toggleRunDetail(r.runId)}>
                    <div class="fnd-cal-run-summary">
                      <span class="fnd-cal-run-model">${r.candidateModelLabel}</span>
                      <span>v${r.promptVersion}</span>
                      ${r.overallScore != null ? html`
                        <span class=${'fnd-cal-run-score ' + scoreClass(r.overallScore)}>${r.overallScore}%</span>
                      ` : ''}
                      <span class="fnd-cal-run-time">${((r.durationMs || 0) / 1000).toFixed(1)}s</span>
                    </div>
                    <div class="fnd-cal-run-dims">
                      ${(r.dimensions || []).map(d => html`
                        <span class=${'fnd-cal-dim-badge ' + (d.pass ? 'pass' : 'fail')}>${d.name}</span>
                      `)}
                    </div>
                  </div>
                  ${expandedRun === r.runId && expandedRunDetail ? html`
                    <div class="fnd-cal-run-detail">
                      ${expandedRunDetail.analysis ? html`
                        <div style="margin-bottom:0.75rem;">
                          <strong>${t('profile.calibrator.viewAnalysis')}</strong>
                          <pre>${expandedRunDetail.analysis}</pre>
                        </div>
                      ` : ''}
                      ${expandedRunDetail.proposals?.length ? html`
                        <div style="margin-bottom:0.75rem;">
                          <strong>${t('profile.calibrator.proposals')}</strong>
                          <ul>${expandedRunDetail.proposals.map(p => html`<li>${p}</li>`)}</ul>
                        </div>
                      ` : ''}
                      <details>
                        <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-dim);">${t('profile.calibrator.viewOutput')}</summary>
                        <pre>${expandedRunDetail.output}</pre>
                      </details>
                      <div class="fnd-cal-run-actions">
                        ${expandedRunDetail.proposals?.length ? html`
                          <button class="btn-primary btn-sm" onClick=${() => handleApplyFixes(expandedRunDetail.proposals)}>
                            ${t('profile.calibrator.applyFixes')}
                          </button>
                        ` : ''}
                        <button class="btn-ghost btn-sm" onClick=${() => copyToClipboard(expandedRunDetail.output, 'Output')}>${t('profile.calibrator.copy')} output</button>
                        ${expandedRunDetail.analysis ? html`
                          <button class="btn-ghost btn-sm" onClick=${() => copyToClipboard(expandedRunDetail.analysis, 'Analysis')}>${t('profile.calibrator.copy')} analysis</button>
                        ` : ''}
                      </div>
                    </div>
                  ` : ''}
                </div>
              `)}
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

// ── Root Component ──

export default function CalibratorTab({ session, showToast }) {
  const [view, setView] = useState('list');
  const [activeProjectId, setActiveProjectId] = useState(null);

  function handleSelect(projectId) {
    setActiveProjectId(projectId);
    setView('detail');
  }

  if (view === 'detail' && activeProjectId) {
    return html`<${ProjectDetailView}
      projectId=${activeProjectId}
      onBack=${() => { setView('list'); setActiveProjectId(null); }}
      showToast=${showToast}
    />`;
  }

  return html`<${ProjectListView} onSelect=${handleSelect} showToast=${showToast} />`;
}
