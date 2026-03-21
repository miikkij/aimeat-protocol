/**
 * @file generator-tab.js
 * @description Service Generator tab for the profile view — multi-phase UI for
 *   creating AIMEAT services via AI-assisted prompts. Includes requirements
 *   interview phase, blueprint generation, per-component generation with
 *   validation, and component registration (including cortex).
 * @structure
 *   - ProjectList: project CRUD, archive, cleanup
 *   - ProjectEditor: blueprint + component generation workflow
 *   - Interview phase: structured requirements gathering before blueprint
 *   - Component cards: generate, validate, fix, register per component type
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
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import {
  listProjects, getProject, createProject, updateProject, deleteProject, archiveProject,
  loadAllComponents, saveComponent,
  registerComponent, cleanupOldEntries,
  saveInterviewSpec, getInterviewSpec,
  getComponentStatuses, activateAll, deactivateAll, removeComponents, reregisterComponent, getAppLaunchUrl,
  writeProjectLog,
  savePendingEdit, getPendingEdit, clearPendingEdit,
  saveProjectSettings,
} from '/js/services/generator.js';
import { buildBlueprintPrompt, buildBlueprintFixPrompt, buildComponentPrompt, buildFixPrompt, buildTestPrompt, buildInterviewPrompt, buildImpactPrompt, buildEditPrompt } from '/js/services/generator-prompts.js';
import { validateBlueprint, validateComponent, validateInterviewSpec } from '/js/services/generator-validate.js';
import { useConfirm } from '/components/Modal.js';
import {
  packageProject, updatePackageVersion, detectChanges,
  importPackageToGenerator, publishToGallery,
} from '/js/services/generator-packaging.js';
import { runTests, runComponentTest, screenshotUrl } from '/js/services/generator-testing.js';

/* ── OpenRouter Autopilot Helper ──────────────────────── */

// Active AbortController for current AI request — allows instant cancel
let _activeAiController = null;

