/**
 * @file generator-tab.js
 * @description Service Generator tab for the profile view — multi-phase UI for
 *   creating AIMEAT services via AI-assisted prompts. Includes requirements
 *   interview phase, blueprint generation, per-component generation with
 *   validation, and component registration (including cortex).
 * @structure
 *   - GeneratorTab: root component, view state machine, OpenRouter settings relay
 *   - ProjectListView: project CRUD, archive, pagination
 *   - NewProjectView: interview → blueprint creation flow
 *   - ProjectDashboard: main workspace — autopilot, lifecycle, edit mode, packaging, tests
 * @usage Loaded as a tab in the profile view SPA
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial generator tab
 *   v2.0.0 — 2026-03-14 — Add interview phase UI, cortex registration wiring,
 *     validateInterviewSpec integration, buildInterviewPrompt support
 *   v2.0.1 — 2026-03-15 — Fix session not passed to ComponentDetail (broke registration)
 *   v3.0.0 — 2026-03-15 — Add lifecycle management (activate/deactivate/launch/remove),
 *     edit service UI (impact analysis + targeted edit prompts), diagnostics panel
 *   v3.1.0 — 2026-03-17 — Editable project name, re-register button, button tooltips,
 *     detail panel background matching, improved spacing and button visibility
 *   v4.0.0 — 2026-03-17 — Add packaging bridge: "Package as Template" / "Update Package"
 *     buttons, packaging dialog with category/tags/visibility, change detection diff,
 *     fork attribution display, package link display in project header
 *   v4.1.0 — 2026-03-17 — Style unification: replace all inline styles with CSS classes, remove sidebar dots
 *   v4.2.0 — 2026-03-18 — Add agent selector UI and progress banner for agent-driven generation
 *   v4.2.1 — 2026-03-19 — Fix session state: check agentGaii presence, not just truthy value,
 *     to avoid treating auto-created empty {} from memory GET as an active session
 *   v4.3.0 — 2026-03-19 — Fix CSS bugs, add activity logging for all user actions
 *   v5.0.0 — 2026-03-20 — Remove agent UI components (replaced by OpenRouter autopilot)
 *   v5.1.0 — 2026-03-20 — Add OpenRouter settings UI (collapsible panel for API key, model, auto-retry)
 *   v5.2.0 — 2026-03-20 — Add autopilot buttons (Run with AI) to each step, auto-retry logic,
 *     and Run All Steps mode for sequential autopilot execution
 *   v5.3.0 — 2026-03-21 — Add provider selector (OpenRouter / LM Studio / Custom) with baseUrl field
 *   v5.4.0 — 2026-03-21 — Add SettingsCollectionView for blueprint settings between approval and generation
 *   v6.0.0 — 2026-03-21 — Add test execution UI (TestScopeSelector, TestResultsView),
 *     test fix loop integration with buildFixPrompt testContext, screenshot display
 *   v6.1.0 — 2026-03-21 — Fix testing system end-to-end:
 *     - Fix re-test passing testScope string instead of aiTestCode (critical bug)
 *     - Save testPrompt/testCode/testResult to component records for persistence
 *     - Add manual test UI in ComponentDetail (prompt, textarea, run button)
 *     - Replace stub bulk test with real per-component sequential testing
 *     - Add comprehensive activity logging at every test step
 *     - Add "Generate & run test with AI" button per component
 *   v7.0.0 — 2026-03-22 — Refactoring: extract ComponentDetail/test UI to generator-detail.js,
 *     OpenRouterSettings/SettingsCollectionView to generator-settings.js,
 *     AI utilities (runWithAi, stripCodeblock, cancelAiRequest) to generator-detail.js
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import {
  listProjects, getProject, createProject, updateProject, deleteProject, archiveProject,
  loadAllComponents, saveComponent,
  saveInterviewSpec, getInterviewSpec,
  getAppLaunchUrl,
  writeProjectLog,
} from '/js/services/generator.js';
import { buildBlueprintPrompt, buildBlueprintFixPrompt, buildInterviewPrompt } from '/js/services/generator-prompts.js';
import { validateBlueprint, validateComponent, validateInterviewSpec } from '/js/services/generator-validate.js';
import { useConfirm } from '/components/Modal.js';
import { OpenRouterSettings, SettingsCollectionView } from './generator-settings.js';
import { ComponentDetail, TestScopeSelector, TestResultsView, runWithAi, stripCodeblock } from './generator-detail.js';
import { usePackaging } from './generator-dashboard/use-packaging.js';
import { PackageDialog } from './generator-dashboard/PackageDialog.js';
import { useLifecycle } from './generator-dashboard/use-lifecycle.js';
import { RemovePanel } from './generator-dashboard/RemovePanel.js';
import { useAutopilotState } from './generator-dashboard/use-autopilot-state.js';
import { useDashboardCore } from './generator-dashboard/use-dashboard-core.js';
import { useTestExecution } from './generator-dashboard/use-test-execution.js';
import { useEditMode } from './generator-dashboard/use-edit-mode.js';
import { EditModePanel } from './generator-dashboard/EditModePanel.js';
import { useAutopilot } from './generator-dashboard/use-autopilot.js';

/* ── Sub-views ───────────────────────────────────────── */

