/**
 * @file foundry-tab.js
 * @description Service Generator tab for the profile view — multi-phase UI for
 *   creating AIMEAT services via AI-assisted prompts. Includes requirements
 *   interview phase, blueprint generation, per-component generation with
 *   validation, and component registration (including cortex).
 * @structure
 *   - FoundryTab: root component, view state machine, OpenRouter settings relay
 *   - ProjectListView: project CRUD, archive, pagination
 *   - NewProjectView: interview → blueprint creation flow
 *   - ProjectDashboard: moved to foundry-dashboard.js (hook-per-domain architecture)
 * @usage Loaded as a tab in the profile view SPA
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial foundry tab (copied from generator)
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
 *   v7.0.0 — 2026-03-22 — Refactoring: extract ComponentDetail/test UI to foundry-detail.js,
 *     OpenRouterSettings/SettingsCollectionView to foundry-settings.js,
 *     AI utilities (runWithAi, stripCodeblock, cancelAiRequest) to foundry-detail.js
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { copyToClipboard } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';
import {
  listProjects, createProject, updateProject, archiveProject,
  loadAllComponents, saveComponent,
  saveInterviewSpec,
  writeProjectLog,
} from '/js/services/foundry.js';
import { buildBlueprintPrompt, buildBlueprintFixPrompt, buildInterviewPrompt } from '/js/services/foundry-prompts.js';
import { validateBlueprint, validateInterviewSpec, validateSpecQuality } from '/js/services/foundry-validate.js';
import { OpenRouterSettings, SettingsCollectionView } from './foundry-settings.js';
import { runWithAi } from './foundry-detail.js';
import { ProjectDashboard } from './foundry-dashboard.js';

/* ── Sub-views ───────────────────────────────────────── */