/** Strip markdown codeblock wrapper if AI wrapped the response in ``` */
function stripCodeblock(text) {
  if (!text) return text;
  const trimmed = text.trim();
  // Match ```<optional lang>\n...\n``` or ```<optional lang>\n...```
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)```\s*$/);
  return match ? match[1].trim() : trimmed;
}

async function runWithAi(projectId, prompt, systemPrompt = null) {
  const body = { projectId, prompt };
  if (systemPrompt) body.systemPrompt = systemPrompt;
  // Use direct fetch with 10-minute timeout (apiPost has 30s limit)
  const controller = new AbortController();
  _activeAiController = controller;
  const timeoutId = setTimeout(() => controller.abort(), 1_800_000); // 30 min
  const headers = { 'Content-Type': 'application/json' };
  const session = window.AIMEAT?.auth?.getSession?.();
  if (session?.jwt) headers['Authorization'] = 'Bearer ' + session.jwt;
  try {
    const raw = await fetch('/v1/openrouter/complete', {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    });
    if (!raw.ok) {
      // Try to parse error body, fall back to status text
      let msg = `HTTP ${raw.status}`;
      try { const e = await raw.json(); msg = e.error?.message || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const resp = await raw.json();
    if (resp.ok === false) throw new Error(resp.error?.message || 'OpenRouter error');
    return resp.data.content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Cancelled');
    if (e.name === 'TypeError') throw new Error('Network error — connection lost');
    throw e;
  } finally {
    clearTimeout(timeoutId);
    _activeAiController = null;
  }
}

/** Abort the active AI request immediately */
function cancelAiRequest() {
  if (_activeAiController) _activeAiController.abort();
}

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
  const [project, setProject] = useState(null);
  const [components, setComponents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [logFilter, setLogFilter] = useState(null); // null = all, or componentId
  const { confirm, ConfirmUI } = useConfirm();

  // Autopilot state
  const [autopilotRunning, setAutopilotRunning] = useState(false);
  const [currentAutopilotStep, setCurrentAutopilotStep] = useState('');
  const autopilotCancelledRef = useRef(false);

  // Phase 5: Lifecycle state
  const [liveStatuses, setLiveStatuses] = useState({});
  const [lifecycleLoading, setLifecycleLoading] = useState(null); // 'activate' | 'deactivate' | null
  const [showRemovePanel, setShowRemovePanel] = useState(false);
  const [removeSelection, setRemoveSelection] = useState({});
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [removeMemory, setRemoveMemory] = useState(false);

  // Phase 6: Edit service state
  const [aiRunning, setAiRunning] = useState(null); // null | 'impact'
  const [editMode, setEditMode] = useState(null); // null | 'request' | 'impact' | 'editing'
  const [changeRequest, setChangeRequest] = useState('');
  const [impactResult, setImpactResult] = useState('');
  const [impactParsed, setImpactParsed] = useState(null);
  const [impactErrors, setImpactErrors] = useState([]);

  // Phase 7: Diagnostics state
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Packaging state
  const [showPackageDialog, setShowPackageDialog] = useState(false);
  const [packageLoading, setPackageLoading] = useState(false);
  const [packageChanges, setPackageChanges] = useState(null);
  const [packageCategory, setPackageCategory] = useState('utility');
  const [packageTags, setPackageTags] = useState('');
  const [packageVisibility, setPackageVisibility] = useState('private');
  const [changelogNote, setChangelogNote] = useState('');

  // Editable project name
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // Interview spec (loaded for locale threading to component prompts)
  const [interviewSpec, setInterviewSpec] = useState(null);

  // Test execution state
  const [testScope, setTestScope] = useState('comprehensive');
  const [testRunning, setTestRunning] = useState(false);
  const [testReport, setTestReport] = useState(null);
  const [testFixRound, setTestFixRound] = useState(0);

  useEffect(() => { loadData(); }, [projectId]);

  // SSE live updates — instant refresh when data changes
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [projectId]);

  async function loadData() {
    const p = await getProject(projectId);
    if (!p || !p.projectId) {
      // Project deleted — go back
      onBack();
      return;
    }
    setProject(p);
    // Load interview spec BEFORE components — prompts need it for locale/data source threading
    try {
      const spec = await getInterviewSpec(projectId);
      setInterviewSpec(spec);
    } catch { /* no interview spec — that's fine */ }
    if (p?.blueprint?.components) {
      const comps = await loadAllComponents(projectId);
      if (comps.length > 0) {
        setComponents(comps);
      } else {
        // Blueprint exists but no component records yet (e.g. submitted blueprint via API).
        // Initialize component records in memory — same as handleSubmitBlueprint() does for UI flow.
        const initialized = [];
        for (const c of p.blueprint.components) {
          const comp = { id: c.id, type: c.type, label: c.label, status: 'not_started', prompt: null, result: null, validationErrors: [], registeredAs: null, history: [], _version: 0 };
          await saveComponent(projectId, comp);
          initialized.push(comp);
        }
        setComponents(initialized);
      }
    }
    cleanupOldEntries(projectId).catch(() => {});
    // Restore pending edit if exists
    try {
      const pending = await getPendingEdit(projectId);
      if (pending) {
        setChangeRequest(pending.changeRequest || '');
        setImpactParsed(pending.impactParsed || null);
        setImpactResult(pending.impactResult || '');
        setEditMode(pending.impactParsed ? 'editing' : 'request');
      }
    } catch { /* no pending edit */ }
  }

  // Phase 5: Refresh live statuses
  async function refreshStatuses() {
    try {
      const s = await getComponentStatuses(projectId);
      setLiveStatuses(s);
    } catch { /* best effort */ }
  }

  useEffect(() => { if (project) refreshStatuses(); }, [project]);

  async function handleActivateAll() {
    setLifecycleLoading('activate');
    try {
      const result = await activateAll(projectId);
      if (result.errors.length > 0) {
        showToast?.(t('profile.generator.activatedWithErrors').replace('{count}', result.activated.length).replace('{errors}', result.errors.length), true);
      } else {
        showToast?.(t('profile.generator.activatedCount').replace('{count}', result.activated.length));
      }
      await writeProjectLog(projectId, 'all_activated');
      await refreshStatuses();
    } catch (e) { showToast?.(e.message, true); }
    setLifecycleLoading(null);
  }

  async function handleDeactivateAll() {
    setLifecycleLoading('deactivate');
    try {
      const result = await deactivateAll(projectId);
      if (result.errors.length > 0) {
        showToast?.(t('profile.generator.deactivatedWithErrors').replace('{count}', result.deactivated.length).replace('{errors}', result.errors.length), true);
      } else {
        showToast?.(t('profile.generator.deactivatedCount').replace('{count}', result.deactivated.length));
      }
      await writeProjectLog(projectId, 'all_deactivated');
      await refreshStatuses();
    } catch (e) { showToast?.(e.message, true); }
    setLifecycleLoading(null);
  }

  async function handleRemoveConfirmed() {
    const ids = Object.entries(removeSelection).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) return;
    setLifecycleLoading('remove');
    try {
      const result = await removeComponents(projectId, ids, removeMemory, session);
      if (result.errors.length > 0) {
        showToast?.(t('profile.generator.removedWithErrors').replace('{count}', result.removed.length).replace('{errors}', result.errors.length), true);
      } else {
        showToast?.(t('profile.generator.removedCount').replace('{count}', result.removed.length));
      }
      setShowRemovePanel(false);
      setRemoveSelection({});
      await loadData();
      await refreshStatuses();
    } catch (e) { showToast?.(e.message, true); }
    setLifecycleLoading(null);
  }

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
  async function handleOpenPackageDialog() {
    setShowPackageDialog(true);
    setPackageChanges(null);
    setChangelogNote('');
    // If project is linked to a package, detect changes
    if (project.packageGroupId) {
      try {
        const pkgResp = await getPackage(project.packageGroupId);
        const pkg = pkgResp?.data || pkgResp;
        const packageable = components.filter(c => c.status === 'done' && c.result);
        const changes = await detectChanges(packageable, pkg?.components);
        setPackageChanges(changes);
      } catch { /* first time — no changes to detect */ }
    }
  }

  async function handlePackageProject() {
    setPackageLoading(true);
    try {
      const tags = packageTags.split(',').map(t => t.trim()).filter(Boolean);
      if (project.packageGroupId) {
        // Update existing package
        const { result, changes } = await updatePackageVersion(projectId, {
          category: packageCategory,
          tags,
          changelogNote,
        });
        showToast?.(t('profile.generator.packageUpdateSuccess').replace('{version}', result?.data?.version || ''));
      } else {
        // Create new package
        await packageProject(projectId, {
          category: packageCategory,
          tags,
          visibility: packageVisibility,
        });
        showToast?.(t('profile.generator.packageSuccess'));
      }
      setShowPackageDialog(false);
      await loadData();
    } catch (e) {
      showToast?.(e.message, true);
    }
    setPackageLoading(false);
  }

  // Phase 6: Edit service handlers
  function exitEditMode() {
    setEditMode(null);
    setChangeRequest('');
    setImpactResult('');
    setImpactParsed(null);
    setImpactErrors([]);
    clearPendingEdit(projectId).catch(() => {});
  }
  function handleCopyImpactPrompt() {
    const prompt = buildImpactPrompt(changeRequest, project?.blueprint);
    navigator.clipboard.writeText(prompt).catch(() => {});
    showToast?.(t('profile.generator.impactPromptCopied'));
    setEditMode('impact');
  }

  async function handleRunImpactAi() {
    if (!orSettings?.hasApiKey) return;
    setAiRunning('impact');
    try {
      const prompt = buildImpactPrompt(changeRequest, project?.blueprint);
      const content = await runWithAi(projectId, prompt);
      setImpactResult(content);
      setEditMode('impact');
      // Auto-parse
      let text = content.trim();
      const jsonMatch = text.match(/```json\s*\n([\s\S]*?)```/i);
      if (jsonMatch) text = jsonMatch[1].trim();
      const parsed = JSON.parse(text);
      if (parsed.analysis && Array.isArray(parsed.analysis)) {
        setImpactParsed(parsed);
        setImpactErrors([]);
        setEditMode('editing');
        savePendingEdit(projectId, { changeRequest, impactParsed: parsed, impactResult: content }).catch(() => {});
      }
    } catch (e) {
      showToast?.(e.message, true);
    }
    setAiRunning(null);
  }

  function handleParseImpact() {
    try {
      let text = impactResult.trim();
      const jsonMatch = text.match(/```json\s*\n([\s\S]*?)```/i);
      if (jsonMatch) text = jsonMatch[1].trim();
      const parsed = JSON.parse(text);
      if (!parsed.analysis || !Array.isArray(parsed.analysis)) {
        setImpactErrors([t('profile.generator.impactArrayRequired')]);
        return;
      }
      setImpactParsed(parsed);
      setImpactErrors([]);
      setEditMode('editing');
      savePendingEdit(projectId, { changeRequest, impactParsed: parsed, impactResult }).catch(() => {});
    } catch (e) {
      setImpactErrors([t('profile.generator.invalidJson').replace('{error}', e.message)]);
    }
  }

  async function handleRunAllEditsAi() {
    if (!orSettings?.hasApiKey || !impactParsed?.analysis) return;
    setAutopilotRunning(true);
    autopilotCancelledRef.current = false;
    try {
      const editable = impactParsed.analysis.filter(a => a.impact === 'root' || a.impact === 'update');
      for (const item of editable) {
        if (autopilotCancelledRef.current) break;
        const comp = components.find(c => c.id === item.id);
        if (!comp) continue;
        setCurrentAutopilotStep(comp.label);
        setSelectedId(comp.id);

        // Build edit prompt (same as handleCopyEditPrompt)
        const upstream = impactParsed.analysis
          .filter(a => a.impact === 'root' && a.id !== comp.id)
          .map(a => `- ${a.label}: ${a.suggestedChange}`)
          .join('\n') || '';
        const prompt = buildEditPrompt(
          comp.type, comp.label,
          comp.result || '(no current code)',
          item.suggestedChange || changeRequest,
          upstream || null,
        );

        let content;
        try {
          content = await runWithAi(projectId, prompt);
        } catch (e) {
          showToast?.(`${comp.label}: ${e.message}`, true);
          break;
        }
        if (autopilotCancelledRef.current) break;
        if (comp.type === 'extension') content = stripCodeblock(content);

        // Validate
        let vr = validateComponent(comp.type, content, project.blueprint);

        // Auto-retry
        if (!vr.valid && orSettings?.autoRetry) {
          const max = orSettings.maxRetries || 3;
          for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
            if (autopilotCancelledRef.current) break;
            setCurrentAutopilotStep(
              comp.label + ' - ' + t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max)
            );
            const fp = buildFixPrompt(prompt, content, vr.errors, comp.type);
            try { content = await runWithAi(projectId, fp); } catch (e) { break; }
            if (comp.type === 'extension') content = stripCodeblock(content);
            vr = validateComponent(comp.type, content, project.blueprint);
          }
        }

        if (!vr.valid) {
          const errored = addHistory(comp, 'validation_failed', { errors: vr.errors, by: 'autopilot' });
          await saveComponent(projectId, { ...errored, status: 'errors', result: content, validationErrors: vr.errors });
          await loadData();
          showToast?.(t('profile.generator.openrouter.stepFailed') + ': ' + comp.label, true);
          break;
        }

        // Save + re-register
        const updated = addHistory(comp, 'edited', { by: 'autopilot', change: item.suggestedChange });
        await saveComponent(projectId, { ...updated, status: 'done', result: content, validationErrors: [] });

        try {
          const serviceSlug = components.find(c => c.type === 'csm' && c.registeredAs)?.registeredAs?.split('/')?.pop() || '';
          if (comp.type === 'cortex') {
            const cortexVr = validateComponent('cortex', content, project.blueprint);
            await registerComponent('cortex', cortexVr.extracted, session, serviceSlug);
          } else {
            await registerComponent(comp.type, vr.extracted || content, session, serviceSlug);
          }
          await writeProjectLog(projectId, 'component_edited', { meta: { component: comp.label, by: 'autopilot' } });
        } catch (e) {
          showToast?.(`${comp.label}: Registration failed: ${e.message}`, true);
          await loadData();
          break;
        }
        await loadData();
      }
    } catch (e) {
      showToast?.(e.message, true);
    }
    setAutopilotRunning(false);
    setCurrentAutopilotStep('');
    showToast?.(t('profile.generator.openrouter.stepComplete'));
  }

  function handleCopyEditPrompt(comp, suggestedChange) {
    const upstream = impactParsed?.analysis
      ?.filter(a => a.impact === 'root' && a.id !== comp.id)
      ?.map(a => `- ${a.label}: ${a.suggestedChange}`)
      ?.join('\n') || '';
    const prompt = buildEditPrompt(
      comp.type, comp.label,
      comp.result || '(no current code)',
      suggestedChange || changeRequest,
      upstream || null,
    );
    navigator.clipboard.writeText(prompt).catch(() => {});
    showToast?.(t('profile.generator.editPromptCopied').replace('{name}', comp.label));
  }

  async function handleRunSingleEditAi(comp, suggestedChange) {
    if (!orSettings?.hasApiKey) return;
    setAiRunning(comp.id);
    try {
      const upstream = impactParsed?.analysis
        ?.filter(a => a.impact === 'root' && a.id !== comp.id)
        ?.map(a => `- ${a.label}: ${a.suggestedChange}`)
        ?.join('\n') || '';
      const prompt = buildEditPrompt(
        comp.type, comp.label,
        comp.result || '(no current code)',
        suggestedChange || changeRequest,
        upstream || null,
      );
      let content = await runWithAi(projectId, prompt);
      if (comp.type === 'extension') content = stripCodeblock(content);
      let vr = validateComponent(comp.type, content, project.blueprint);

      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          const fp = buildFixPrompt(prompt, content, vr.errors, comp.type);
          try { content = await runWithAi(projectId, fp); } catch { break; }
          if (comp.type === 'extension') content = stripCodeblock(content);
          vr = validateComponent(comp.type, content, project.blueprint);
        }
      }

      if (!vr.valid) {
        const errored = addHistory(comp, 'validation_failed', { errors: vr.errors, by: 'autopilot' });
        await saveComponent(projectId, { ...errored, status: 'errors', result: content, validationErrors: vr.errors });
        await loadData();
        showToast?.(t('profile.generator.openrouter.stepFailed') + ': ' + comp.label, true);
        setAiRunning(null);
        return;
      }

      const updated = addHistory(comp, 'edited', { by: 'autopilot', change: suggestedChange });
      await saveComponent(projectId, { ...updated, status: 'done', result: content, validationErrors: [] });
      const serviceSlug = components.find(c => c.type === 'csm' && c.registeredAs)?.registeredAs?.split('/')?.pop() || '';
      if (comp.type === 'cortex') {
        const cortexVr = validateComponent('cortex', content, project.blueprint);
        await registerComponent('cortex', cortexVr.extracted, session, serviceSlug);
      } else {
        await registerComponent(comp.type, vr.extracted || content, session, serviceSlug);
      }
      await writeProjectLog(projectId, 'component_edited', { meta: { component: comp.label, by: 'autopilot' } });
      await loadData();
      showToast?.(t('profile.generator.openrouter.stepDone').replace('{name}', comp.label));
    } catch (e) {
      showToast?.(e.message, true);
    }
    setAiRunning(null);
  }

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

  function advanceToNext(currentId) {
    const idx = phaseOrder.indexOf(currentId);
    // Find the next component that isn't fully registered
    for (let i = idx + 1; i < phaseOrder.length; i++) {
      const comp = components.find(c => c.id === phaseOrder[i]);
      if (comp && !comp.registeredAs) {
        setSelectedId(phaseOrder[i]);
        return;
      }
    }
    // All done — select nothing, show completion state
    showToast?.(t('profile.generator.allComponentsRegistered'));
  }

  // Auto-select first incomplete component if nothing is selected
  useEffect(() => {
    if (!selectedId && phaseOrder.length > 0 && components.length > 0) {
      const firstIncomplete = phaseOrder.find(cid => {
        const comp = components.find(c => c.id === cid);
        return comp && !comp.registeredAs;
      });
      if (firstIncomplete) setSelectedId(firstIncomplete);
      else if (phaseOrder.length > 0) setSelectedId(phaseOrder[0]);
    }
  }, [components.length]);

  // Autopilot: Run all remaining steps
  async function handleRunAll() {
    if (!orSettings?.hasApiKey || autopilotRunning) return;
    setAutopilotRunning(true);
    autopilotCancelledRef.current = false;

    try {
      // Iterate through all components in phase order
      for (const cid of phaseOrder) {
        if (autopilotCancelledRef.current) break;
        // IMPORTANT: always fetch fresh state from API, not from closure (which is stale after loadData)
        const freshComps = await loadAllComponents(projectId);
        const comp = freshComps.find(c => c.id === cid);
        if (!comp || comp.registeredAs) continue; // skip already registered

        setCurrentAutopilotStep(comp.label);
        setSelectedId(cid);

        // Build prompt
        const latestComps = await loadAllComponents(projectId);
        const completedComponents = latestComps.filter(c => c.status === 'done' && c.registeredAs);
        const prompt = buildComponentPrompt(
          comp.type, comp.label,
          project.description, project.blueprint, completedComponents,
          interviewSpec,
        );

        // Run AI
        let content;
        try {
          content = await runWithAi(projectId, prompt);
        } catch (e) {
          showToast?.(`${comp.label}: ${e.message}`, true);
          break;
        }
        if (autopilotCancelledRef.current) break;
        // Strip codeblock wrappers for extensions (AI models often wrap in ```)
        if (comp.type === 'extension') content = stripCodeblock(content);

        // Save result
        let updated = { ...comp, result: content, status: 'validating', prompt,
          history: [...(comp.history || []), { action: 'ai_response_received', at: new Date().toISOString(), by: 'autopilot' }],
        };
        await saveComponent(projectId, updated);

        // Validate
        let vr = validateComponent(comp.type, content, project.blueprint);

        // Auto-retry if enabled
        if (!vr.valid && orSettings?.autoRetry) {
          const max = orSettings.maxRetries || 3;
          for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
            if (autopilotCancelledRef.current) break;
            setCurrentAutopilotStep(
              comp.label + ' - ' + t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max)
            );
            const fixPrompt = buildFixPrompt(prompt, content, vr.errors, comp.type);
            try {
              content = await runWithAi(projectId, fixPrompt);
            } catch (e) {
              showToast?.(`${comp.label}: ${e.message}`, true);
              break;
            }
            vr = validateComponent(comp.type, content, project.blueprint);
          }
        }

        if (!vr.valid) {
          updated = { ...updated, result: content, status: 'errors', validationErrors: vr.errors,
            history: [...updated.history, { action: 'validation_failed', at: new Date().toISOString(), by: 'autopilot', errors: vr.errors }],
          };
          await saveComponent(projectId, updated);
          await loadData();
          showToast?.(t('profile.generator.openrouter.stepFailed') + ': ' + comp.label, true);
          break;
        }
        if (autopilotCancelledRef.current) break;

        // Validation passed — save and register
        updated = { ...updated, result: content, status: 'done', validationErrors: [],
          history: [...updated.history, { action: 'validation_passed', at: new Date().toISOString(), by: 'autopilot' }],
        };
        await saveComponent(projectId, updated);

        // Register component
        try {
          const extComp = (await loadAllComponents(projectId)).find(c => c.type === 'extension' && c.registeredAs);
          const csmComp = (await loadAllComponents(projectId)).find(c => c.type === 'csm' && c.registeredAs);
          const serviceSlug = extComp?.registeredAs || csmComp?.registeredAs?.split('/')?.pop() || '';

          let resp;
          if (comp.type === 'cortex') {
            const cortexVr = validateComponent('cortex', content, project.blueprint);
            resp = await registerComponent('cortex', cortexVr.extracted, session, serviceSlug);
          } else {
            resp = await registerComponent(comp.type, vr.extracted || content, session, serviceSlug);
          }
          const d = resp?.data || {};
          const regName = d.csm?.name || d.integration?.name || d.extension?.name
            || d.filename || d.name || d.id
            || (d.locales ? `i18n-${d.locales.join('-')}` : null)
            || (d.keys?.length ? `memory:${d.keys[d.keys.length - 1]}` : null)
            || null;
          if (regName) {
            updated = { ...updated, registeredAs: regName,
              history: [...updated.history, { action: 'registered', at: new Date().toISOString(), by: 'autopilot', registeredAs: regName }],
            };
            await saveComponent(projectId, updated);
            await writeProjectLog(projectId, 'component_registered', { meta: { component: comp.label, registeredAs: regName, by: 'autopilot' } });
          }
        } catch (e) {
          showToast?.(`${comp.label}: Registration failed: ${e.message}`, true);
          await loadData();
          break;
        }

        await loadData();

        // Activate extension/cortex immediately after registration so tests (and the service) can use it
        if ((comp.type === 'extension' || comp.type === 'cortex') && updated.registeredAs) {
          try {
            const activateUrl = comp.type === 'extension'
              ? `/v1/extensions/${encodeURIComponent(updated.registeredAs)}/activate`
              : `/v1/cortex/${encodeURIComponent(updated.registeredAs)}/activate`;
            await apiPost(activateUrl);
            await writeProjectLog(projectId, 'component_activated', { meta: { component: comp.label, registeredAs: updated.registeredAs, by: 'autopilot' } });
          } catch (e) {
            await writeProjectLog(projectId, 'component_activation_failed', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
          }
        }

        // Per-component test immediately after registration (prompt-driven: AI generates test code)
        if (!autopilotCancelledRef.current && testScope !== 'none') {
          const testableTypes = ['extension', 'cortex', 'app'];
          if (testableTypes.includes(comp.type)) {
            // Step 1: AI generates the test code
            setCurrentAutopilotStep(comp.label + ' — ' + t('profile.generator.test_generating'));
            await writeProjectLog(projectId, 'test_prompt_generating', { meta: { component: comp.label, type: comp.type, by: 'autopilot' } });
            const testEnvironment = (comp.type === 'cortex' || comp.type === 'app') ? 'browser' : 'server';
            let aiTestCode;
            let testPromptText;
            try {
              testPromptText = buildTestPrompt(
                comp.type, content, comp.label, updated.registeredAs,
                project.blueprint, interviewSpec
              );
              await writeProjectLog(projectId, 'test_prompt_built', { meta: { component: comp.label, environment: testEnvironment, promptLength: testPromptText.length, by: 'autopilot' } });
              aiTestCode = await runWithAi(projectId, testPromptText);
              // Strip markdown code fences if AI wraps the response
              aiTestCode = stripCodeblock(aiTestCode);
              // Save test prompt and test code to the component record
              updated = { ...updated, testPrompt: testPromptText, testCode: aiTestCode, testEnvironment,
                history: [...(updated.history || []), { action: 'test_code_generated', at: new Date().toISOString(), by: 'autopilot' }],
              };
              await saveComponent(projectId, updated);
              await writeProjectLog(projectId, 'test_code_generated', { meta: { component: comp.label, environment: testEnvironment, codeLength: aiTestCode.length, by: 'autopilot' } });
            } catch (e) {
              await writeProjectLog(projectId, 'test_code_generation_failed', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
              showToast?.(`${comp.label}: Test generation failed: ${e.message}`, true);
              await loadData();
              continue; // Skip testing, move to next component
            }
            if (autopilotCancelledRef.current) break;

            // Step 2: Execute the AI-generated test code
            setCurrentAutopilotStep(comp.label + ' — ' + t('profile.generator.test_running'));
            await writeProjectLog(projectId, 'test_executing', { meta: { component: comp.label, environment: testEnvironment, by: 'autopilot' } });
            try {
              const testResp = await runComponentTest(projectId, comp.id, aiTestCode, testEnvironment);
              const testResult = testResp?.data?.result || testResp?.result;

              // Save test result to the component record
              if (testResult) {
                updated = { ...updated, testResult,
                  history: [...(updated.history || []), { action: 'test_' + testResult.status, at: new Date().toISOString(), by: 'autopilot', errors: testResult.errors }],
                };
                await saveComponent(projectId, updated);
              }

              // Accumulate result into testReport for sidebar indicators
              if (testResult) {
                setTestReport(prev => {
                  const existing = prev || { level: testScope, timestamp: new Date().toISOString(), components: [], overall: 'passed' };
                  const comps = existing.components.filter(c => c.componentId !== comp.id);
                  comps.push(testResult);
                  const failedCount = comps.filter(c => c.status === 'failed').length;
                  const passedCount = comps.filter(c => c.status === 'passed').length;
                  return { ...existing, components: comps, overall: failedCount === 0 ? 'passed' : (passedCount > 0 ? 'partial' : 'failed') };
                });
              }

              if (testResult && testResult.status === 'failed') {
                await writeProjectLog(projectId, 'component_test_failed', { meta: { component: comp.label, errors: testResult.errors, by: 'autopilot' } });
                showToast?.(`${comp.label}: ${t('profile.generator.test_failed')}`, true);

                // Per-component fix loop (max 3 rounds)
                const MAX_FIX = 3;
                let fixed = false;
                for (let fix = 0; fix < MAX_FIX && !fixed && !autopilotCancelledRef.current; fix++) {
                  setCurrentAutopilotStep(
                    comp.label + ' — ' + t('profile.generator.openrouter.retrying').replace('{current}', fix + 1).replace('{max}', MAX_FIX)
                  );
                  await writeProjectLog(projectId, 'test_fix_round_start', { meta: { component: comp.label, round: fix + 1, maxRounds: MAX_FIX, by: 'autopilot' } });

                  // Build fix prompt with test errors
                  const fixPrompt = buildFixPrompt(prompt, content, [
                    ...(vr.errors || []),
                    ...testResult.errors.map(e => `TEST FAILURE: ${e}`),
                  ], comp.type);

                  try {
                    content = await runWithAi(projectId, fixPrompt);
                  } catch (e) {
                    showToast?.(`${comp.label}: ${e.message}`, true);
                    await writeProjectLog(projectId, 'test_fix_ai_failed', { meta: { component: comp.label, round: fix + 1, error: e.message, by: 'autopilot' } });
                    break;
                  }
                  if (autopilotCancelledRef.current) break;

                  const fixVr = validateComponent(comp.type, content, project.blueprint);
                  if (!fixVr.valid) {
                    await writeProjectLog(projectId, 'test_fix_validation_failed', { meta: { component: comp.label, round: fix + 1, errors: fixVr.errors, by: 'autopilot' } });
                    continue;
                  }

                  // Re-register fixed version
                  updated = { ...updated, result: content, status: 'done', validationErrors: [] };
                  await saveComponent(projectId, updated);

                  try {
                    const extComp2 = (await loadAllComponents(projectId)).find(c => c.type === 'extension' && c.registeredAs);
                    const csmComp2 = (await loadAllComponents(projectId)).find(c => c.type === 'csm' && c.registeredAs);
                    const slug2 = extComp2?.registeredAs || csmComp2?.registeredAs?.split('/')?.pop() || '';
                    if (comp.type === 'cortex') {
                      const cvr = validateComponent('cortex', content, project.blueprint);
                      await registerComponent('cortex', cvr.extracted, session, slug2);
                    } else {
                      await registerComponent(comp.type, fixVr.extracted || content, session, slug2);
                    }
                    await writeProjectLog(projectId, 'test_fix_reregistered', { meta: { component: comp.label, round: fix + 1, by: 'autopilot' } });
                    // Re-activate after re-register
                    if (comp.type === 'extension' || comp.type === 'cortex') {
                      const actUrl = comp.type === 'extension'
                        ? `/v1/extensions/${encodeURIComponent(updated.registeredAs)}/activate`
                        : `/v1/cortex/${encodeURIComponent(updated.registeredAs)}/activate`;
                      await apiPost(actUrl);
                    }
                  } catch (e) {
                    showToast?.(`${comp.label}: Re-register failed: ${e.message}`, true);
                    await writeProjectLog(projectId, 'test_fix_reregister_failed', { meta: { component: comp.label, round: fix + 1, error: e.message, by: 'autopilot' } });
                    continue;
                  }

                  // Re-test with the same AI-generated test code
                  await writeProjectLog(projectId, 'test_fix_retesting', { meta: { component: comp.label, round: fix + 1, by: 'autopilot' } });
                  const reTestResp = await runComponentTest(projectId, comp.id, aiTestCode, testEnvironment);
                  const reTestResult = reTestResp?.data?.result || reTestResp?.result;

                  // Update sidebar indicator with re-test result
                  if (reTestResult) {
                    setTestReport(prev => {
                      const existing = prev || { level: testScope, timestamp: new Date().toISOString(), components: [], overall: 'passed' };
                      const comps = existing.components.filter(c => c.componentId !== comp.id);
                      comps.push(reTestResult);
                      const failedCount = comps.filter(c => c.status === 'failed').length;
                      const passedCount = comps.filter(c => c.status === 'passed').length;
                      return { ...existing, components: comps, overall: failedCount === 0 ? 'passed' : (passedCount > 0 ? 'partial' : 'failed') };
                    });
                  }

                  if (reTestResult && reTestResult.status !== 'failed') {
                    fixed = true;
                    await writeProjectLog(projectId, 'component_test_fixed', { meta: { component: comp.label, fixRound: fix + 1, by: 'autopilot' } });
                    showToast?.(`${comp.label}: ${t('profile.generator.test_passed')}`);
                  } else {
                    testResult.errors = reTestResult?.errors || testResult.errors;
                    await writeProjectLog(projectId, 'test_fix_still_failing', { meta: { component: comp.label, round: fix + 1, errors: reTestResult?.errors, by: 'autopilot' } });
                  }
                }

                if (!fixed && !autopilotCancelledRef.current) {
                  await writeProjectLog(projectId, 'component_test_gave_up', { meta: { component: comp.label, maxRounds: MAX_FIX, by: 'autopilot' } });
                  showToast?.(`${comp.label}: ${t('profile.generator.test_fix_round')} ${MAX_FIX}`, true);
                  // Continue to next component — don't block the whole pipeline
                }

                await loadData();
              } else if (testResult) {
                await writeProjectLog(projectId, 'component_test_passed', { meta: { component: comp.label, by: 'autopilot' } });
              } else {
                await writeProjectLog(projectId, 'component_test_no_result', { meta: { component: comp.label, response: JSON.stringify(testResp).slice(0, 200), by: 'autopilot' } });
              }
            } catch (e) {
              // Test execution failed — log but continue
              await writeProjectLog(projectId, 'component_test_error', { meta: { component: comp.label, error: e.message, by: 'autopilot' } });
              showToast?.(`${comp.label}: Test error: ${e.message}`, true);
            }
          }
        }
      }
    } catch (e) {
      showToast?.(e.message, true);
    }

    setAutopilotRunning(false);
    setCurrentAutopilotStep('');
    await loadData();
  }

  function handleCancelAutopilot() {
    autopilotCancelledRef.current = true;
    cancelAiRequest(); // Abort the HTTP request immediately
    setCurrentAutopilotStep(t('profile.generator.openrouter.cancel') + '...');
  }

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

  // Test execution handler — runs per-component AI-generated tests sequentially
  async function handleRunTests() {
    if (testScope === 'none') return;
    setTestRunning(true);
    setTestReport(null);
    const testableTypes = ['extension', 'cortex', 'app'];
    // Fetch fresh state from API — closure components may be stale
    const freshComps = await loadAllComponents(projectId);
    const testableComps = freshComps.filter(c => testableTypes.includes(c.type) && c.registeredAs);

    if (testableComps.length === 0) {
      showToast?.(t('profile.generator.test_no_testable'), true);
      setTestRunning(false);
      return;
    }

    const report = { level: testScope, timestamp: new Date().toISOString(), components: [], overall: 'passed' };
    await writeProjectLog(projectId, 'tests_batch_start', { meta: { scope: testScope, count: testableComps.length } });

    for (const comp of testableComps) {
      const testEnvironment = (comp.type === 'cortex' || comp.type === 'app') ? 'browser' : 'server';

      // Ensure extension/cortex is activated before testing
      if (comp.type === 'extension' || comp.type === 'cortex') {
        try {
          const actUrl = comp.type === 'extension'
            ? `/v1/extensions/${encodeURIComponent(comp.registeredAs)}/activate`
            : `/v1/cortex/${encodeURIComponent(comp.registeredAs)}/activate`;
          await apiPost(actUrl);
        } catch { /* already active or activation failed — test will reveal */ }
      }

      // Use saved test code if available, otherwise generate new
      let testCode = comp.testCode;
      if (!testCode) {
        try {
          await writeProjectLog(projectId, 'test_prompt_generating', { meta: { component: comp.label, type: comp.type, by: 'batch' } });
          const testPrompt = buildTestPrompt(
            comp.type, comp.result, comp.label, comp.registeredAs,
            project.blueprint, interviewSpec
          );
          testCode = await runWithAi(projectId, testPrompt);
          testCode = stripCodeblock(testCode);
          // Save generated test code
          await saveComponent(projectId, { ...comp, testPrompt: testPrompt, testCode, testEnvironment });
          await writeProjectLog(projectId, 'test_code_generated', { meta: { component: comp.label, environment: testEnvironment, by: 'batch' } });
        } catch (e) {
          await writeProjectLog(projectId, 'test_code_generation_failed', { meta: { component: comp.label, error: e.message, by: 'batch' } });
          report.components.push({ componentId: comp.id, type: comp.type, status: 'failed', scenarios: 0, passed: 0, errors: [`Test generation failed: ${e.message}`], screenshots: [], fixRound: 0 });
          continue;
        }
      }

      // Execute test
      try {
        await writeProjectLog(projectId, 'test_executing', { meta: { component: comp.label, environment: testEnvironment, by: 'batch' } });
        const testResp = await runComponentTest(projectId, comp.id, testCode, testEnvironment);
        const testResult = testResp?.data?.result || testResp?.result;
        if (testResult) {
          report.components.push(testResult);
          await saveComponent(projectId, { ...comp, testResult });
          await writeProjectLog(projectId, 'component_test_' + testResult.status, { meta: { component: comp.label, errors: testResult.errors, by: 'batch' } });
        } else {
          report.components.push({ componentId: comp.id, type: comp.type, status: 'failed', scenarios: 0, passed: 0, errors: ['No test result returned'], screenshots: [], fixRound: 0 });
        }
      } catch (e) {
        report.components.push({ componentId: comp.id, type: comp.type, status: 'failed', scenarios: 0, passed: 0, errors: [e.message], screenshots: [], fixRound: 0 });
        await writeProjectLog(projectId, 'component_test_error', { meta: { component: comp.label, error: e.message, by: 'batch' } });
      }

      // Update report status
      const failedCount = report.components.filter(c => c.status === 'failed').length;
      const passedCount = report.components.filter(c => c.status === 'passed').length;
      report.overall = failedCount === 0 ? 'passed' : (passedCount > 0 ? 'partial' : 'failed');
      setTestReport({ ...report });
    }

    await writeProjectLog(projectId, 'tests_batch_complete', { meta: { scope: testScope, overall: report.overall, total: report.components.length } });
    if (report.overall === 'passed') {
      showToast?.(t('profile.generator.test_passed'));
    } else {
      showToast?.(t('profile.generator.test_failed'), true);
    }
    setTestRunning(false);
    await loadData();
  }

  // Test fix loop handler — auto-fix failed component, re-register, re-test (max 3 rounds)
  async function handleTestFixRequest(componentId, action) {
    if (action === 'skip') return;
    if (action === 'manual') {
      // Select the failed component for manual editing
      setSelectedId(componentId);
      return;
    }
    // action === 'auto' — run fix loop
    const MAX_FIX_ROUNDS = 3;
    if (testFixRound >= MAX_FIX_ROUNDS) {
      showToast?.(t('profile.generator.test_fix_round') + ' ' + MAX_FIX_ROUNDS + ' — ' + t('profile.generator.test_fix_manual'), true);
      return;
    }

    const comp = components.find(c => c.id === componentId);
    if (!comp) return;

    const failedTestComp = testReport?.components?.find(c => c.componentId === componentId);
    if (!failedTestComp) return;

    // Build test context for the fix prompt
    const blueprintComp = project?.blueprint?.components?.find(c => c.id === componentId);
    const testContext = {
      errors: failedTestComp.errors || [],
      dependencyResults: (testReport?.components || [])
        .filter(c => c.componentId !== componentId && c.status === 'passed')
        .map(c => ({ componentId: c.componentId, status: c.status })),
      blueprintComponent: blueprintComp || null,
    };

    setTestRunning(true);
    setTestFixRound(prev => prev + 1);
    showToast?.(t('profile.generator.test_fix_round') + ' ' + (testFixRound + 1));

    try {
      // Build fix prompt with test context
      const completedComps = components.filter(c => c.status === 'done' && c.registeredAs);
      const originalPrompt = comp.prompt || buildComponentPrompt(
        comp.type, comp.label,
        project.description, project.blueprint, completedComps,
        interviewSpec,
      );
      const fixP = buildFixPrompt(originalPrompt, comp.result || '', failedTestComp.errors || [], comp.type, testContext);

      // Run AI for fix
      let content = await runWithAi(projectId, fixP);
      if (comp.type === 'extension') content = stripCodeblock(content);

      // Validate
      let vr = validateComponent(comp.type, content, project.blueprint);

      // Auto-retry validation if enabled
      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          showToast?.(t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
          const retryP = buildFixPrompt(originalPrompt, content, vr.errors, comp.type);
          content = await runWithAi(projectId, retryP);
          if (comp.type === 'extension') content = stripCodeblock(content);
          vr = validateComponent(comp.type, content, project.blueprint);
        }
      }

      if (!vr.valid) {
        showToast?.(t('profile.generator.openrouter.stepFailed') + ': ' + comp.label, true);
        setTestRunning(false);
        return;
      }

      // Save fixed result
      const updated = {
        ...comp, status: 'done', result: content, validationErrors: [],
        history: [...(comp.history || []),
          { action: 'test_fix', at: new Date().toISOString(), by: 'autopilot', round: testFixRound + 1 },
        ],
      };
      await saveComponent(projectId, updated);

      // Re-register
      const extComp = components.find(c => c.type === 'extension' && c.registeredAs);
      const csmComp = components.find(c => c.type === 'csm' && c.registeredAs);
      const serviceSlug = extComp?.registeredAs || csmComp?.registeredAs?.split('/')?.pop() || '';
      if (comp.type === 'cortex') {
        const cortexVr = validateComponent('cortex', content, project.blueprint);
        await registerComponent('cortex', cortexVr.extracted, session, serviceSlug);
      } else {
        await registerComponent(comp.type, vr.extracted || content, session, serviceSlug);
      }
      await writeProjectLog(projectId, 'test_fix_registered', { meta: { component: comp.label, round: testFixRound + 1 } });
      await loadData();

      // Re-run tests
      const resp = await runTests(projectId, testScope);
      const report = resp?.data || resp;
      setTestReport(report);
      await writeProjectLog(projectId, 'tests_rerun', { meta: { scope: testScope, overall: report.overall, fixRound: testFixRound + 1 } });

      if (report.overall === 'passed') {
        showToast?.(t('profile.generator.test_passed'));
      } else {
        showToast?.(t('profile.generator.test_failed'), true);
      }
    } catch (e) {
      showToast?.(e.message, true);
    }
    setTestRunning(false);
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
      ${components.length > 0 && !autopilotRunning && html`
        <${TestScopeSelector} value=${testScope} onChange=${setTestScope} />
      `}

      <!-- Autopilot: Run All Steps -->
      ${orSettings?.hasApiKey && components.length > 0 && html`
        <div class="pf-gen-or-run-all-bar">
          ${autopilotRunning
            ? html`
              <div class="pf-gen-or-run-all-status">
                <span class="pf-gen-or-spinner"></span>
                <span>${currentAutopilotStep}</span>
              </div>
              <button class="btn-danger btn-sm" onClick=${handleCancelAutopilot}>
                ${t('profile.generator.openrouter.cancel')}
              </button>
            `
            : html`
              <button class="btn-primary btn-sm" onClick=${handleRunAll}
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
              onClick=${handleActivateAll}
              disabled=${lifecycleLoading !== null || registeredCount === 0}>
              ${lifecycleLoading === 'activate' ? '...' : t('profile.generator.activateAll')}
            </button>
            <button class="btn-outline btn-sm"
              onClick=${handleDeactivateAll}
              disabled=${lifecycleLoading !== null || activeCount === 0}>
              ${lifecycleLoading === 'deactivate' ? '...' : t('profile.generator.deactivateAll')}
            </button>
            ${hasApp && html`
              <button class="btn-primary btn-sm" onClick=${handleLaunchApp}>
                ${t('profile.generator.launchApp')}
              </button>
            `}
            <button class="btn-outline btn-sm" onClick=${() => refreshStatuses()} title=${t('profile.generator.refreshTitle')}>
              ${t('profile.generator.refresh')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${() => editMode ? exitEditMode() : setEditMode('request')}>
              ${editMode ? t('profile.generator.cancelEdit') : t('profile.generator.editService')}
            </button>
            ${project?.blueprint?.settings && html`
              <button class="btn-ghost btn-sm" onClick=${() => setShowSettingsPanel(!showSettingsPanel)}>
                ${showSettingsPanel ? t('profile.generator.hideSettings') : t('profile.generator.editSettings')}
              </button>
            `}
            <button class="btn-ghost btn-sm" onClick=${() => setShowDiagnostics(!showDiagnostics)}>
              ${showDiagnostics ? t('profile.generator.hideDiagnostics') : t('profile.generator.diagnostics')}
            </button>
            <button class="btn-outline btn-sm pf-gen-remove-toggle"
              onClick=${() => { setShowRemovePanel(!showRemovePanel); setRemoveSelection({}); }}>
              ${showRemovePanel ? t('profile.generator.cancelRemove') : t('profile.generator.removeEllipsis')}
            </button>
            ${doneCount > 0 && html`
              <button class="btn-info btn-sm"
                onClick=${handleOpenPackageDialog}
                disabled=${packageLoading}>
                ${project.packageGroupId
                  ? t('profile.generator.updatePackage')
                  : t('profile.generator.packageProject')}
              </button>
            `}
          </div>
        </div>
      `}

      <!-- Package Dialog -->
      ${showPackageDialog && html`
        <div class="pf-gen-package-dialog">
          <h4>${project.packageGroupId
            ? t('profile.generator.updatePackage')
            : t('profile.generator.packageProject')}</h4>
          ${project.forkedFrom && html`
            <p class="text-caption mb-half">
              ${t('profile.generator.forkedFrom').replace('{name}', project.forkedFrom.packageGroupId).replace('{author}', project.forkedFrom.author)}
            </p>
          `}

          ${!project.packageGroupId && html`
            <label class="pf-gen-pkg-label">${t('profile.generator.packageVisibility')}
              <select value=${packageVisibility} onChange=${e => setPackageVisibility(e.target.value)}>
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </label>
          `}

          <label class="pf-gen-pkg-label">${t('profile.generator.packageCategory')}
            <input type="text" value=${packageCategory}
              onChange=${e => setPackageCategory(e.target.value)}
              placeholder="utility" />
          </label>

          <label class="pf-gen-pkg-label">${t('profile.generator.packageTags')}
            <input type="text" value=${packageTags}
              onChange=${e => setPackageTags(e.target.value)}
              placeholder="alerts, maps, finland" />
          </label>

          ${project.packageGroupId && html`
            <div class="pf-gen-changes-summary">
              <strong>${t('profile.generator.changesSummary')}</strong>
              ${packageChanges ? html`
                <ul class="pf-gen-changes-list">
                  ${packageChanges.filter(c => c.action === 'added').map(c => html`
                    <li class="pf-gen-change-added">${t('profile.generator.changeAdded')}: ${c.label}</li>
                  `)}
                  ${packageChanges.filter(c => c.action === 'modified').map(c => html`
                    <li class="pf-gen-change-modified">${t('profile.generator.changeModified')}: ${c.label}</li>
                  `)}
                  ${packageChanges.filter(c => c.action === 'removed').map(c => html`
                    <li class="pf-gen-change-removed">${t('profile.generator.changeRemoved')}: ${c.label}</li>
                  `)}
                  ${packageChanges.filter(c => c.action === 'unchanged').map(c => html`
                    <li class="pf-gen-change-unchanged">${t('profile.generator.changeUnchanged')}: ${c.label}</li>
                  `)}
                </ul>
              ` : html`<span class="text-caption">...</span>`}
              <label class="pf-gen-pkg-label">${t('profile.generator.changelogNote')}
                <input type="text" value=${changelogNote}
                  onChange=${e => setChangelogNote(e.target.value)}
                  placeholder=${t('profile.generator.changelogPlaceholder')} />
              </label>
            </div>
          `}

          <div class="flex-actions">
            <button class="btn-outline btn-sm" onClick=${() => setShowPackageDialog(false)}>
              ${t('profile.generator.cancelRemove')}
            </button>
            <button class="btn-primary btn-sm" onClick=${handlePackageProject} disabled=${packageLoading}>
              ${packageLoading ? '...' : (project.packageGroupId
                ? t('profile.generator.updatePackage')
                : t('profile.generator.packageProject'))}
            </button>
          </div>
        </div>
      `}

      <!-- Phase 5: Remove Panel -->
      ${showRemovePanel && html`
        <div class="pf-gen-remove-panel">
          <p class="pf-gen-remove-heading">${t('profile.generator.removeSelectLabel')}</p>
          <div class="pf-gen-remove-list">
            ${components.filter(c => c.registeredAs).map(c => html`
              <label class="pf-gen-remove-item">
                <input type="checkbox"
                  checked=${!!removeSelection[c.id]}
                  onChange=${e => setRemoveSelection({ ...removeSelection, [c.id]: e.target.checked })}
                />
                <span>${c.label}</span>
                <span class="pf-gen-type-badge type-${c.type}">${c.type}</span>
                <span class="pf-gen-remove-name">${c.registeredAs}</span>
              </label>
            `)}
          </div>
          <div class="flex-row">
            <label class="pf-gen-checkbox-label">
              <input type="checkbox" checked=${removeMemory} onChange=${e => setRemoveMemory(e.target.checked)} />
              ${t('profile.generator.deleteExtensionMemory')}
            </label>
            <button class="btn-danger-solid btn-sm"
              onClick=${handleRemoveConfirmed}
              disabled=${lifecycleLoading === 'remove' || Object.values(removeSelection).filter(Boolean).length === 0}>
              ${lifecycleLoading === 'remove' ? t('profile.generator.removingLabel') : t('profile.generator.removeSelected').replace('{count}', Object.values(removeSelection).filter(Boolean).length)}
            </button>
          </div>
        </div>
      `}

      <!-- Phase 6: Edit Service Panel -->
      ${editMode === 'request' && html`
        <div class="pf-gen-edit-panel">
          <h4>${t('profile.generator.editService')}</h4>
          <p class="pf-gen-subtitle">${t('profile.generator.editServiceDesc')}</p>
          <textarea class="pf-gen-result-area" rows="4"
            placeholder="${t('profile.generator.editPlaceholder')}"
            value=${changeRequest}
            onInput=${e => setChangeRequest(e.target.value)}
          />
          <div class="pf-gen-actions">
            <button class="btn-primary btn-sm" onClick=${handleCopyImpactPrompt} disabled=${!changeRequest.trim()}>
              ${t('profile.generator.copyImpactPrompt')}
            </button>
            ${orSettings?.hasApiKey && html`
              <button class="btn-outline btn-sm pf-gen-or-run-btn ${aiRunning === 'impact' ? 'pf-gen-or-running' : ''}"
                onClick=${handleRunImpactAi}
                disabled=${!changeRequest.trim() || aiRunning !== null}>
                ${aiRunning === 'impact'
                  ? html`<span class="pf-gen-or-spin">⟳</span> ${t('profile.generator.openrouter.waiting')}`
                  : t('profile.generator.openrouter.runWithAi')}
              </button>
            `}
          </div>
        </div>
      `}

      ${editMode === 'impact' && html`
        <div class="pf-gen-edit-panel">
          <h4>${t('profile.generator.impactAnalysis')}</h4>
          <p class="pf-gen-subtitle">${t('profile.generator.impactPasteDesc')}</p>
          <textarea class="pf-gen-result-area" rows="8"
            placeholder="Paste the JSON response from AI Chat..."
            value=${impactResult}
            onInput=${e => setImpactResult(e.target.value)}
          />
          ${impactErrors.length > 0 && html`
            <div class="pf-gen-errors">
              <ul>${impactErrors.map(e => html`<li>${e}</li>`)}</ul>
            </div>
          `}
          <div class="pf-gen-actions">
            <button class="btn-primary btn-sm" onClick=${handleParseImpact} disabled=${!impactResult.trim()}>
              ${t('profile.generator.analyzeImpact')}
            </button>
            <button class="btn-outline btn-sm" onClick=${() => setEditMode('request')}>${t('profile.generator.back')}</button>
          </div>
        </div>
      `}

      ${editMode === 'editing' && impactParsed && html`
        <div class="pf-gen-edit-panel">
          <h4>${t('profile.generator.impactResults')}</h4>
          ${impactParsed.summary && html`<p class="pf-gen-subtitle">${impactParsed.summary}</p>`}
          <div class="pf-gen-impact-list">
            ${impactParsed.analysis.map(a => {
              const comp = components.find(c => c.id === a.id);
              const impactClass = a.impact === 'root' ? 'impact-root' : a.impact === 'update' ? 'impact-update' : 'impact-none';
              return html`
                <div class="pf-gen-impact-item ${impactClass}">
                  <div class="pf-gen-impact-header">
                    <span class="pf-gen-impact-badge ${impactClass}">${a.impact.toUpperCase()}</span>
                    <span class="pf-gen-impact-label">${a.label}</span>
                  </div>
                  <div class="pf-gen-impact-reason">${a.reason}</div>
                  ${(a.impact === 'root' || a.impact === 'update') && comp && html`
                    <div class="pf-gen-actions mt-xs">
                      <button class="btn-outline btn-sm"
                        onClick=${() => handleCopyEditPrompt(comp, a.suggestedChange)}>
                        ${t('profile.generator.copyEditPrompt')}
                      </button>
                      ${orSettings?.hasApiKey && html`
                        <button class="btn-outline btn-sm pf-gen-or-run-btn ${aiRunning === comp.id ? 'pf-gen-or-running' : ''}"
                          onClick=${() => handleRunSingleEditAi(comp, a.suggestedChange)}
                          disabled=${aiRunning !== null || autopilotRunning}>
                          ${aiRunning === comp.id
                            ? html`<span class="pf-gen-or-spin">⟳</span> ${t('profile.generator.openrouter.waiting')}`
                            : t('profile.generator.openrouter.runWithAi')}
                        </button>
                      `}
                    </div>
                  `}
                </div>
              `;
            })}
          </div>
          <div class="pf-gen-actions">
            ${orSettings?.hasApiKey && impactParsed.analysis.some(a => a.impact === 'root' || a.impact === 'update') && html`
              <button class="btn-primary btn-sm pf-gen-or-run-btn ${autopilotRunning ? 'pf-gen-or-running' : ''}"
                onClick=${handleRunAllEditsAi}
                disabled=${autopilotRunning}>
                ${autopilotRunning
                  ? html`<span class="pf-gen-or-spin">⟳</span> ${currentAutopilotStep}`
                  : t('profile.generator.openrouter.runAll')}
              </button>
              ${autopilotRunning && html`
                <button class="btn-danger btn-sm" onClick=${handleCancelAutopilot}>
                  ${t('profile.generator.openrouter.cancel')}
                </button>
              `}
            `}
            <button class="btn-outline btn-sm" onClick=${() => setEditMode('impact')}>${t('profile.generator.backToImpact')}</button>
            <button class="btn-ghost btn-sm" onClick=${exitEditMode}>${t('profile.generator.done')}</button>
          </div>
        </div>
      `}

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
      ${showSettingsPanel && project?.blueprint?.settings && html`
        <div class="pf-gen-settings-inline">
          <${SettingsCollectionView}
            project=${project}
            blueprint=${project.blueprint}
            onComplete=${() => setShowSettingsPanel(false)}
            showToast=${showToast}
          />
        </div>
      `}

      <!-- Test Execution Panel -->
      ${registeredCount > 0 && html`
        <div class="pf-gen-test-panel">
          <div class="pf-gen-actions">
            <button class="btn-primary btn-sm"
              onClick=${handleRunTests}
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
              onFixRequest=${orSettings?.hasApiKey ? handleTestFixRequest : null}
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
              <span class="pf-gen-log-msg">${l.action}${l.errors ? ': ' + l.errors.join(', ') : ''}</span>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

/* ── Next Step Pointer ────────────────────────────────── */

/**
 * Determines which workflow step a component is at.
 * Returns step id string used to place the pointer arrow next to the right element.
 */
function getWorkflowStep(component, validationResult, result) {
  if (component.registeredAs) return 'done';
  if (validationResult?.valid === true) return 'register';
  if (validationResult?.valid === false) return 'fix';
  if ((result || '').trim()) return 'validate';
  if (component.status === 'waiting_user' || component.status === 'prompt_ready') return 'paste';
  return 'copy';
}

/** Small circle-with-arrow SVG placed inline next to the current action target.
 * @param {Object} props
 * @param {'right'|'down'} [props.direction='right'] — arrow direction
 */
function StepArrow({ direction = 'right' } = {}) {
  const chevron = direction === 'down'
    ? 'M8 10l4 4 4-4'   // ↓ pointing down
    : 'M10 8l4 4-4 4';  // → pointing right
  const cls = `pf-gen-step-arrow${direction === 'down' ? ' pf-gen-step-arrow--down' : ''}`;
  return html`<svg class=${cls} viewBox="0 0 24 24" width="22" height="22">
    <circle cx="12" cy="12" r="10" fill="var(--accent,#E8564A)" opacity="0.15"/>
    <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent,#E8564A)" stroke-width="1.5"/>
    <path d=${chevron} fill="none" stroke="var(--accent,#E8564A)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function ComponentDetail({ component, project, components, projectId, interviewSpec, liveStatuses, onUpdate, onAdvance, showToast, session, orSettings }) {
  const [result, setResult] = useState(component.result || '');
  const [validationResult, setValidationResult] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const resultRef = { current: null };

  // Test state
  const [testCode, setTestCode] = useState(component.testCode || '');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState(component.testResult || null);

  useEffect(() => {
    setResult(component.result || '');
    setTestCode(component.testCode || '');
    setTestResult(component.testResult || null);
    setValidationResult(null);
    // Auto-transition to prompt_ready when opening an unstarted component
    if (component.status === 'not_started') {
      const prompt = buildComponentPrompt(
        component.type, component.label,
        project.description, project.blueprint,
        components.filter(c => c.status === 'done'),
        interviewSpec,
      );
      saveComponent(projectId, {
        ...component, status: 'prompt_ready', prompt,
        history: [...(component.history || []), { action: 'prompt_generated', at: new Date().toISOString(), by: 'system' }],
      }).then(() => onUpdate());
    }
  }, [component.id, component.result, component.status]);

  const completedComponents = components.filter(c => c.status === 'done' && c.registeredAs);
  const prompt = component.prompt || buildComponentPrompt(
    component.type, component.label,
    project.description, project.blueprint, completedComponents,
    interviewSpec,
  );

  // Workflow step for guided UI
  const workflowStep = getWorkflowStep(component, validationResult, result);

  function addHistory(comp, action, extra = {}) {
    return { ...comp, history: [...(comp.history || []), { action, at: new Date().toISOString(), by: 'user', ...extra }] };
  }

  async function handleValidate() {
    const validating = addHistory(component, 'validating');
    await saveComponent(projectId, { ...validating, status: 'validating', result });

    const vr = validateComponent(component.type, result, project.blueprint);
    setValidationResult(vr);
    if (vr.valid) {
      const done = addHistory(validating, 'validation_passed');
      await saveComponent(projectId, { ...done, status: 'done', result, validationErrors: [] });
    } else {
      const errored = addHistory(validating, 'validation_failed', { errors: vr.errors });
      await saveComponent(projectId, { ...errored, status: 'errors', result, validationErrors: vr.errors });
    }
    onUpdate();
  }

  async function handleRegister() {
    setRegistering(true);
    try {
      // Derive service slug from extension name or CSM for service-prefixed keys
      const extComp = components.find(c => c.type === 'extension' && c.registeredAs);
      const csmComp = components.find(c => c.type === 'csm' && c.registeredAs);
      const serviceSlug = extComp?.registeredAs
        || csmComp?.registeredAs?.split('/')?.pop()
        || '';

      let resp;
      if (component.type === 'cortex') {
        const vr = validateComponent('cortex', component.result || result, project.blueprint);
        if (!vr.valid) {
          showToast?.((t('profile.generator.validationFailed')) + ': ' + vr.errors.join(', '), true);
          setRegistering(false);
          return;
        }
        resp = await registerComponent('cortex', vr.extracted, session, serviceSlug);
      } else {
        resp = await registerComponent(component.type, validationResult?.extracted || result, session, serviceSlug);
      }
      // Extract registered name from response — each type returns a different shape
      const d = resp?.data || {};
      const regName = d.csm?.name           // CSM: { data: { csm: { name } } }
        || d.integration?.name              // MSM: { data: { integration: { name } } }
        || d.extension?.name                // Extension: { data: { extension: { name } } }
        || d.filename                       // App: { data: { filename } }
        || d.name                           // Cortex/Translation: { data: { name } }
        || d.id
        || (d.locales ? `i18n-${d.locales.join('-')}` : null) // Translation fallback
        || (d.keys?.length ? `memory:${d.keys[d.keys.length - 1]}` : null)   // Memory: use last key name (e.g. "memory:municipalities.data")
        || null;
      if (!regName) {
        // Registration succeeded but we couldn't extract the name — warn user
        showToast?.(t('profile.generator.registrationNameMissing'), true);
        setRegistering(false);
        return;
      }
      const registered = addHistory(component, 'registered', { registeredAs: regName });
      await saveComponent(projectId, { ...registered, status: 'done', registeredAs: regName });
      showToast?.(t('profile.generator.componentRegistered').replace('{name}', regName));
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
      await onUpdate();
      // Auto-advance to next component after successful registration
      if (onAdvance) onAdvance(component.id);
    } catch (e) {
      setValidationResult({ valid: false, errors: [`Registration failed: ${e.message}`] });
      showToast?.(e.message, true);
    }
    setRegistering(false);
  }

  async function handleReregister() {
    setRegistering(true);
    try {
      const extComp = components.find(c => c.type === 'extension' && c.registeredAs);
      const csmComp = components.find(c => c.type === 'csm' && c.registeredAs);
      const serviceSlug = extComp?.registeredAs || csmComp?.registeredAs?.split('/')?.pop() || '';

      // Re-validate current result before re-registering
      const vr = validateComponent(component.type, component.result || result, project.blueprint);
      if (!vr.valid) {
        showToast?.((t('profile.generator.validationFailed')) + ': ' + vr.errors.join(', '), true);
        setRegistering(false);
        return;
      }

      const resp = await reregisterComponent(projectId, component, vr, session, serviceSlug, liveStatuses);
      const d = resp?.data || {};
      const regName = d.csm?.name || d.integration?.name || d.extension?.name
        || d.filename || d.name || d.id
        || (d.locales ? `i18n-${d.locales.join('-')}` : null)
        || (d.keys?.length ? `memory:${d.keys[d.keys.length - 1]}` : null)
        || component.registeredAs;
      const updated = { ...component, status: 'done', registeredAs: regName,
        history: [...(component.history || []), { action: 're-registered', at: new Date().toISOString(), by: 'user', registeredAs: regName }],
      };
      await saveComponent(projectId, updated);
      showToast?.(t('profile.generator.reregistered').replace('{name}', regName));
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
      await onUpdate();
    } catch (e) {
      showToast?.(t('profile.generator.reregisterFailed').replace('{error}', e.message), true);
    }
    setRegistering(false);
  }

  async function handleRegeneratePrompt() {
    const fresh = buildComponentPrompt(
      component.type, component.label,
      project.description, project.blueprint,
      components.filter(c => c.status === 'done'),
      interviewSpec,
    );
    const updated = addHistory(component, 'prompt_regenerated');
    await saveComponent(projectId, { ...updated, status: 'prompt_ready', prompt: fresh });
    showToast?.(t('profile.generator.promptRegenerated'));
    onUpdate();
  }

  async function handleCopyPrompt() {
    const fresh = buildComponentPrompt(
      component.type, component.label,
      project.description, project.blueprint,
      components.filter(c => c.status === 'done'),
      interviewSpec,
    );
    try {
      await navigator.clipboard.writeText(fresh);
      const updated = addHistory(component, 'prompt_copied');
      await saveComponent(projectId, { ...updated, status: 'waiting_user', prompt: fresh });
      showToast?.(t('profile.generator.promptCopied'));
      onUpdate();
    } catch { /* clipboard fallback */ }
  }

  async function handleRunComponentAi() {
    setAiRunning(true);
    try {
      const completedComps = components.filter(c => c.status === 'done' && c.registeredAs);
      const fresh = buildComponentPrompt(
        component.type, component.label,
        project.description, project.blueprint, completedComps,
        interviewSpec,
      );
      let content = await runWithAi(projectId, fresh);
      // Strip codeblock wrappers for extensions (AI models often wrap in ```)
      if (component.type === 'extension') content = stripCodeblock(content);
      setResult(content);

      // Validate
      let vr = validateComponent(component.type, content, project.blueprint);

      // Auto-retry if enabled
      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          showToast?.(t('profile.generator.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
          const fp = buildFixPrompt(fresh, content, vr.errors, component.type);
          content = await runWithAi(projectId, fp);
          setResult(content);
          vr = validateComponent(component.type, content, project.blueprint);
        }
      }

      setValidationResult(vr);
      if (vr.valid) {
        const done = addHistory(component, 'validation_passed', { by: 'autopilot' });
        await saveComponent(projectId, { ...done, status: 'done', result: content, validationErrors: [], prompt: fresh });
        showToast?.(t('profile.generator.openrouter.stepComplete'));
      } else {
        const errored = addHistory(component, 'validation_failed', { errors: vr.errors, by: 'autopilot' });
        await saveComponent(projectId, { ...errored, status: 'errors', result: content, validationErrors: vr.errors, prompt: fresh });
        showToast?.(t('profile.generator.openrouter.stepFailed'), true);
      }
      onUpdate();
    } catch (e) {
      showToast?.(e.message, true);
    }
    setAiRunning(false);
  }

  const fixPrompt = validationResult && !validationResult.valid
    ? buildFixPrompt(prompt, result, validationResult.errors, component.type)
    : null;

  // Test prompt for testable component types
  const testableTypes = ['extension', 'cortex', 'app'];
  const isTestable = testableTypes.includes(component.type) && component.registeredAs;
  const testEnvironment = (component.type === 'cortex' || component.type === 'app') ? 'browser' : 'server';
  const currentTestPrompt = isTestable
    ? buildTestPrompt(component.type, component.result || result, component.label, component.registeredAs, project.blueprint, interviewSpec)
    : null;

  async function handleCopyTestPrompt() {
    if (!currentTestPrompt) return;
    try {
      await navigator.clipboard.writeText(currentTestPrompt);
      showToast?.(t('profile.generator.test_prompt_copied'));
      await writeProjectLog(projectId, 'test_prompt_copied', { meta: { component: component.label, by: 'user' } });
    } catch { /* clipboard fallback */ }
  }

  async function handleRunComponentTest() {
    if (!testCode.trim()) return;
    setTestRunning(true);
    setTestResult(null);
    // Ensure extension/cortex is activated before testing
    if (component.type === 'extension' || component.type === 'cortex') {
      try {
        const actUrl = component.type === 'extension'
          ? `/v1/extensions/${encodeURIComponent(component.registeredAs)}/activate`
          : `/v1/cortex/${encodeURIComponent(component.registeredAs)}/activate`;
        await apiPost(actUrl);
      } catch { /* already active */ }
    }
    await writeProjectLog(projectId, 'test_executing', { meta: { component: component.label, environment: testEnvironment, by: 'user' } });
    try {
      const resp = await runComponentTest(projectId, component.id, testCode, testEnvironment);
      const tr = resp?.data?.result || resp?.result;
      setTestResult(tr);
      // Save test code and result to component
      await saveComponent(projectId, {
        ...component, testCode, testPrompt: currentTestPrompt, testEnvironment, testResult: tr,
        history: [...(component.history || []), { action: 'test_' + (tr?.status || 'unknown'), at: new Date().toISOString(), by: 'user', errors: tr?.errors }],
      });
      if (tr?.status === 'passed') {
        showToast?.(t('profile.generator.test_passed'));
        await writeProjectLog(projectId, 'component_test_passed', { meta: { component: component.label, by: 'user' } });
      } else {
        showToast?.(t('profile.generator.test_failed'), true);
        await writeProjectLog(projectId, 'component_test_failed', { meta: { component: component.label, errors: tr?.errors, by: 'user' } });
      }
      onUpdate();
    } catch (e) {
      showToast?.(`Test error: ${e.message}`, true);
      await writeProjectLog(projectId, 'component_test_error', { meta: { component: component.label, error: e.message, by: 'user' } });
    }
    setTestRunning(false);
  }

  async function handleRunTestWithAi() {
    if (!isTestable || !orSettings?.hasApiKey) return;
    setTestRunning(true);
    setTestResult(null);
    // Ensure extension/cortex is activated before testing
    if (component.type === 'extension' || component.type === 'cortex') {
      try {
        const actUrl = component.type === 'extension'
          ? `/v1/extensions/${encodeURIComponent(component.registeredAs)}/activate`
          : `/v1/cortex/${encodeURIComponent(component.registeredAs)}/activate`;
        await apiPost(actUrl);
      } catch { /* already active */ }
    }
    await writeProjectLog(projectId, 'test_prompt_generating', { meta: { component: component.label, type: component.type, by: 'user-ai' } });
    try {
      let aiCode = await runWithAi(projectId, currentTestPrompt);
      aiCode = stripCodeblock(aiCode);
      setTestCode(aiCode);
      await saveComponent(projectId, { ...component, testCode: aiCode, testPrompt: currentTestPrompt, testEnvironment });
      await writeProjectLog(projectId, 'test_code_generated', { meta: { component: component.label, environment: testEnvironment, codeLength: aiCode.length, by: 'user-ai' } });

      // Execute immediately
      await writeProjectLog(projectId, 'test_executing', { meta: { component: component.label, environment: testEnvironment, by: 'user-ai' } });
      const resp = await runComponentTest(projectId, component.id, aiCode, testEnvironment);
      const tr = resp?.data?.result || resp?.result;
      setTestResult(tr);
      await saveComponent(projectId, {
        ...component, testCode: aiCode, testPrompt: currentTestPrompt, testEnvironment, testResult: tr,
        history: [...(component.history || []), { action: 'test_' + (tr?.status || 'unknown'), at: new Date().toISOString(), by: 'user-ai', errors: tr?.errors }],
      });
      if (tr?.status === 'passed') {
        showToast?.(t('profile.generator.test_passed'));
        await writeProjectLog(projectId, 'component_test_passed', { meta: { component: component.label, by: 'user-ai' } });
      } else {
        showToast?.(t('profile.generator.test_failed'), true);
        await writeProjectLog(projectId, 'component_test_failed', { meta: { component: component.label, errors: tr?.errors, by: 'user-ai' } });
      }
      onUpdate();
    } catch (e) {
      showToast?.(`Test error: ${e.message}`, true);
      await writeProjectLog(projectId, 'component_test_error', { meta: { component: component.label, error: e.message, by: 'user-ai' } });
    }
    setTestRunning(false);
  }

  return html`
    <div class="pf-gen-component-detail">
      <div class="pf-gen-comp-header">
        <h4>${component.label}</h4>
        <span class="pf-gen-type-badge type-${component.type}">${component.type.toUpperCase()}</span>
        <span class="pf-gen-status-badge status-${component.status}">${component.status}</span>
      </div>

      <!-- AI Chat Mode -->
      <div class="pf-gen-section">
        <label>${t('profile.generator.prompt')}</label>
        <pre class="pf-gen-prompt-box">${prompt}</pre>
        <div class="flex-row-wrap">
          ${workflowStep === 'copy' && html`<${StepArrow} />`}
          <button class="btn-outline btn-sm" onClick=${handleCopyPrompt}
            title=${t('profile.generator.copyPromptHint')}>
            ${t('profile.generator.copyPrompt')}
          </button>
          ${orSettings?.hasApiKey && html`
            <button class="btn-outline btn-sm pf-gen-or-run-btn ${aiRunning ? 'pf-gen-or-running' : ''}"
              onClick=${handleRunComponentAi}
              disabled=${aiRunning || component.registeredAs}>
              ${aiRunning
                ? html`<span class="pf-gen-or-spinner"></span> ${t('profile.generator.openrouter.waiting')}`
                : t('profile.generator.openrouter.runWithAi')}
            </button>
          `}
          <button class="btn-ghost btn-sm" onClick=${handleRegeneratePrompt} title=${t('profile.generator.regeneratePromptHint')}>
            ${'↻ ' + (t('profile.generator.regeneratePrompt'))}
          </button>
        </div>
      </div>
      <div class="pf-gen-section">
        <div class="flex-row">
          <label>${t('profile.generator.result')}</label>
          ${workflowStep === 'paste' && html`<${StepArrow} direction="down" />`}
        </div>
        ${component.type === 'extension' && html`
          <p class="pf-gen-hint">${t('profile.generator.extensionPasteHint')}</p>
        `}
        <textarea
          ref=${el => { resultRef.current = el; }}
          class="pf-gen-result-area"
          rows="12"
          placeholder=${component.type === 'extension'
            ? t('profile.generator.extensionResultPlaceholder')
            : t('profile.generator.resultPlaceholder')}
          value=${result}
          onInput=${e => setResult(e.target.value)}
        />
        <div class="pf-gen-actions">
          ${workflowStep === 'validate' && html`<${StepArrow} />`}
          <button class="btn-primary btn-sm" onClick=${handleValidate} disabled=${!result.trim()}
            title=${t('profile.generator.validateHint')}>
            ${t('profile.generator.validate')}
          </button>
          ${validationResult?.valid && html`
            ${workflowStep === 'register' && html`<${StepArrow} />`}
            <button class="btn-success btn-sm" onClick=${handleRegister} disabled=${registering}
              title=${t('profile.generator.registerHint')}>
              ${registering ? '...' : t('profile.generator.register')}
            </button>
          `}
          ${component.registeredAs && result.trim() && html`
            <button class="btn-outline btn-sm" onClick=${handleReregister} disabled=${registering}
              title=${t('profile.generator.reregisterHint')}>
              ${registering ? '...' : (t('profile.generator.reregister'))}
            </button>
          `}
        </div>
      </div>

      <!-- Errors -->
      ${validationResult && !validationResult.valid && html`
        <div class="pf-gen-errors">
          <label>${t('profile.generator.errors')}</label>
          <ul>
            ${validationResult.errors.map(e => html`<li>${e}</li>`)}
          </ul>
          ${fixPrompt && html`
            <div class="flex-row">
              ${workflowStep === 'fix' && html`<${StepArrow} />`}
              <button class="btn-primary btn-sm" onClick=${() => navigator.clipboard.writeText(fixPrompt)}>
                ${t('profile.generator.copyFixPrompt')}
              </button>
            </div>
          `}
        </div>
      `}

      <!-- Test Section (for registered testable components) -->
      <!-- Same structure as component generation: PROMPT → RESULT (test code) → RUN -->
      ${isTestable && html`
        <div class="pf-gen-section pf-gen-test-section">
          <label>${t('profile.generator.test_prompt')} (${testEnvironment})</label>
          <pre class="pf-gen-prompt-box">${currentTestPrompt}</pre>
          <div class="flex-row-wrap">
            <button class="btn-outline btn-sm" onClick=${handleCopyTestPrompt}>
              ${t('profile.generator.test_copy_prompt')}
            </button>
            ${orSettings?.hasApiKey && html`
              <button class="btn-outline btn-sm pf-gen-or-run-btn ${testRunning ? 'pf-gen-or-running' : ''}"
                onClick=${handleRunTestWithAi}
                disabled=${testRunning}>
                ${testRunning
                  ? html`<span class="pf-gen-or-spinner"></span> ${t('profile.generator.test_running')}`
                  : t('profile.generator.test_run_with_ai')}
              </button>
            `}
          </div>
        </div>
        <div class="pf-gen-section">
          <label>${t('profile.generator.test_code')}</label>
          <textarea
            class="pf-gen-result-area"
            rows="8"
            placeholder=${t('profile.generator.test_code_placeholder')}
            value=${testCode}
            onInput=${e => setTestCode(e.target.value)}
          />
          <div class="pf-gen-actions">
            <button class="btn-primary btn-sm" onClick=${handleRunComponentTest}
              disabled=${!testCode.trim() || testRunning}>
              ${testRunning
                ? html`<span class="pf-gen-or-spinner"></span> ${t('profile.generator.test_running')}`
                : t('profile.generator.test_run')}
            </button>
          </div>
        </div>

        <!-- Test Result -->
        ${testResult && html`
          <div class="pf-gen-section">
            <div class="pf-gen-test-result-detail pf-gen-test-${testResult.status}">
              <strong>${t('profile.generator.test_result_title')}: ${t('profile.generator.test_component_' + testResult.status)}</strong>
              ${testResult.errors && testResult.errors.length > 0 && html`
                <ul class="pf-gen-test-errors">
                  ${testResult.errors.map(e => html`<li>${e}</li>`)}
                </ul>
              `}
              ${testResult.screenshots && testResult.screenshots.length > 0 && html`
                <div class="pf-gen-test-screenshots">
                  <div class="pf-gen-screenshot-grid">
                    ${testResult.screenshots.map(s => html`
                      <img src=${screenshotUrl(projectId, s)} class="pf-gen-screenshot" alt=${s}
                        onClick=${() => window.open(screenshotUrl(projectId, s), '_blank')} />
                    `)}
                  </div>
                </div>
              `}
            </div>
          </div>
        `}
      `}
    </div>
  `;
}