function ProjectListView({ onSelect, onCreate, showToast, session }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try { setProjects(await listProjects()); }
    catch { setProjects([]); }
    setLoading(false);
  }

  async function handleArchive(e, p) {
    e.stopPropagation();
    await archiveProject(p.projectId);
    loadData();
  }

  if (loading) return html`<div class="pf-gen-loading">${t('profile.loading')}</div>`;

  const filtered = projects.filter(p => showArchived ? true : p.status !== 'archived');
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return html`
    <div class="pf-gen-project-list">
      <div class="pf-gen-header">
        <div class="section-title">${t('profile.generator.title')}</div>
        <div class="pf-gen-header-actions">
          <label class="pf-gen-archive-toggle">
            <input type="checkbox" checked=${showArchived} onChange=${e => { setShowArchived(e.target.checked); setPage(0); }} />
            ${t('profile.generator.showArchived')}
          </label>
          <button class="btn-primary" onClick=${onCreate}>+ ${t('profile.generator.newProject')}</button>
        </div>
      </div>
      ${filtered.length === 0 && html`
        <div class="pf-gen-empty">${t('profile.generator.empty')}</div>
      `}
      ${paged.map(p => html`
        <div class="pf-gen-project-card ${p.status === 'archived' ? 'archived' : ''}" onClick=${() => onSelect(p.projectId)}>
          <div class="pf-gen-project-name">${p.name}</div>
          <div class="pf-gen-project-meta">
            <span class="pf-gen-project-status">${p.status}</span>
            <span class="pf-gen-project-date">${p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '—'}</span>
            ${p.status !== 'archived' && html`
              <button class="btn-ghost btn-xs" onClick=${e => handleArchive(e, p)}>${t('profile.generator.archive')}</button>
            `}
          </div>
        </div>
      `)}
      ${totalPages > 1 && html`
        <div class="pf-gen-pagination">
          <button class="btn-ghost btn-sm" disabled=${page === 0} onClick=${() => setPage(page - 1)}>←</button>
          <span>${page + 1} / ${totalPages}</span>
          <button class="btn-ghost btn-sm" disabled=${page >= totalPages - 1} onClick=${() => setPage(page + 1)}>→</button>
        </div>
      `}
    </div>
  `;
}

