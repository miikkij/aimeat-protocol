/**
 * @file calibrator-tab.js
 * @description Prompt Calibrator — list and detail views for calibration projects.
 * @structure
 *   - CalibratorTab (root) — view state machine: list | detail
 *   - ProjectListView — shows all calibration projects
 *   - ProjectDetailView — prompt editor, models, results, chart
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial implementation
 *   v1.1.0 — 2026-03-29 — Extract LlmConfigEditor and CalibrationChart into separate files
 */

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPut } from '/js/api.js';
import LlmConfigEditor from '/views/profile/calibrator-llm-editor.js';
import CalibrationChart from '/views/profile/calibrator-chart.js';
import {
  listProjects, createProject, getProject, updateProject, deleteProject,
  listVersions, getVersion, createVersion,
  listBatches, getBatch, createBatch, updateBatch, deleteBatch,
  getTemplateDefaults,
} from '/js/services/calibrator.js';


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

  const [runProgress, setRunProgress] = useState('');

  async function handleRunAll(withAnalysis = false) {
    if (!project?.candidateModels?.length || !currentVersion) return;
    setRunning(true);
    const totalModels = project.candidateModels.filter(m => m.modelId).length;
    let completed = 0;

    for (const model of project.candidateModels) {
      if (!model.modelId) continue;
      const modelName = model.label || model.modelId;
      try {
        // Step 1: Generate
        setRunProgress(`Generating: ${modelName} (${completed + 1}/${totalModels})...`);
        const start = Date.now();
        const output = await callModel(projectId, currentVersion.prompt, model.modelId);
        const durationMs = Date.now() - start;

        const run = await createRun(projectId, {
          promptVersion: currentVersion.version,
          candidateModelId: model.id,
          candidateModelLabel: modelName,
          output,
          durationMs,
        });

        // Step 2: Analyze
        if (withAnalysis && output && project.analysisPromptTemplate) {
          try {
            setRunProgress(`Analyzing: ${modelName} (${completed + 1}/${totalModels})...`);
            const analysisPrompt = project.analysisPromptTemplate
              .replace(/\{TARGET_OUTPUT\}/g, currentVersion.targetOutput || '')
              .replace(/\{CANDIDATE_OUTPUT\}/g, output)
              .replace(/\{MODEL_NAME\}/g, modelName)
              .replace(/\{PROMPT_USED\}/g, currentVersion.prompt || '');

            const reasoningModelId = project.reasoningLlm?.modelId;
            if (reasoningModelId) {
              const analysisText = await callModel(projectId, analysisPrompt, reasoningModelId);

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
                // Store logs for debugging
                logs: {
                  generationPrompt: currentVersion.prompt,
                  generationModel: model.modelId,
                  analysisPrompt,
                  analysisModel: reasoningModelId,
                  analysisRawResponse: analysisText,
                },
              });
            }
          } catch (e) {
            console.warn('Analysis failed for', modelName, e.message);
          }
        }
        completed++;
      } catch (e) {
        console.warn('Run failed for', modelName, e.message);
        showToast?.(`${modelName}: ${e.message}`, true);
        completed++;
      }
    }

    setRunProgress('');
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

      const newPrompt = await callModel(projectId, fixPrompt, reasoningModelId);
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
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;">
            <button class="btn-primary btn-sm" onClick=${handleSaveTemplate}>${t('profile.calibrator.save')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => { setAnalysisTemplate(DEFAULT_ANALYSIS_TEMPLATE); }}>${t('profile.calibrator.resetTemplate')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => copyToClipboard(analysisTemplate, 'Template')}>${t('profile.calibrator.copy')}</button>
            ${currentVersion && html`
              <button class="btn-ghost btn-sm" onClick=${() => {
                const composed = analysisTemplate
                  .replace(/\{TARGET_OUTPUT\}/g, currentVersion.targetOutput || '[paste target output here]')
                  .replace(/\{CANDIDATE_OUTPUT\}/g, '[paste candidate output here]')
                  .replace(/\{MODEL_NAME\}/g, '[model name]')
                  .replace(/\{PROMPT_USED\}/g, currentVersion.prompt || '[paste prompt here]');
                copyToClipboard(composed, 'Composed analysis prompt');
              }}>${t('profile.calibrator.copyComposed')}</button>
            `}
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
            <div class="fnd-cal-actions" style="flex-direction:column;align-items:center;gap:0.35rem;">
              <div style="display:flex;gap:0.5rem;">
                <button class="btn-primary" onClick=${() => handleRunAll(false)} disabled=${running}>
                  ${running ? t('profile.calibrator.running') : t('profile.calibrator.runAll')}
                </button>
                <button class="btn-primary" onClick=${() => handleRunAll(true)} disabled=${running}>
                  ${running ? t('profile.calibrator.analyzing') : t('profile.calibrator.runAllAnalyze')}
                </button>
              </div>
              ${runProgress && html`<div style="font-size:0.8rem;color:var(--accent);font-weight:500;">${runProgress}</div>`}
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
                        <span class=${'fnd-cal-dim-badge ' + (d.pass ? 'pass' : 'fail')}
                          title=${d.pass ? `${d.name}: PASS` : `${d.name}: expected "${d.expected}" got "${d.actual}"`}>
                          ${d.pass ? '\u2713' : '\u2717'} ${d.name}
                        </span>
                      `)}
                    </div>
                  </div>
                  ${expandedRun === r.runId && expandedRunDetail ? html`
                    <div class="fnd-cal-run-detail">
                      <!-- Dimension details table -->
                      ${expandedRunDetail.dimensions?.length ? html`
                        <div style="margin-bottom:0.75rem;">
                          <strong>${t('profile.calibrator.dimensions')}</strong>
                          <table style="width:100%;font-size:0.8rem;border-collapse:collapse;margin-top:0.35rem;">
                            <thead>
                              <tr style="text-align:left;border-bottom:1px solid var(--border);">
                                <th style="padding:0.3rem 0.5rem;"></th>
                                <th style="padding:0.3rem 0.5rem;">Dimension</th>
                                <th style="padding:0.3rem 0.5rem;">Expected</th>
                                <th style="padding:0.3rem 0.5rem;">Actual</th>
                                <th style="padding:0.3rem 0.5rem;">Severity</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${expandedRunDetail.dimensions.map(d => html`
                                <tr style="border-bottom:1px solid var(--border);">
                                  <td style="padding:0.3rem 0.5rem;">${d.pass ? html`<span style="color:var(--success);">\u2713</span>` : html`<span style="color:var(--danger);">\u2717</span>`}</td>
                                  <td style="padding:0.3rem 0.5rem;font-weight:500;" title=${d.description || ''}>${d.name}</td>
                                  <td style="padding:0.3rem 0.5rem;color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title=${d.expected || ''}>${d.expected || '-'}</td>
                                  <td style="padding:0.3rem 0.5rem;color:${d.pass ? 'var(--success)' : 'var(--danger)'};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title=${d.actual || ''}>${d.actual || '-'}</td>
                                  <td style="padding:0.3rem 0.5rem;font-size:0.7rem;color:var(--text-dim);">${d.severity || ''}</td>
                                </tr>
                              `)}
                            </tbody>
                          </table>
                        </div>
                      ` : ''}

                      <!-- Analysis text -->
                      ${expandedRunDetail.analysis ? html`
                        <div style="margin-bottom:0.75rem;">
                          <strong>${t('profile.calibrator.viewAnalysis')}</strong>
                          <pre>${expandedRunDetail.analysis}</pre>
                        </div>
                      ` : ''}

                      <!-- Proposals -->
                      ${expandedRunDetail.proposals?.length ? html`
                        <div style="margin-bottom:0.75rem;">
                          <strong>${t('profile.calibrator.proposals')}</strong>
                          <ul>${expandedRunDetail.proposals.map(p => html`<li>${p}</li>`)}</ul>
                        </div>
                      ` : ''}

                      <!-- Logs: prompts sent, raw responses -->
                      <details style="margin-bottom:0.5rem;">
                        <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-dim);">${t('profile.calibrator.viewOutput')} (model response)</summary>
                        <pre>${expandedRunDetail.output}</pre>
                      </details>
                      ${expandedRunDetail.logs ? html`
                        <details style="margin-bottom:0.5rem;">
                          <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-dim);">View generation prompt sent to model</summary>
                          <div style="font-size:0.75rem;color:var(--text-dim);padding:0.25rem 0;">Model: ${expandedRunDetail.logs.generationModel}</div>
                          <pre>${expandedRunDetail.logs.generationPrompt}</pre>
                        </details>
                        <details style="margin-bottom:0.5rem;">
                          <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-dim);">View analysis prompt sent to reasoning model</summary>
                          <div style="font-size:0.75rem;color:var(--text-dim);padding:0.25rem 0;">Model: ${expandedRunDetail.logs.analysisModel}</div>
                          <pre>${expandedRunDetail.logs.analysisPrompt}</pre>
                        </details>
                        <details style="margin-bottom:0.5rem;">
                          <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-dim);">View raw analysis response</summary>
                          <pre>${expandedRunDetail.logs.analysisRawResponse}</pre>
                        </details>
                      ` : ''}

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
                        ${expandedRunDetail.logs?.analysisPrompt ? html`
                          <button class="btn-ghost btn-sm" onClick=${() => copyToClipboard(expandedRunDetail.logs.analysisPrompt, 'Analysis prompt')}>${t('profile.calibrator.copy')} analysis prompt</button>
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