/* ── Test Scope & Results ────────────────────────────── */

function TestScopeSelector({ value, onChange, compact }) {
  return html`<div class="pf-gen-test-scope ${compact ? 'pf-gen-test-scope-compact' : ''}">
    ${!compact && html`<h4>${t('profile.generator.test_scope_title')}</h4>`}
    ${['comprehensive', 'basic', 'none'].map(level => html`
      <label class="pf-gen-or-radio-label" title=${t('profile.generator.test_scope_' + level)}>
        <input type="radio" name="test-scope-${compact ? 'compact' : 'full'}" value=${level}
          checked=${value === level}
          onChange=${() => onChange(level)} />
        ${compact
          ? (level === 'comprehensive' ? '✓ ' + t('profile.generator.test_scope_comprehensive_short')
            : level === 'basic' ? '○ ' + t('profile.generator.test_scope_basic_short')
            : '— ' + t('profile.generator.test_scope_none_short'))
          : t('profile.generator.test_scope_' + level)}
      </label>
    `)}
  </div>`;
}

function TestResultsView({ report, projectId, onFixRequest }) {
  if (!report) return null;

  const overallKey = report.overall === 'passed' ? 'test_passed'
    : report.overall === 'partial' ? 'test_partial'
    : 'test_failed';

  return html`<div class="pf-gen-test-results">
    <div class="pf-gen-test-overall pf-gen-test-${report.overall}">
      ${t('profile.generator.' + overallKey)}
    </div>
    ${(report.components || []).map(c => html`
      <div class="pf-gen-test-component pf-gen-test-${c.status}">
        <strong>${c.componentId}</strong>
        <span class="pf-gen-test-badge">${t('profile.generator.test_component_' + c.status)}</span>
        <span>${c.passed}/${c.scenarios}</span>
        ${c.errors && c.errors.length > 0 && html`<ul class="pf-gen-test-errors">
          ${c.errors.map(e => html`<li>${e}</li>`)}
        </ul>`}
        ${c.screenshots && c.screenshots.length > 0 && html`<div class="pf-gen-test-screenshots">
          <strong>${t('profile.generator.test_screenshots')}</strong>
          <div class="pf-gen-screenshot-grid">
            ${c.screenshots.map(s => html`
              <img src=${screenshotUrl(projectId, s)} class="pf-gen-screenshot" alt=${s}
                onClick=${() => window.open(screenshotUrl(projectId, s), '_blank')} />
            `)}
          </div>
        </div>`}
        ${c.status === 'failed' && onFixRequest && html`<div class="pf-gen-test-fix-actions">
          <button class="btn-primary" onClick=${() => onFixRequest(c.componentId, 'auto')}>
            ${t('profile.generator.test_fix_auto')}
          </button>
          <button class="btn-outline" onClick=${() => onFixRequest(c.componentId, 'manual')}>
            ${t('profile.generator.test_fix_manual')}
          </button>
          <button class="btn-ghost" onClick=${() => onFixRequest(c.componentId, 'skip')}>
            ${t('profile.generator.test_fix_skip')}
          </button>
        </div>`}
      </div>
    `)}
  </div>`;
}