function NewProjectView({ onBack, onCreated, showToast, orSettings }) {
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState('describe'); // describe | blueprint | review
  const [project, setProject] = useState(null);
  const [blueprintResult, setBlueprintResult] = useState('');
  const [blueprintErrors, setBlueprintErrors] = useState([]);
  const [interviewSpec, setInterviewSpec] = useState('');
  const [interviewErrors, setInterviewErrors] = useState([]);
  const [interviewParsed, setInterviewParsed] = useState(null);
  const [aiRunning, setAiRunning] = useState(null); // null | 'interview' | 'blueprint'

  async function handleAnalyze() {
    if (!description.trim()) return;
    try {
      const name = description.slice(0, 60).replace(/\n/g, ' ');
      const p = await createProject(name, description);
      await writeProjectLog(p.projectId, 'project_created', { meta: { name } });
      setProject(p);
      setPhase('interview');
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  async function handleCopyBlueprintPrompt() {
    // Fetch installed cortex libraries for the catalog
    let cortexLibs = null;
    try {
      const resp = await apiGet('/v1/cortex');
      if (resp.ok !== false && resp.data?.extensions) {
        cortexLibs = resp.data.extensions
          .filter(e => e.status === 'active')
          .map(e => ({ name: e.name, description: e.description, components: e.components }));
      }
    } catch { /* proceed without catalog */ }
    const prompt = buildBlueprintPrompt(description, interviewParsed, cortexLibs);
    navigator.clipboard.writeText(prompt).catch(() => {});
    showToast?.(t('profile.generator.blueprintPromptCopied'));
  }

  async function handleSubmitBlueprint() {
    const vr = validateBlueprint(blueprintResult);
    if (!vr.valid) {
      setBlueprintErrors(vr.errors);
      return;
    }
    try {
      await updateProject(project.projectId, { blueprint: vr.parsed, status: 'in_progress' });
      await writeProjectLog(project.projectId, 'blueprint_imported', { meta: { componentCount: vr.parsed.components.length } });
      // Initialize components from blueprint — skip existing ones to preserve progress
      const existing = await loadAllComponents(project.projectId);
      const existingIds = new Set(existing.map(c => c.id));
      for (const comp of vr.parsed.components) {
        if (existingIds.has(comp.id)) continue; // don't overwrite existing progress
        await saveComponent(project.projectId, {
          id: comp.id, type: comp.type, label: comp.label,
          status: 'not_started', prompt: null, result: null,
          validationErrors: [], registeredAs: null, history: [],
          _version: 0,
        });
      }
      onCreated({ ...project, blueprint: vr.parsed });
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  if (phase === 'interview') {
    function handleCopyInterviewPrompt() {
      const prompt = buildInterviewPrompt(description, getLocale());
      navigator.clipboard.writeText(prompt).catch(() => {});
      showToast?.(t('profile.generator.interviewPromptCopied'));
    }

    async function handleRunInterviewAi() {
      if (!project) return;
      setAiRunning('interview');
      try {
        const prompt = buildInterviewPrompt(description, getLocale());
        let content = await runWithAi(project.projectId, prompt);
        setInterviewSpec(content);
        // Auto-validate
        let vr = validateInterviewSpec(content);
        if (!vr.valid && orSettings?.autoRetry) {
          const max = orSettings.maxRetries || 3;
          for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
            showToast?.(t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
            const correctionPrompt = prompt + '\n\n--- PREVIOUS RESPONSE (HAD ERRORS) ---\n' + content + '\n\n--- VALIDATION ERRORS ---\n' + vr.errors.join('\n') + '\n\nPlease fix these errors and return the corrected response.';
            content = await runWithAi(project.projectId, correctionPrompt);
            setInterviewSpec(content);
            vr = validateInterviewSpec(content);
          }
        }
        if (vr.valid) {
          setInterviewErrors([]);
          setInterviewParsed(vr.parsed);
          await saveInterviewSpec(project.projectId, vr.parsed);
          await writeProjectLog(project.projectId, 'interview_imported', { meta: { by: 'autopilot' } });
          await updateProject(project.projectId, {
            interviewDone: true,
            enhancedDescription: vr.parsed.description,
          });
          showToast?.(t('profile.generator.openrouter.stepComplete'));
          setPhase('blueprint');
        } else {
          setInterviewErrors(vr.errors);
          showToast?.(t('profile.generator.openrouter.stepFailed'), true);
        }
      } catch (e) {
        showToast?.(e.message, true);
      }
      setAiRunning(null);
    }

    async function handleSubmitSpec() {
      const vr = validateInterviewSpec(interviewSpec);
      if (!vr.valid) {
        setInterviewErrors(vr.errors);
        return;
      }
      setInterviewErrors([]);
      setInterviewParsed(vr.parsed);
      await saveInterviewSpec(project.projectId, vr.parsed);
      await writeProjectLog(project.projectId, 'interview_imported');
      await updateProject(project.projectId, {
        interviewDone: true,
        enhancedDescription: vr.parsed.description,
      });
      showToast?.(t('profile.generator.specImported'));
      setPhase('blueprint');
    }

    function handleSkipInterview() {
      setPhase('blueprint');
    }

    return html`
      <div class="pf-gen-new-project">
        <button class="btn-outline" onClick=${() => setPhase('describe')}>
          ${t('profile.generator.back')}
        </button>
        <div class="section-title section-title-spaced">${t('profile.generator.interviewTitle')}</div>
        <div class="section-desc">
          ${t('profile.generator.interviewDesc')}
        </div>

        <div class="pf-gen-section">
          <label>${t('profile.generator.interviewPrompt')}</label>
          <div class="pf-gen-or-btn-row">
            <button class="btn-primary" onClick=${handleCopyInterviewPrompt}>
              ${t('profile.generator.copyPrompt')}
            </button>
            ${orSettings?.hasApiKey && html`
              <button class="btn-outline pf-gen-or-run-btn ${aiRunning === 'interview' ? 'pf-gen-or-running' : ''}"
                onClick=${handleRunInterviewAi}
                disabled=${aiRunning !== null}>
                ${aiRunning === 'interview'
                  ? html`<span class="pf-gen-or-spinner"></span> ${t('profile.generator.openrouter.waiting')}`
                  : t('profile.generator.openrouter.runWithAi')}
              </button>
            `}
          </div>
        </div>

        <div class="pf-gen-section">
          <label>${t('profile.generator.interviewResult')}</label>
          <textarea
            class="pf-gen-result-area"
            rows="14"
            placeholder=${t('profile.generator.interviewPlaceholder')}
            value=${interviewSpec}
            onInput=${e => setInterviewSpec(e.target.value)}
          />
        </div>

        ${interviewErrors.length > 0 && html`
          <div class="pf-gen-errors">
            <label>${t('profile.generator.errors')}</label>
            <ul>${interviewErrors.map(e => html`<li>${e}</li>`)}</ul>
          </div>
        `}

        <div class="pf-gen-actions">
          <button class="btn-primary" onClick=${handleSubmitSpec} disabled=${!interviewSpec.trim()}>
            ${t('profile.generator.importSpec')}
          </button>
          <button class="btn-outline" onClick=${handleSkipInterview}>
            ${t('profile.generator.skipInterview')}
          </button>
        </div>
      </div>
    `;
  }

  async function handleRunBlueprintAi() {
    if (!project) return;
    setAiRunning('blueprint');
    try {
      let cortexLibs = null;
      try {
        const resp = await apiGet('/v1/cortex');
        if (resp.ok !== false && resp.data?.extensions) {
          cortexLibs = resp.data.extensions
            .filter(e => e.status === 'active')
            .map(e => ({ name: e.name, description: e.description, components: e.components }));
        }
      } catch { /* proceed without catalog */ }
      const prompt = buildBlueprintPrompt(description, interviewParsed, cortexLibs);
      let content = await runWithAi(project.projectId, prompt);
      setBlueprintResult(content);
      // Auto-validate
      let vr = validateBlueprint(content);
      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          showToast?.(t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
          const fixPrompt = buildBlueprintFixPrompt(description, vr.errors, interviewParsed);
          content = await runWithAi(project.projectId, fixPrompt);
          setBlueprintResult(content);
          vr = validateBlueprint(content);
        }
      }
      if (vr.valid) {
        setBlueprintErrors([]);
        await updateProject(project.projectId, { blueprint: vr.parsed, status: 'in_progress' });
        await writeProjectLog(project.projectId, 'blueprint_imported', { meta: { componentCount: vr.parsed.components.length, by: 'autopilot' } });
        const existing = await loadAllComponents(project.projectId);
        const existingIds = new Set(existing.map(c => c.id));
        for (const comp of vr.parsed.components) {
          if (existingIds.has(comp.id)) continue;
          await saveComponent(project.projectId, {
            id: comp.id, type: comp.type, label: comp.label,
            status: 'not_started', prompt: null, result: null,
            validationErrors: [], registeredAs: null, history: [],
            _version: 0,
          });
        }
        showToast?.(t('profile.generator.openrouter.stepComplete'));
        onCreated({ ...project, blueprint: vr.parsed });
      } else {
        setBlueprintErrors(vr.errors);
        showToast?.(t('profile.generator.openrouter.stepFailed'), true);
      }
    } catch (e) {
      showToast?.(e.message, true);
    }
    setAiRunning(null);
  }

  if (phase === 'blueprint') {
    const fixPrompt = blueprintErrors.length > 0
      ? buildBlueprintFixPrompt(description, blueprintErrors, interviewParsed)
      : null;
    return html`
      <div class="pf-gen-new-project">
        <button class="btn-outline" onClick=${() => setPhase('describe')}>${t('profile.generator.back')}</button>
        <div class="section-title section-title-spaced">${t('profile.generator.blueprintTitle')}</div>
        <div class="section-desc">${t('profile.generator.blueprintDesc')}</div>
        <div class="pf-gen-section">
          <label>${t('profile.generator.prompt')}</label>
          <div class="pf-gen-or-btn-row">
            <button class="btn-primary" onClick=${handleCopyBlueprintPrompt}>
              ${t('profile.generator.copyPrompt')}
            </button>
            ${orSettings?.hasApiKey && html`
              <button class="btn-outline pf-gen-or-run-btn ${aiRunning === 'blueprint' ? 'pf-gen-or-running' : ''}"
                onClick=${handleRunBlueprintAi}
                disabled=${aiRunning !== null}>
                ${aiRunning === 'blueprint'
                  ? html`<span class="pf-gen-or-spinner"></span> ${t('profile.generator.openrouter.waiting')}`
                  : t('profile.generator.openrouter.runWithAi')}
              </button>
            `}
          </div>
        </div>
        <div class="pf-gen-section">
          <label>${t('profile.generator.blueprintResult')}</label>
          <textarea
            class="pf-gen-result-area"
            rows="12"
            placeholder=${t('profile.generator.blueprintPlaceholder')}
            value=${blueprintResult}
            onInput=${e => setBlueprintResult(e.target.value)}
          />
        </div>
        ${blueprintErrors.length > 0 && html`
          <div class="pf-gen-errors">
            <label>${t('profile.generator.errors')}</label>
            <ul>${blueprintErrors.map(e => html`<li>${e}</li>`)}</ul>
            ${fixPrompt && html`
              <button class="btn-primary btn-sm" onClick=${() => navigator.clipboard.writeText(fixPrompt)}>
                ${t('profile.generator.copyFixPrompt')}
              </button>
            `}
          </div>
        `}
        <div class="pf-gen-actions">
          <button class="btn-primary" onClick=${handleSubmitBlueprint} disabled=${!blueprintResult.trim()}>
            ${t('profile.generator.importBlueprint')}
          </button>
          <button class="btn-outline" onClick=${() => onCreated(project)}>
            ${t('profile.generator.skipBlueprint')}
          </button>
        </div>
      </div>
    `;
  }

  return html`
    <div class="pf-gen-new-project">
      <button class="btn-outline" onClick=${onBack}>${t('profile.generator.back')}</button>
      <div class="section-title section-title-spaced">${t('profile.generator.newProjectTitle')}</div>
      <div class="section-desc">${t('profile.generator.newProjectDesc')}</div>
      <textarea
        class="pf-gen-description"
        rows="8"
        placeholder=${t('profile.generator.descPlaceholder')}
        value=${description}
        onInput=${e => setDescription(e.target.value)}
      />
      <div class="pf-gen-actions">
        <button class="btn-primary" onClick=${handleAnalyze} disabled=${!description.trim()}>
          ${t('profile.generator.analyze')}
        </button>
      </div>
    </div>
  `;
}

function ProjectDashboard({ projectId, onBack, session, showToast, orSettings }) {
  const [logFilter, setLogFilter] = useState(null); // null = all, or componentId
  const { confirm, ConfirmUI } = useConfirm();

  // Core shared data (hook-per-domain)
  const core = useDashboardCore(projectId, onBack, showToast);

  // Autopilot state (hook-per-domain)
  const autopilotState = useAutopilotState();

  // Lifecycle (hook-per-domain)
  const lifecycle = useLifecycle(core, projectId, showToast, session);

  // Edit mode (hook-per-domain)
  const edit = useEditMode(core, autopilotState, projectId, orSettings, session, showToast);

  // Autopilot (hook-per-domain)
  const autopilot = useAutopilot(core, autopilotState, projectId, orSettings, session, testExec, showToast);

  // Phase 7: Diagnostics state
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Packaging (hook-per-domain)
  const pkg = usePackaging(core, projectId, showToast);

  // Convenience aliases from core and testExec (used by functions still in this file, removed as hooks extract them)
  const { project, components, interviewSpec, selectedId, liveStatuses } = core;
  const loadData = core.loadData;
  const refreshStatuses = core.refreshStatuses;
  const setSelectedId = core.setSelectedId;
  const advanceToNext = core.advanceToNext;
  const { testScope, testRunning, testReport } = testExec;
  const setTestScope = testExec.setTestScope;
  const editMode = edit.editMode; // used in toolbar toggle and JSX conditionals

  // Editable project name
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // Test execution (hook-per-domain)
  const testExec = useTestExecution(core, projectId, orSettings, session, showToast);


  async function handleNameSave() {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== project.name) {
      await updateProject(projectId, { name: trimmed });
      await writeProjectLog(projectId, 'name_changed', { meta: { newName: nameDraft } });
      await loadData();
      showToast?.(t('profile.generator.nameUpdated'));
    }
    setEditingName(false);
  }

  function handleLaunchApp() {
    const url = getAppLaunchUrl(components, session);
    if (url) window.open(url, '_blank');
    else showToast?.(t('profile.generator.noRegisteredApp'));
  }

  // Packaging handlers
  // Phase 6: Edit service handlers
  const selected = components.find(c => c.id === selectedId);
  const phases = project?.blueprint?.phases || [];

  // Build activity log from component histories
  const componentLogs = components.flatMap(c =>
    (c.history || []).map(h => ({ ...h, componentId: c.id, componentLabel: c.label }))
  );
  const allLogs = componentLogs.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const filteredLogs = logFilter ? allLogs.filter(l => l.componentId === logFilter) : allLogs;

  // Phase 5: Compute summary for lifecycle toolbar
  const registeredCount = components.filter(c => c.registeredAs).length;
  const activeCount = Object.values(liveStatuses).filter(s => s.active).length;
  const hasApp = components.some(c => c.type === 'app' && c.registeredAs);
  const doneCount = components.filter(c => c.status === 'done' && c.result).length;

  // Compute phase-ordered component list for auto-advance
  const phaseOrder = phases.flatMap(p => p.componentIds || []);

  // Phase 7: Diagnostics data
  const diagnosticsData = components.map(c => {
    const live = liveStatuses[c.id] || {};
    return {
      id: c.id, label: c.label, type: c.type,
      generatorStatus: c.status,
      registeredAs: c.registeredAs,
      liveStatus: live.status || 'unknown',
      active: live.active || false,
      installed: live.installed || false,
      lastAction: (c.history || []).slice(-1)[0] || null,
    };
  });

  function handleDeleteProject() {
    confirm(t('profile.generator.confirmDelete'), async () => {
      try {
        await writeProjectLog(projectId, 'project_deleted');
        await deleteProject(projectId, session);
        showToast?.(t('profile.generator.projectDeleted'));
        onBack();
      } catch (e) {
        showToast?.(e.message, true);
      }
    }, { title: t('profile.generator.deleteProject'), confirmLabel: t('profile.generator.deleteProject'), cancelLabel: t('profile.generator.back'), danger: true });
  }

  if (!project) return html`<div class="pf-gen-loading">${t('profile.loading')}</div>`;

  return html`
    <div class="pf-gen-dashboard">
      <${ConfirmUI} />
      <div class="pf-gen-dash-header">
        <button class="btn-outline" onClick=${onBack}>${t('profile.generator.back')}</button>
        ${editingName
          ? html`<input class="pf-gen-name-input" value=${nameDraft}
              onInput=${e => setNameDraft(e.target.value)}
              onBlur=${handleNameSave}
              onKeyDown=${e => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setEditingName(false); }}
              ref=${el => el && setTimeout(() => el.focus(), 0)}
            />`
          : html`<h3 class="pf-gen-name-editable" onClick=${() => { setNameDraft(project.name); setEditingName(true); }}
              title=${t('profile.generator.clickToEditName')}>${project.name}</h3>`
        }
        <button class="btn-ghost btn-sm pf-gen-delete-btn" onClick=${handleDeleteProject}>
          ${t('profile.generator.deleteProject')}
        </button>
      </div>
      ${project.forkedFrom && html`
        <p class="pf-gen-forked-from text-caption mb-half">
          ${t('profile.generator.forkedFrom').replace('{name}', project.forkedFrom.packageGroupId).replace('{author}', project.forkedFrom.author)}
        </p>
      `}
      ${project.packageGroupId && html`
        <p class="pf-gen-package-link text-caption mb-half">
          Package: ${project.packageGroupId}${project.lastPackagedVersion ? ' — ' + project.lastPackagedVersion : ''}
        </p>
      `}

      <!-- Test Scope — always visible when components exist -->
      ${components.length > 0 && !autopilotState.running && html`
        <${TestScopeSelector} value=${testScope} onChange=${setTestScope} />
      `}

      <!-- Autopilot: Run All Steps -->
      ${orSettings?.hasApiKey && components.length > 0 && html`
        <div class="pf-gen-or-run-all-bar">
          ${autopilotState.running
            ? html`
              <div class="pf-gen-or-run-all-status">
                <span class="pf-gen-or-spinner"></span>
                <span>${autopilotState.step}</span>
              </div>
              <button class="btn-danger btn-sm" onClick=${autopilotState.cancel}>
                ${t('profile.generator.openrouter.cancel')}
              </button>
            `
            : html`
              <button class="btn-primary btn-sm" onClick=${autopilot.handleRunAll}
                disabled=${components.every(c => c.registeredAs)}>
                ${t('profile.generator.openrouter.runAll')}
              </button>
            `
          }
        </div>
      `}

      <!-- Phase 5: Lifecycle Toolbar -->
      ${registeredCount > 0 && html`
        <div class="pf-gen-lifecycle-toolbar">
          <div class="pf-gen-lifecycle-status">
            <span>${registeredCount} ${t('profile.generator.registeredLabel')}</span>
            <span class="pf-gen-lifecycle-sep">/</span>
            <span>${activeCount} ${t('profile.generator.activeLabel')}</span>
          </div>
          <div class="pf-gen-lifecycle-actions">
            <button class="btn-success btn-sm"
              onClick=${lifecycle.handleActivateAll}
              disabled=${lifecycle.lifecycleLoading !== null || registeredCount === 0}>
              ${lifecycle.lifecycleLoading === 'activate' ? '...' : t('profile.generator.activateAll')}
            </button>
            <button class="btn-outline btn-sm"
              onClick=${lifecycle.handleDeactivateAll}
              disabled=${lifecycle.lifecycleLoading !== null || activeCount === 0}>
              ${lifecycle.lifecycleLoading === 'deactivate' ? '...' : t('profile.generator.deactivateAll')}
            </button>
            ${hasApp && html`
              <button class="btn-primary btn-sm" onClick=${handleLaunchApp}>
                ${t('profile.generator.launchApp')}
              </button>
            `}
            <button class="btn-outline btn-sm" onClick=${() => refreshStatuses()} title=${t('profile.generator.refreshTitle')}>
              ${t('profile.generator.refresh')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${() => editMode ? edit.exitEditMode() : edit.setEditMode('request')}>
              ${editMode ? t('profile.generator.cancelEdit') : t('profile.generator.editService')}
            </button>
            ${project?.blueprint?.settings && html`
              <button class="btn-ghost btn-sm" onClick=${() => lifecycle.setShowSettingsPanel(!lifecycle.showSettingsPanel)}>
                ${lifecycle.showSettingsPanel ? t('profile.generator.hideSettings') : t('profile.generator.editSettings')}
              </button>
            `}
            <button class="btn-ghost btn-sm" onClick=${() => setShowDiagnostics(!showDiagnostics)}>
              ${showDiagnostics ? t('profile.generator.hideDiagnostics') : t('profile.generator.diagnostics')}
            </button>
            <button class="btn-outline btn-sm pf-gen-remove-toggle"
              onClick=${() => { lifecycle.setShowRemovePanel(!lifecycle.showRemovePanel); lifecycle.setRemoveSelection({}); }}>
              ${lifecycle.showRemovePanel ? t('profile.generator.cancelRemove') : t('profile.generator.removeEllipsis')}
            </button>
            ${doneCount > 0 && html`
              <button class="btn-info btn-sm"
                onClick=${pkg.handleOpen}
                disabled=${pkg.loading}>
                ${project.packageGroupId
                  ? t('profile.generator.updatePackage')
                  : t('profile.generator.packageProject')}
              </button>
            `}
          </div>
        </div>
      `}

      <!-- Package Dialog -->
      ${pkg.showDialog && html`<${PackageDialog} project=${project} pkg=${pkg} />`}

      <!-- Phase 5: Remove Panel -->
      ${lifecycle.showRemovePanel && html`<${RemovePanel} components=${components} lifecycle=${lifecycle} />`}

      <!-- Phase 6: Edit Service Panel -->
      ${editMode && html`<${EditModePanel} edit=${edit} core=${core} autopilotState=${autopilotState} orSettings=${orSettings} />`}

      <!-- Phase 7: Diagnostics Panel -->
      ${showDiagnostics && html`
        <div class="pf-gen-diagnostics-panel">
          <h4>${t('profile.generator.diagnostics')}</h4>
          <table class="pf-gen-diag-table">
            <thead>
              <tr>
                <th>${t('profile.generator.diagComponent')}</th>
                <th>${t('profile.generator.diagType')}</th>
                <th>${t('profile.generator.diagGenStatus')}</th>
                <th>${t('profile.generator.diagLiveStatus')}</th>
                <th>${t('profile.generator.diagLastAction')}</th>
              </tr>
            </thead>
            <tbody>
              ${diagnosticsData.map(d => html`
                <tr class=${d.active ? 'diag-active' : d.installed ? 'diag-installed' : ''}>
                  <td>${d.label}</td>
                  <td><span class="pf-gen-type-badge type-${d.type}">${d.type}</span></td>
                  <td><span class="pf-gen-status-badge status-${d.generatorStatus}">${d.generatorStatus}</span></td>
                  <td>
                    <span class=${d.active ? 'pf-gen-live-active' : d.installed ? 'pf-gen-live-installed' : 'pf-gen-live-missing'}>
                      ${d.liveStatus}
                    </span>
                  </td>
                  <td class="pf-gen-diag-action">
                    ${d.lastAction ? `${d.lastAction.action} (${new Date(d.lastAction.at).toLocaleTimeString()})` : '-'}
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `}

      <!-- Settings Panel (inline edit) -->
      ${lifecycle.showSettingsPanel && project?.blueprint?.settings && html`
        <div class="pf-gen-settings-inline">
          <${SettingsCollectionView}
            project=${project}
            blueprint=${project.blueprint}
            onComplete=${() => lifecycle.setShowSettingsPanel(false)}
            showToast=${showToast}
          />
        </div>
      `}

      <!-- Test Execution Panel -->
      ${registeredCount > 0 && html`
        <div class="pf-gen-test-panel">
          <div class="pf-gen-actions">
            <button class="btn-primary btn-sm"
              onClick=${testExec.handleRunTests}
              disabled=${testRunning || testScope === 'none'}>
              ${testRunning
                ? html`<span class="pf-gen-or-spinner"></span> ${t('profile.generator.test_running')}`
                : t('profile.generator.test_scope_title')}
            </button>
          </div>
          ${testReport && html`
            <${TestResultsView}
              report=${testReport}
              projectId=${projectId}
              onFixRequest=${orSettings?.hasApiKey ? testExec.handleTestFixRequest : null}
            />
          `}
        </div>
      `}

      <div class="pf-gen-dash-body">
        <!-- Sidebar -->
        <div class="pf-gen-sidebar">
          ${phases.map(phase => html`
            <div class="pf-gen-phase-group">
              <div class="pf-gen-phase-label">${phase.label}</div>
              ${(phase.componentIds || []).map(cid => {
                const comp = components.find(c => c.id === cid) || { id: cid, label: cid, type: '?', status: 'not_started' };
                const live = liveStatuses[cid];
                const testComp = testReport?.components?.find(c => c.componentId === cid);
                const isTestable = ['extension', 'cortex', 'app'].includes(comp.type);
                return html`
                  <div
                    class="pf-gen-comp-item ${selectedId === cid ? 'active' : ''} status-${comp.status}"
                    onClick=${() => setSelectedId(cid)}
                  >
                    <span class="pf-gen-comp-name">${comp.label}</span>
                    <span class="pf-gen-comp-indicators">
                      ${testComp
                        ? html`<span class="pf-gen-test-icon pf-gen-test-icon-${testComp.status}"
                            title=${t('profile.generator.test_component_' + testComp.status) + (testComp.scenarios > 0 ? ` (${testComp.passed}/${testComp.scenarios})` : '')}>${
                            testComp.status === 'passed' ? '✓' : testComp.status === 'failed' ? '✗' : '—'
                          }</span>`
                        : isTestable && testScope !== 'none'
                          ? html`<span class="pf-gen-test-icon pf-gen-test-icon-planned"
                              title=${t('profile.generator.test_planned')}>◉</span>`
                          : null
                      }
                      <span class="pf-gen-type-badge type-${comp.type} ${live ? (live.active ? 'live-active' : live.installed ? 'live-installed' : 'live-missing') : ''}"
                        title=${live?.status || ''}>${comp.type.toUpperCase()}</span>
                    </span>
                  </div>
                `;
              })}
            </div>
          `)}
        </div>
        <!-- Detail Panel -->
        <div class="pf-gen-detail">
          ${selected
            ? html`<${ComponentDetail}
                component=${selected}
                project=${project}
                components=${components}
                projectId=${projectId}
                interviewSpec=${interviewSpec}
                liveStatuses=${liveStatuses}
                onUpdate=${loadData}
                onAdvance=${advanceToNext}
                showToast=${showToast}
                session=${session}
                orSettings=${orSettings}
              />`
            : html`<div class="pf-gen-detail-empty">${t('profile.generator.selectComponent')}</div>`
          }
        </div>
      </div>
      <!-- Activity Log -->
      <div class="pf-gen-activity-log">
        <div class="pf-gen-log-header">
          <label>${t('profile.generator.activityLog')}</label>
          <select class="pf-gen-log-filter" onChange=${e => setLogFilter(e.target.value || null)}>
            <option value="">${t('profile.generator.allComponents')}</option>
            ${components.map(c => html`<option value=${c.id}>${c.label}</option>`)}
          </select>
        </div>
        <div class="pf-gen-log-entries">
          ${filteredLogs.length === 0 && html`<div class="pf-gen-log-empty">${t('profile.generator.noActivity')}</div>`}
          ${filteredLogs.slice(0, 50).map(l => html`
            <div class="pf-gen-log-entry">
              <span class="pf-gen-log-time">${new Date(l.at).toLocaleTimeString()}</span>
              <span class="pf-gen-log-comp">[${l.componentLabel}]</span>
              <span class="pf-gen-log-msg">${l.action}${l.round ? ' (' + l.round + '/' + (l.maxRounds || '?') + ')' : ''}${l.errors ? ': ' + (Array.isArray(l.errors) ? l.errors.join(', ') : l.errors) : ''}</span>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

/* ── Main Tab ────────────────────────────────────────── */

export default function GeneratorTab({ session, showToast }) {
  const [view, setView] = useState('list');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [generatorEnabled, setGeneratorEnabled] = useState(true);
  const [orSettings, setOrSettings] = useState({ hasApiKey: false, autoRetry: false, maxRetries: 3 });

  useEffect(() => {
    apiGet('/?format=json').then(resp => {
      const cfg = resp?.data?.config || resp?.data || {};
      if (cfg.generator?.enabled === false || cfg.generatorEnabled === false) {
        setGeneratorEnabled(false);
      }
    }).catch(() => {});
  }, []);

  if (!generatorEnabled) {
    return html`<div class="pf-gen-disabled">${t('profile.generator.disabled')}</div>`;
  }

  function handleSelectProject(id) {
    setActiveProjectId(id);
    setView('dashboard');
  }

  function handleCreated(project) {
    setActiveProjectId(project.projectId);
    setActiveProject(project);
    // Show settings collection if blueprint has settings definitions
    const bp = project.blueprint;
    const hasSettings = bp?.settings && (
      (bp.settings.service && bp.settings.service.length > 0) ||
      (bp.settings.user && bp.settings.user.length > 0)
    );
    if (hasSettings) {
      setView('settings');
    } else {
      setView('dashboard');
    }
  }

  function handleSettingsComplete() {
    setView('dashboard');
  }

  if (view === 'new') {
    return html`<${NewProjectView} onBack=${() => setView('list')} onCreated=${handleCreated} showToast=${showToast} orSettings=${orSettings} />`;
  }
  if (view === 'settings' && activeProject) {
    return html`<${SettingsCollectionView}
      project=${activeProject}
      blueprint=${activeProject.blueprint}
      onComplete=${handleSettingsComplete}
      showToast=${showToast}
    />`;
  }
  if (view === 'dashboard' && activeProjectId) {
    return html`<${ProjectDashboard}
      projectId=${activeProjectId}
      onBack=${() => { setView('list'); setActiveProjectId(null); setActiveProject(null); }}
      session=${session}
      showToast=${showToast}
      orSettings=${orSettings}
    />`;
  }
  return html`
    <div>
      <${OpenRouterSettings} onSettingsChange=${setOrSettings} />
      <${ProjectListView} onSelect=${handleSelectProject} onCreate=${() => setView('new')} showToast=${showToast} session=${session} />
    </div>
  `;
}