function ProjectListView({ onSelect, onCreate }) {
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

  if (loading) return html`<div class="fnd-loading">${t('profile.loading')}</div>`;

  const filtered = projects.filter(p => showArchived ? true : p.status !== 'archived');
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return html`
    <div class="fnd-project-list">
      <div class="fnd-header">
        <div class="section-title">${t('profile.foundry.title')}</div>
        <div class="fnd-header-actions">
          <label class="fnd-archive-toggle">
            <input type="checkbox" checked=${showArchived} onChange=${e => { setShowArchived(e.target.checked); setPage(0); }} />
            ${t('profile.foundry.showArchived')}
          </label>
          <button class="btn-primary" onClick=${onCreate}>+ ${t('profile.foundry.newProject')}</button>
        </div>
      </div>
      ${filtered.length === 0 && html`
        <div class="fnd-empty">${t('profile.foundry.empty')}</div>
      `}
      ${paged.map(p => html`
        <div class="fnd-project-card ${p.status === 'archived' ? 'archived' : ''}" onClick=${() => onSelect(p.projectId)}>
          <div class="fnd-project-name">${p.name}</div>
          <div class="fnd-project-meta">
            <span class="fnd-project-status">${p.status}</span>
            <span class="fnd-project-date">${p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '—'}</span>
            ${p.status !== 'archived' && html`
              <button class="btn-ghost btn-xs" onClick=${e => handleArchive(e, p)}>${t('profile.foundry.archive')}</button>
            `}
          </div>
        </div>
      `)}
      ${totalPages > 1 && html`
        <div class="fnd-pagination">
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
    await copyToClipboard(prompt);
    showToast?.(t('profile.foundry.blueprintPromptCopied'));
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
    async function handleRunInterviewAi() {
      if (!project) return;
      setAiRunning('interview');
      try {
        const prompt = buildInterviewPrompt(description, getLocale());
        let content = await runWithAi(project.projectId, prompt, null, 'reasoning');
        setInterviewSpec(content);
        // Auto-validate
        let vr = validateInterviewSpec(content);
        if (!vr.valid && orSettings?.autoRetry) {
          const max = orSettings.maxRetries || 3;
          for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
            showToast?.(t('profile.foundry.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
            const correctionPrompt = prompt + '\n\n--- PREVIOUS RESPONSE (HAD ERRORS) ---\n' + content + '\n\n--- VALIDATION ERRORS ---\n' + vr.errors.join('\n') + '\n\nPlease fix these errors and return the corrected response.';
            content = await runWithAi(project.projectId, correctionPrompt, null, 'reasoning');
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
          // Spec quality gate — show warnings but allow proceeding
          const qr = validateSpecQuality(vr.parsed);
          if (qr.warnings.length > 0) showToast?.(qr.warnings.join('; '), true);
          if (!qr.valid) { setInterviewErrors(qr.errors); return; }
          showToast?.(t('profile.foundry.openrouter.stepComplete'));
          setPhase('blueprint');
        } else {
          setInterviewErrors(vr.errors);
          showToast?.(t('profile.foundry.openrouter.stepFailed'), true);
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
      // Spec quality gate — show warnings but allow proceeding
      const qr = validateSpecQuality(vr.parsed);
      if (qr.warnings.length > 0) showToast?.(qr.warnings.join('; '), true);
      if (!qr.valid) { setInterviewErrors(qr.errors); return; }
      showToast?.(t('profile.foundry.specImported'));
      setPhase('blueprint');
    }

    function handleSkipInterview() {
      setPhase('blueprint');
    }

    return html`
      <div class="fnd-new-project">
        <button class="btn-outline" onClick=${() => setPhase('describe')}>
          ${t('profile.foundry.back')}
        </button>
        <div class="section-title section-title-spaced">${t('profile.foundry.interviewTitle')}</div>
        <div class="section-desc">
          ${t('profile.foundry.interviewDesc')}
        </div>

        <div class="fnd-section">
          <label>${t('profile.foundry.interviewPrompt')}</label>
          <div class="fnd-or-btn-row">
            <${CopyButton}
              text=${buildInterviewPrompt(description, getLocale())}
              label=${t('profile.foundry.copyPrompt')}
              className="btn-primary"
              onCopied=${() => showToast?.(t('profile.foundry.interviewPromptCopied'))} />
            ${orSettings?.hasApiKey && html`
              <button class="btn-outline fnd-or-run-btn ${aiRunning === 'interview' ? 'fnd-or-running' : ''}"
                onClick=${handleRunInterviewAi}
                disabled=${aiRunning !== null}>
                ${aiRunning === 'interview'
                  ? html`<span class="fnd-or-spinner"></span> ${t('profile.foundry.openrouter.waiting')}`
                  : t('profile.foundry.openrouter.runWithAi')}
              </button>
            `}
          </div>
        </div>

        <div class="fnd-section">
          <label>${t('profile.foundry.interviewResult')}</label>
          <textarea
            class="fnd-result-area"
            rows="14"
            placeholder=${t('profile.foundry.interviewPlaceholder')}
            value=${interviewSpec}
            onInput=${e => setInterviewSpec(e.target.value)}
          />
        </div>

        ${interviewErrors.length > 0 && html`
          <div class="fnd-errors">
            <label>${t('profile.foundry.errors')}</label>
            <ul>${interviewErrors.map(e => html`<li>${e}</li>`)}</ul>
          </div>
        `}

        <div class="fnd-actions">
          <button class="btn-primary" onClick=${handleSubmitSpec} disabled=${!interviewSpec.trim()}>
            ${t('profile.foundry.importSpec')}
          </button>
          <button class="btn-outline" onClick=${handleSkipInterview}>
            ${t('profile.foundry.skipInterview')}
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
      let content = await runWithAi(project.projectId, prompt, null, 'reasoning');
      setBlueprintResult(content);
      // Auto-validate
      let vr = validateBlueprint(content);
      if (!vr.valid && orSettings?.autoRetry) {
        const max = orSettings.maxRetries || 3;
        for (let attempt = 1; attempt <= max && !vr.valid; attempt++) {
          showToast?.(t('profile.foundry.openrouter.retrying').replace('{current}', attempt).replace('{max}', max));
          const fixPrompt = buildBlueprintFixPrompt(description, vr.errors, interviewParsed);
          content = await runWithAi(project.projectId, fixPrompt, null, 'reasoning');
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
        showToast?.(t('profile.foundry.openrouter.stepComplete'));
        onCreated({ ...project, blueprint: vr.parsed });
      } else {
        setBlueprintErrors(vr.errors);
        showToast?.(t('profile.foundry.openrouter.stepFailed'), true);
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
      <div class="fnd-new-project">
        <button class="btn-outline" onClick=${() => setPhase('describe')}>${t('profile.foundry.back')}</button>
        <div class="section-title section-title-spaced">${t('profile.foundry.blueprintTitle')}</div>
        <div class="section-desc">${t('profile.foundry.blueprintDesc')}</div>
        <div class="fnd-section">
          <label>${t('profile.foundry.prompt')}</label>
          <div class="fnd-or-btn-row">
            <button class="btn-primary" onClick=${handleCopyBlueprintPrompt}>
              ${t('profile.foundry.copyPrompt')}
            </button>
            ${orSettings?.hasApiKey && html`
              <button class="btn-outline fnd-or-run-btn ${aiRunning === 'blueprint' ? 'fnd-or-running' : ''}"
                onClick=${handleRunBlueprintAi}
                disabled=${aiRunning !== null}>
                ${aiRunning === 'blueprint'
                  ? html`<span class="fnd-or-spinner"></span> ${t('profile.foundry.openrouter.waiting')}`
                  : t('profile.foundry.openrouter.runWithAi')}
              </button>
            `}
          </div>
        </div>
        <div class="fnd-section">
          <label>${t('profile.foundry.blueprintResult')}</label>
          <textarea
            class="fnd-result-area"
            rows="12"
            placeholder=${t('profile.foundry.blueprintPlaceholder')}
            value=${blueprintResult}
            onInput=${e => setBlueprintResult(e.target.value)}
          />
        </div>
        ${blueprintErrors.length > 0 && html`
          <div class="fnd-errors">
            <label>${t('profile.foundry.errors')}</label>
            <ul>${blueprintErrors.map(e => html`<li>${e}</li>`)}</ul>
            ${fixPrompt && html`
              <${CopyButton}
                text=${fixPrompt}
                label=${t('profile.foundry.copyFixPrompt')}
                className="btn-primary btn-sm" />
            `}
          </div>
        `}
        <div class="fnd-actions">
          <button class="btn-primary" onClick=${handleSubmitBlueprint} disabled=${!blueprintResult.trim()}>
            ${t('profile.foundry.importBlueprint')}
          </button>
          <button class="btn-outline" onClick=${() => onCreated(project)}>
            ${t('profile.foundry.skipBlueprint')}
          </button>
        </div>
      </div>
    `;
  }

  return html`
    <div class="fnd-new-project">
      <button class="btn-outline" onClick=${onBack}>${t('profile.foundry.back')}</button>
      <div class="section-title section-title-spaced">${t('profile.foundry.newProjectTitle')}</div>
      <div class="section-desc">${t('profile.foundry.newProjectDesc')}</div>
      <textarea
        class="fnd-description"
        rows="8"
        placeholder=${t('profile.foundry.descPlaceholder')}
        value=${description}
        onInput=${e => setDescription(e.target.value)}
      />
      <div class="fnd-actions">
        <button class="btn-primary" onClick=${handleAnalyze} disabled=${!description.trim()}>
          ${t('profile.foundry.analyze')}
        </button>
      </div>
    </div>
  `;
}


/* ── Main Tab ────────────────────────────────────────── */

export default function FoundryTab({ session, showToast }) {
  const [view, setView] = useState('list');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [foundryEnabled, setFoundryEnabled] = useState(true);
  const [orSettings, setOrSettings] = useState({ hasApiKey: false, autoRetry: false, maxRetries: 3 });

  useEffect(() => {
    apiGet('/?format=json').then(resp => {
      const cfg = resp?.data?.config || resp?.data || {};
      if (cfg.foundry?.enabled === false || cfg.foundryEnabled === false) {
        setFoundryEnabled(false);
      }
    }).catch(() => {});
  }, []);

  if (!foundryEnabled) {
    return html`<div class="fnd-disabled">${t('profile.foundry.disabled')}</div>`;
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