/* ── OpenRouter Settings ─────────────────────────────── */

function OpenRouterSettings({ onSettingsChange }) {
  const [collapsed, setCollapsed] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [autoRetry, setAutoRetry] = useState(false);
  const [maxRetries, setMaxRetries] = useState(3);
  const [provider, setProvider] = useState('openrouter');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null); // { text, error }
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const resp = await apiGet('/v1/openrouter/settings');
      if (resp.ok !== false && resp.data) {
        setHasApiKey(!!resp.data.hasApiKey);
        setModel(resp.data.model || '');
        setAutoRetry(!!resp.data.autoRetry);
        setMaxRetries(resp.data.maxRetries || 3);
        setProvider(resp.data.provider || 'openrouter');
        setBaseUrl(resp.data.baseUrl || '');
        if (resp.data.hasApiKey) loadModels();
      }
    } catch { /* no settings yet */ }
    setLoaded(true);
  }

  // Notify parent whenever key settings change
  useEffect(() => {
    if (loaded && onSettingsChange) {
      onSettingsChange({ hasApiKey: hasApiKey, autoRetry, maxRetries, provider, baseUrl });
    }
  }, [loaded, hasApiKey, autoRetry, maxRetries, provider, baseUrl]);

  async function loadModels() {
    setModelsLoading(true);
    try {
      const resp = await apiGet('/v1/openrouter/models');
      if (resp.ok !== false && resp.data?.models) {
        setModels(resp.data.models);
      }
    } catch { /* couldn't fetch models */ }
    setModelsLoading(false);
  }

  function showMsg(text, error = false) {
    setMessage({ text, error });
    setTimeout(() => setMessage(null), 4000);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body = { model, autoRetry, maxRetries: parseInt(maxRetries) || 3, provider, baseUrl };
      if (apiKey) body.apiKey = apiKey;
      const resp = await apiPut('/v1/openrouter/settings', body);
      if (resp.ok === false) {
        showMsg(resp.error?.message || t('profile.generator.openrouter.testFail'), true);
      } else {
        showMsg(t('profile.generator.openrouter.apiKeySaved'));
        setHasApiKey(true);
        setApiKey('');
        if (apiKey) loadModels();
      }
    } catch (e) {
      showMsg(e.message, true);
    }
    setSaving(false);
  }

  async function handleTest() {
    setTesting(true);
    try {
      const resp = await apiPost('/v1/openrouter/test');
      if (resp.ok === false) {
        showMsg(t('profile.generator.openrouter.testFail') + (resp.error?.message ? ': ' + resp.error.message : ''), true);
      } else {
        showMsg(t('profile.generator.openrouter.testSuccess'));
      }
    } catch (e) {
      showMsg(t('profile.generator.openrouter.testFail') + ': ' + e.message, true);
    }
    setTesting(false);
  }

  async function handleDelete() {
    if (!confirm(t('profile.generator.openrouter.deleteConfirm'))) return;
    try {
      await apiDelete('/v1/openrouter/settings');
      setHasApiKey(false);
      setApiKey('');
      setModel('');
      setModels([]);
      setAutoRetry(false);
      setMaxRetries(3);
      showMsg(t('profile.generator.openrouter.delete'));
    } catch (e) {
      showMsg(e.message, true);
    }
  }

  if (!loaded) return null;

  return html`
    <div class="pf-gen-or-wrapper">
      <button class="pf-gen-or-toggle" onClick=${() => setCollapsed(!collapsed)}>
        <span class="pf-gen-or-toggle-icon">${collapsed ? '\u25B6' : '\u25BC'}</span>
        <span>${t('profile.generator.openrouter.title')}</span>
        ${hasApiKey && html`<span class="pf-gen-or-status-dot"></span>`}
      </button>
      ${!collapsed && html`
        <div class="pf-gen-or-panel">
          <!-- Provider selector -->
          <div class="pf-gen-or-field">
            <label class="pf-gen-or-label">${t('profile.generator.openrouter.provider')}</label>
            <div class="pf-gen-or-radio-group">
              ${['openrouter', 'lmstudio', 'custom'].map(p => html`
                <label class="pf-gen-or-radio-label">
                  <input type="radio" name="ai-provider" value=${p}
                    checked=${provider === p}
                    onChange=${() => {
                      setProvider(p);
                      if (p === 'lmstudio') setBaseUrl('http://localhost:1234/v1');
                      else if (p === 'openrouter') setBaseUrl('');
                    }} />
                  ${t('profile.generator.openrouter.provider_' + p)}
                </label>
              `)}
            </div>
          </div>

          <!-- Base URL (lmstudio / custom) -->
          ${provider !== 'openrouter' && html`
            <div class="pf-gen-or-field">
              <label class="pf-gen-or-label">${t('profile.generator.openrouter.baseUrl')}</label>
              <input
                type="url"
                class="pf-gen-or-input"
                value=${baseUrl}
                placeholder=${t('profile.generator.openrouter.baseUrl_hint')}
                onInput=${e => setBaseUrl(e.target.value)}
              />
            </div>
          `}

          <!-- API Key -->
          <div class="pf-gen-or-field">
            <label class="pf-gen-or-label">${t('profile.generator.openrouter.apiKey')}</label>
            <input
              type="password"
              class="pf-gen-or-input"
              placeholder=${hasApiKey ? t('profile.generator.openrouter.apiKeyMasked') : t('profile.generator.openrouter.apiKeyPlaceholder')}
              value=${apiKey}
              onInput=${e => setApiKey(e.target.value)}
            />
          </div>

          <!-- Model -->
          <div class="pf-gen-or-field">
            <label class="pf-gen-or-label">${t('profile.generator.openrouter.model')}</label>
            ${modelsLoading
              ? html`<span class="pf-gen-or-loading">${t('profile.loading')}</span>`
              : html`
                <select
                  class="pf-gen-or-select"
                  value=${model}
                  onChange=${e => setModel(e.target.value)}
                  disabled=${!hasApiKey && !apiKey}
                >
                  <option value="">${t('profile.generator.openrouter.modelSelect')}</option>
                  ${models.map(m => html`
                    <option value=${m.id}>${m.name || m.id}</option>
                  `)}
                </select>
              `
            }
          </div>

          <!-- Auto-retry -->
          <div class="pf-gen-or-field">
            <label class="pf-gen-or-checkbox">
              <input
                type="checkbox"
                checked=${autoRetry}
                onChange=${e => setAutoRetry(e.target.checked)}
              />
              ${t('profile.generator.openrouter.autoRetry')}
            </label>
          </div>

          <!-- Max retries (conditional) -->
          ${autoRetry && html`
            <div class="pf-gen-or-field">
              <label class="pf-gen-or-label">${t('profile.generator.openrouter.maxRetries')}</label>
              <input
                type="number"
                class="pf-gen-or-input pf-gen-or-input-sm"
                min="1"
                max="10"
                value=${maxRetries}
                onInput=${e => setMaxRetries(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
              />
            </div>
          `}

          <!-- Message -->
          ${message && html`
            <div class="pf-gen-or-message ${message.error ? 'pf-gen-or-message-error' : 'pf-gen-or-message-success'}">
              ${message.text}
            </div>
          `}

          <!-- Actions -->
          <div class="pf-gen-or-actions">
            <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
              ${saving ? '...' : t('profile.generator.openrouter.save')}
            </button>
            ${hasApiKey && html`
              <button class="btn-outline" onClick=${handleTest} disabled=${testing}>
                ${testing ? html`<span class="spinner"></span>` : ''}
                ${t('profile.generator.openrouter.testConnection')}
              </button>
              <button class="btn-outline btn-sm pf-gen-or-delete" onClick=${handleDelete}>
                ${t('profile.generator.openrouter.delete')}
              </button>
            `}
          </div>
        </div>
      `}
    </div>
  `;
}

