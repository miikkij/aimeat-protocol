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
 *   - ProjectDashboard: moved to generator-dashboard.js (hook-per-domain architecture)
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
import { apiGet } from '/js/api.js';
import {
  listProjects, createProject, updateProject, archiveProject,
  loadAllComponents, saveComponent,
  saveInterviewSpec, getInterviewSpec,
  writeProjectLog,
} from '/js/services/generator.js';
import { buildBlueprintFixPrompt } from '/js/services/generator-prompts.js';

/** Load blueprint or interview prompt from backend (DB seeds — single source of truth) */
async function loadGeneratorPrompt(projectId, type = 'blueprint', locale = 'en') {
  const s = window.AIMEAT?.auth?.getSession?.();
  if (!s) throw new Error('Not authenticated');
  const resp = await s.fetch(`/v1/generator/${projectId}/prompts?type=${type}&locale=${locale}`);
  if (!resp.ok) throw new Error(resp.error?.message || 'Failed to load prompt');
  return resp.data?.prompt || '';
}
import { validateBlueprint, validateInterviewSpec, validateSpecQuality } from '/js/services/generator-validate.js';
import { OpenRouterSettings, SettingsCollectionView } from './generator-settings.js';
import { runWithAi } from './generator-detail.js';
import { ProjectDashboard } from './generator-dashboard.js';

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
    try {
      const prompt = await loadGeneratorPrompt(project.projectId, 'blueprint');
      navigator.clipboard.writeText(prompt).catch(() => {});
      showToast?.(t('profile.generator.blueprintPromptCopied'));
    } catch (e) {
      showToast?.(e.message, true);
    }
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
    async function handleCopyInterviewPrompt() {
      try {
        const prompt = await loadGeneratorPrompt(project.projectId, 'interview', getLocale());
        navigator.clipboard.writeText(prompt).catch(() => {});
        showToast?.(t('profile.generator.interviewPromptCopied'));
      } catch (e) {
        showToast?.(e.message, true);
      }
    }

    async function handleRunInterviewAi() {
      if (!project) return;
      setAiRunning('interview');
      try {
        const prompt = await loadGeneratorPrompt(project.projectId, 'interview', getLocale());
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
          // Spec quality gate — show warnings but allow proceeding
          const qr = validateSpecQuality(vr.parsed);
          if (qr.warnings.length > 0) showToast?.(qr.warnings.join('; '), true);
          if (!qr.valid) { setInterviewErrors(qr.errors); return; }
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
      // Spec quality gate — show warnings but allow proceeding
      const qr = validateSpecQuality(vr.parsed);
      if (qr.warnings.length > 0) showToast?.(qr.warnings.join('; '), true);
      if (!qr.valid) { setInterviewErrors(qr.errors); return; }
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
      const prompt = await loadGeneratorPrompt(project.projectId, 'blueprint');
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
