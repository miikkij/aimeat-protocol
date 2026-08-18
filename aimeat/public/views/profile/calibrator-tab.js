/**
 * @file calibrator-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Prompt Calibrator V2 — list and detail views for calibration projects.
 *   Uses batch-based 4-step flow: Generation, Analysis, Reflection (dual), Synthesis.
 * @structure
 *   - CalibratorTab (root) — view state machine: list | detail
 *   - ProjectListView — project cards with batchCount + score bar
 *   - ProjectDetailView — 6-section layout for batch-based calibration
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial implementation
 *   v1.1.0 — 2026-03-29 — Extract LlmConfigEditor and CalibrationChart into separate files
 *   v2.0.0 — 2026-03-29 — V2 redesign: batch-based 4-step flow, score bars, template sections
 *   v2.1.0 — 2026-07-16 — Detail-view mount folds its 4-request waterfall into one GET /v1/calibrator/:id/detail
 *     (getProjectDetail); individual loaders kept as fallback + interactive re-fetch.
 *   v2.2.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiDelete } from '/js/api.js';
import { CopyButton } from '/components/CopyButton.js';
import { useConfirm } from '/components/Modal.js';
import LlmConfigEditor from '/views/profile/calibrator-llm-editor.js';
import CalibrationChart from '/views/profile/calibrator-chart.js';
import BatchCard from '/views/profile/calibrator-batch.js';
import { swallowed } from '/js/swallowed.js';
import {
  listProjects, createProject, getProject, getProjectDetail, updateProject, deleteProject,
  listVersions, getVersion, createVersion,
  listBatches, createBatch,
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
    catch (err) { swallowed('calibrator-tab', err); setProjects([]); }
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
      <div class="fnd-cal-list-header">
        <h3 class="fnd-cal-list-title">${t('profile.calibrator.title')}</h3>
        <label class="fnd-cal-archive-toggle">
          <input type="checkbox" checked=${showArchived} onChange=${e => setShowArchived(e.target.checked)} />
          ${t('profile.calibrator.showArchived')}
        </label>
      </div>

      <div class="fnd-cal-create-bar">
        <input type="text" class="fnd-cal-create-input"
          placeholder=${t('profile.calibrator.newProjectPlaceholder')}
          value=${newName}
          onInput=${e => setNewName(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && handleCreate()}
        />
        <button class="btn-primary" onClick=${handleCreate} disabled=${creating || !newName.trim()}>
          ${creating ? '...' : t('profile.calibrator.newProject')}
        </button>
      </div>

      ${loading ? html`<div class="fnd-cal-empty">...</div>` : ''}
      ${!loading && filtered.length === 0 ? html`<div class="fnd-cal-empty">${t('profile.calibrator.empty')}</div>` : ''}

      <div class="fnd-cal-list">
        ${filtered.map(p => html`
          <div class="fnd-cal-card" onClick=${() => onSelect(p.projectId)}>
            <div class="fnd-cal-card-header">
              <span class="fnd-cal-card-name">${p.name}</span>
              <span class="fnd-cal-card-version">v${p.currentVersion || 0}</span>
            </div>
            <div class="fnd-cal-card-meta">
              ${p.status === 'archived' ? html`<span class="fnd-cal-badge-archived">${t('profile.calibrator.archive')}</span>` : ''}
              <span>${(p.modelCount || 0)} ${t('profile.calibrator.models')}</span>
              <span>${(p.batchCount || 0)} ${t('profile.calibrator.runs')}</span>
              <span>${new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
            <div class="fnd-cal-card-score">
              <div class="fnd-cal-card-score-fill"
                style=${'width:' + (p.latestAvgScore != null ? p.latestAvgScore : 0) + '%'}>
              </div>
            </div>
            ${p.latestAvgScore != null ? html`
              <div class="fnd-cal-card-score-text">${p.latestAvgScore}% ${t('profile.calibrator.avgScore')}</div>
            ` : ''}
          </div>
        `)}
      </div>
    </div>
  `;
}


// ── Detail View ──

function ProjectDetailView({ projectId, onBack, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [project, setProject] = useState(null);
  const [dimensions, setDimensions] = useState([]);
  const [versions, setVersions] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [targetOutput, setTargetOutput] = useState('');
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [changelog, setChangelog] = useState('');
  const [templates, setTemplates] = useState({
    analysis: '', reflection: '', selfReflection: '', synthesis: '',
  });
  const [templateCollapsed, setTemplateCollapsed] = useState({
    analysis: true, reflection: true, selfReflection: true, synthesis: true,
  });
  const [batches, setBatches] = useState([]);
  const [autoRunBatchId, setAutoRunBatchId] = useState(null);

  // Reload when the selected projectId changes. loadProject closes over projectId
  // (listed) and showToast (error path only) — showToast is an unstable prop, so it
  // is intentionally not a trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadProject(); }, [projectId]);

  // SSE live updates
  useEffect(() => {
    const handler = () => { reloadBatches(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
    // Subscribe to live updates once on mount; a single stable listener is
    // intentional (not re-subscribing on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyProject(proj) {
    setProject(proj);
    setTemplates({
      analysis: proj.analysisPromptTemplate || '',
      reflection: proj.reflectionPromptTemplate || '',
      selfReflection: proj.selfReflectionPromptTemplate || '',
      synthesis: proj.synthesisPromptTemplate || '',
    });
  }

  // Data migration: clean up old V1 run keys (silently). One-time legacy cleanup, kept out of the mount
  // composite because it deletes.
  async function cleanupLegacyRuns() {
    try {
      const resp = await apiGet(`/v1/memory?prefix=calibrator.${projectId}.run.&tags=calibrator,run`);
      const oldRuns = resp?.data?.entries || [];
      for (const r of oldRuns) {
        try { await apiDelete(`/v1/memory/${encodeURIComponent(r.key)}`); } catch (err) { swallowed('calibrator-tab: cleanupLegacyRuns', err); }
      }
    } catch (err) { swallowed('calibrator-tab: cleanupLegacyRuns', err); }
  }

  // Fallback path: the individual four-request waterfall, used when the composite is unavailable.
  async function loadProjectIndividually() {
    const { project: proj, dimensions: dims } = await getProject(projectId);
    applyProject(proj);
    setDimensions(dims || []);
    const vers = await listVersions(projectId);
    setVersions(vers);
    if (proj.currentVersion > 0) {
      const ver = await getVersion(projectId, proj.currentVersion);
      setCurrentVersion(ver);
      setPrompt(ver.prompt || '');
      setTargetOutput(ver.targetOutput || '');
      setSelectedVersion(ver.version);
    }
    setBatches(await listBatches(projectId));
  }

  async function loadProject() {
    try {
      // Composite mount: project + dimensions + versions + current version + batches in one call.
      const detail = await getProjectDetail(projectId);
      if (detail?.project) {
        applyProject(detail.project);
        setDimensions(detail.dimensions || []);
        setVersions(detail.versions || []);
        if (detail.project.currentVersion > 0 && detail.currentVersion) {
          const ver = detail.currentVersion;
          setCurrentVersion(ver);
          setPrompt(ver.prompt || '');
          setTargetOutput(ver.targetOutput || '');
          setSelectedVersion(ver.version);
        }
        setBatches(detail.batches || []);
      } else {
        await loadProjectIndividually();
      }
      await cleanupLegacyRuns();
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  async function reloadBatches() {
    try {
      setBatches(await listBatches(projectId));
      const { project: p, dimensions: d } = await getProject(projectId);
      setProject(p);
      setDimensions(d || []);
      // Reload versions in case apply-selected created a new one
      const vers = await listVersions(projectId);
      setVersions(vers);
      if (p.currentVersion > 0 && p.currentVersion !== selectedVersion) {
        const v = await getVersion(projectId, p.currentVersion);
        setCurrentVersion(v);
        setPrompt(v.prompt || '');
        setTargetOutput(v.targetOutput || '');
        setSelectedVersion(p.currentVersion);
      }
    } catch (err) { swallowed('calibrator-tab: reloadBatches', err); }
  }

  async function handleUpdateProject(updates) {
    try {
      const proj = await updateProject(projectId, updates);
      setProject(proj);
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  const isReadOnly = selectedVersion !== null && selectedVersion !== project?.currentVersion;

  async function handleVersionChange(v) {
    const vNum = Number(v);
    setSelectedVersion(vNum);
    const ver = await getVersion(projectId, vNum);
    setCurrentVersion(ver);
    setPrompt(ver.prompt || '');
    setTargetOutput(ver.targetOutput || '');
    setChangelog('');
  }

  async function handleSaveVersion() {
    if (!prompt.trim() || isReadOnly) return;
    try {
      const ver = await createVersion(projectId, {
        prompt: prompt.trim(),
        targetOutput: targetOutput.trim(),
        changelog: changelog.trim() || 'Updated prompt',
      });
      setCurrentVersion(ver);
      setSelectedVersion(ver.version);
      setVersions(await listVersions(projectId));
      setChangelog('');
      const updated = await getProject(projectId);
      setProject(updated.project);
      showToast?.('Version saved');
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

  async function handleNewRun(runAllSteps = false) {
    if (!project.currentVersion || !selectedVersion) return;
    try {
      const batch = await createBatch(projectId, selectedVersion);
      setBatches(prev => [batch, ...prev]);
      if (runAllSteps) {
        // Use a unique timestamp to force useEffect to re-fire even for consecutive clicks
        setAutoRunBatchId(batch.batchId + ':' + Date.now());
      }
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  async function handleSaveTemplate(field, value) {
    const fieldMap = {
      analysis: 'analysisPromptTemplate',
      reflection: 'reflectionPromptTemplate',
      selfReflection: 'selfReflectionPromptTemplate',
      synthesis: 'synthesisPromptTemplate',
    };
    await handleUpdateProject({ [fieldMap[field]]: value });
    showToast?.('Template saved');
  }

  async function handleResetTemplate(field) {
    try {
      const defaults = await getTemplateDefaults();
      const defaultMap = {
        analysis: defaults.analysisPromptTemplate || '',
        reflection: defaults.reflectionPromptTemplate || '',
        selfReflection: defaults.selfReflectionPromptTemplate || '',
        synthesis: defaults.synthesisPromptTemplate || '',
      };
      setTemplates(prev => ({ ...prev, [field]: defaultMap[field] }));
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  async function handleArchive() {
    await handleUpdateProject({ status: 'archived' });
    onBack();
  }

  function handleDelete() {
    confirm(t('profile.calibrator.deleteConfirm'), async () => {
      try {
        await deleteProject(projectId);
        onBack();
      } catch (e) {
        showToast?.(e.message, true);
      }
    }, { danger: true });
  }

  if (!project) return html`<div class="fnd-cal-empty">...</div>`;

  const hasModels = (project.candidateModels || []).some(m => m.modelId);
  const hasVersion = !!project.currentVersion;

  // Template configuration: field key, i18n label key, i18n placeholders key
  const templateConfig = [
    { field: 'analysis', label: 'profile.calibrator.analysisTemplate', placeholders: 'profile.calibrator.analysisTemplatePlaceholders' },
    { field: 'reflection', label: 'profile.calibrator.reflectionTemplate', placeholders: 'profile.calibrator.reflectionPlaceholders' },
    { field: 'selfReflection', label: 'profile.calibrator.selfReflectionTemplate', placeholders: 'profile.calibrator.reflectionPlaceholders' },
    { field: 'synthesis', label: 'profile.calibrator.synthesisTemplate', placeholders: 'profile.calibrator.synthesisPlaceholders' },
  ];

  return html`
    <div class="fnd-cal-detail">

      <!-- Section 1: Header -->
      <div class="fnd-cal-header">
        <button class="btn-ghost" onClick=${onBack}>\u2190 ${t('profile.calibrator.back')}</button>
        <input type="text" value=${project.name}
          onBlur=${e => handleUpdateProject({ name: e.target.value })}
          onKeyDown=${e => e.key === 'Enter' && e.target.blur()}
        />
        <div class="fnd-cal-header-actions">
          <button class="btn-ghost btn-sm" onClick=${handleArchive}>${t('profile.calibrator.archive')}</button>
          <button class="btn-danger btn-sm" onClick=${handleDelete}>${t('profile.calibrator.delete')}</button>
        </div>
      </div>

      <!-- Section 2: Reasoning LLM -->
      <div class="fnd-cal-section">
        <div class="fnd-cal-section-title">${t('profile.calibrator.reasoningModel')}</div>
        <div class="fnd-cal-section-body">
          <${LlmConfigEditor}
            config=${project.reasoningLlm || { id: 'reasoning', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyRef: 'shared', modelId: '', label: '' }}
            onChange=${cfg => handleUpdateProject({ reasoningLlm: cfg })}
            label=${t('profile.calibrator.reasoningModel')}
          />
          ${!project.reasoningLlm?.modelId ? html`
            <div class="fnd-cal-warning">${t('profile.calibrator.setReasoningModel')}</div>
          ` : ''}
        </div>
      </div>

      <!-- Section 3: Prompt + Target (side-by-side) -->
      <div class="fnd-cal-section">
        <div class="fnd-cal-section-title">${t('profile.calibrator.prompt')} + ${t('profile.calibrator.targetOutput')}</div>
        <div class="fnd-cal-section-body">
          <div class="fnd-cal-version-bar">
            <span>${t('profile.calibrator.version')}:</span>
            <select value=${selectedVersion || ''} onChange=${e => handleVersionChange(e.target.value)}>
              ${versions.map(v => html`<option value=${v.version}>v${v.version} — ${v.changelog || ''}</option>`)}
            </select>
            ${isReadOnly ? html`<span class="fnd-cal-readonly-badge">read-only</span>` : ''}
          </div>

          <div class="fnd-cal-editor">
            <div class="fnd-cal-editor-panel">
              <div class="fnd-cal-editor-label">${t('profile.calibrator.prompt')} (v${selectedVersion || 0})</div>
              <textarea value=${prompt} onInput=${e => setPrompt(e.target.value)} disabled=${isReadOnly} />
              <div class="fnd-cal-editor-actions">
                <${CopyButton} text=${prompt} label=${t('common.copy')} className="btn-sm" onCopied=${() => showToast?.('Prompt copied')} />
              </div>
            </div>
            <div class="fnd-cal-editor-panel">
              <div class="fnd-cal-editor-label">${t('profile.calibrator.targetOutput')}</div>
              <textarea value=${targetOutput} onInput=${e => setTargetOutput(e.target.value)} disabled=${isReadOnly} />
              <div class="fnd-cal-editor-actions">
                <${CopyButton} text=${targetOutput} label=${t('common.copy')} className="btn-sm" onCopied=${() => showToast?.('Target copied')} />
              </div>
            </div>
          </div>

          <div class="fnd-cal-save-version-bar">
            <input type="text" class="fnd-cal-changelog-input"
              placeholder=${t('profile.calibrator.changelogPlaceholder')}
              value=${changelog}
              onInput=${e => setChangelog(e.target.value)}
              disabled=${isReadOnly}
            />
            <button class="btn-primary btn-sm" onClick=${handleSaveVersion} disabled=${!prompt.trim() || isReadOnly}>
              ${t('profile.calibrator.saveNewVersion')}
            </button>
          </div>
        </div>
      </div>

      <!-- Section 4: Prompt Templates (collapsible) -->
      <div class="fnd-cal-section">
        <div class="fnd-cal-section-title">${t('profile.calibrator.analysisTemplate')}</div>
        <div class="fnd-cal-section-body">
          <div class="fnd-cal-templates">
            ${templateConfig.map(tc => html`
              <details class="fnd-cal-template-details" open=${!templateCollapsed[tc.field]}
                onToggle=${e => {
                  if (e.target === e.currentTarget) {
                    setTemplateCollapsed(prev => ({ ...prev, [tc.field]: !e.target.open }));
                  }
                }}>
                <summary>${t(tc.label)}</summary>
                <div class="fnd-cal-template-body">
                  <div class="fnd-cal-template-hint">${t(tc.placeholders)}</div>
                  <textarea class="fnd-cal-template-textarea"
                    value=${templates[tc.field]}
                    onInput=${e => setTemplates(prev => ({ ...prev, [tc.field]: e.target.value }))}
                  />
                  <div class="fnd-cal-template-actions">
                    <button class="btn-primary btn-sm" onClick=${() => handleSaveTemplate(tc.field, templates[tc.field])}>
                      ${t('profile.calibrator.save')}
                    </button>
                    <button class="btn-ghost btn-sm" onClick=${() => handleResetTemplate(tc.field)}>
                      ${t('profile.calibrator.resetTemplate')}
                    </button>
                    <${CopyButton} text=${templates[tc.field]} label=${t('common.copy')} className="btn-sm" onCopied=${() => showToast?.('Template copied')} />
                  </div>
                </div>
              </details>
            `)}
          </div>
        </div>
      </div>

      <!-- Section 5: Candidate Models -->
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

          <div class="fnd-cal-actions">
            ${!hasModels ? html`<div class="fnd-cal-hint">${t('profile.calibrator.addModelsFirst')}</div>` : ''}
            ${!hasVersion ? html`<div class="fnd-cal-hint">${t('profile.calibrator.saveVersionFirst')}</div>` : ''}
            ${hasModels && hasVersion ? html`
              <button class="btn-primary" onClick=${() => handleNewRun(false)}>
                ${t('profile.calibrator.newRun')}
              </button>
              <button class="btn-primary" onClick=${() => handleNewRun(true)}>
                ${t('profile.calibrator.newRunAllSteps')}
              </button>
            ` : ''}
          </div>
        </div>
      </div>

      <!-- Section 6: Results -->
      <div class="fnd-cal-section">
        <div class="fnd-cal-section-title">${t('profile.calibrator.results')}</div>
        <div class="fnd-cal-section-body">
          ${batches.length === 0 ? html`
            <div class="fnd-cal-empty-inline">${t('profile.calibrator.noRuns')}</div>
          ` : html`
            <${CalibrationChart} batches=${batches} dimensions=${dimensions} />

            <div class="fnd-cal-runs">
              ${batches.map((b, i) => html`
                <${BatchCard}
                  batchSummary=${b}
                  index=${batches.length - i}
                  projectId=${projectId}
                  project=${project}
                  currentVersion=${currentVersion}
                  onUpdate=${() => reloadBatches()}
                  showToast=${showToast}
                  autoRunAll=${autoRunBatchId && autoRunBatchId.startsWith(b.batchId)}
                />
              `)}
            </div>
          `}
        </div>
      </div>

      <${ConfirmUI} />
    </div>
  `;
}


// ── Root Component ──

export default function CalibratorTab({ showToast }) {
  const [view, setView] = useState('list');
  const [activeProjectId, setActiveProjectId] = useState(null);

  if (view === 'detail' && activeProjectId) {
    return html`<${ProjectDetailView}
      projectId=${activeProjectId}
      onBack=${() => { setView('list'); setActiveProjectId(null); }}
      showToast=${showToast}
    />`;
  }
  return html`<${ProjectListView}
    onSelect=${id => { setActiveProjectId(id); setView('detail'); }}
    showToast=${showToast}
  />`;
}