/* ── Settings Collection ─────────────────────────────── */

function SettingsCollectionView({ project, blueprint, onComplete, showToast }) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  const serviceSettings = blueprint?.settings?.service || [];
  const userSettingsDef = blueprint?.settings?.user || [];
  const allSettings = [...serviceSettings, ...userSettingsDef];
  const noSettings = allSettings.length === 0;

  // Auto-skip when no settings needed (hook always called, respecting rules of hooks)
  useEffect(() => {
    if (noSettings) onComplete({});
  }, [noSettings]);

  if (noSettings) {
    return html`<p class="pf-gen-notice">${t('profile.generator.settings_no_settings')}</p>`;
  }

  const handleSave = async () => {
    setSaving(true);
    setErrors([]);

    // Check required fields
    const missing = serviceSettings.filter(s => s.required && !values[s.key]);
    if (missing.length > 0) {
      setErrors(missing.map(s => s.label + ' ' + t('profile.generator.settings_required').toLowerCase()));
      setSaving(false);
      return;
    }

    // Identify secret keys for encryption
    const secretKeys = allSettings.filter(s => s.type === 'secret').map(s => s.key);

    try {
      await saveProjectSettings(project.projectId, values, secretKeys);
      onComplete(values);
    } catch (e) {
      showToast?.(e.message, true);
    }
    setSaving(false);
  };

  return html`<div class="pf-gen-settings-collection">
    <div class="section-title section-title-spaced">${t('profile.generator.settings_title')}</div>
    <p class="section-desc">${t('profile.generator.settings_description')}</p>
    ${errors.length > 0 && html`<div class="pf-gen-errors">
      ${errors.map(e => html`<p class="pf-gen-error-line">${e}</p>`)}
    </div>`}
    ${allSettings.map(s => html`<div class="pf-gen-section">
      <label>
        ${s.label}
        ${s.required ? html` <span class="pf-gen-required">*</span>` : ''}
      </label>
      <input type=${s.type === 'secret' ? 'password' : s.type === 'number' ? 'number' : 'text'}
        value=${values[s.key] || s.default || ''}
        placeholder=${s.default ? String(s.default) : ''}
        onInput=${e => setValues(prev => ({ ...prev, [s.key]: e.target.value }))} />
    </div>`)}
    <div class="pf-gen-actions">
      <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
        ${t('profile.generator.settings_save')}
      </button>
      <button class="btn-outline" onClick=${() => onComplete({})}>
        ${t('profile.generator.settings_skip')}
      </button>
    </div>
  </div>`;
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
