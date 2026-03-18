/**
 * @file generator-tab.js
 * @description Service Generator tab for the profile view — multi-phase UI for
 *   creating AIMEAT services via AI-assisted prompts. Includes requirements
 *   interview phase, blueprint generation, per-component generation with
 *   validation, agent queue management, and component registration (including cortex).
 * @structure
 *   - AgentListenerBar: agent discovery + setup prompt copy
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
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import {
  listProjects, getProject, createProject, updateProject, deleteProject, archiveProject,
  loadAllComponents, saveComponent, enqueueTask, pollResults, pollLogs,
  checkQueueStatus, discoverAgents, registerComponent, cleanupOldEntries,
  getListeners, buildAgentSetupPrompt, createGeneratorAgent,
  saveInterviewSpec, getInterviewSpec,
  getComponentStatuses, activateAll, deactivateAll, removeComponents, reregisterComponent, getAppLaunchUrl,
} from '/js/services/generator.js';
import { buildBlueprintPrompt, buildBlueprintFixPrompt, buildComponentPrompt, buildFixPrompt, buildInterviewPrompt, buildImpactPrompt, buildEditPrompt } from '/js/services/generator-prompts.js';
import { validateBlueprint, validateComponent, validateInterviewSpec } from '/js/services/generator-validate.js';
import { useConfirm } from '/components/Modal.js';
import {
  packageProject, updatePackageVersion, detectChanges,
  importPackageToGenerator, publishToGallery,
} from '/js/services/generator-packaging.js';

/* ── Agent Listener Status ───────────────────────────── */

function AgentListenerBar({ showToast, session }) {
  const [listeners, setListeners] = useState([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [nodeUrl, setNodeUrl] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadListeners();
    apiGet('/?format=json').then(resp => {
      setNodeUrl(resp?.data?.this_node?.base_url || resp?.data?.base_url || window.location.origin);
    }).catch(() => setNodeUrl(window.location.origin));
  }, []);

  async function loadListeners() {
    setListeners(await getListeners());
  }

  async function handleCopyPrompt() {
    const url = nodeUrl || window.location.origin;
    const ownerName = session?.owner;
    if (!ownerName) {
      showToast?.(t('profile.generator.agentCreateFailed'));
      return;
    }
    setCreating(true);
    try {
      const creds = await createGeneratorAgent(ownerName);
      const prompt = buildAgentSetupPrompt(url, creds);
      await navigator.clipboard.writeText(prompt);
      showToast?.(t('profile.generator.agentPromptCopied'));
    } catch (err) {
      console.error('Failed to create generator agent:', err);
      showToast?.(t('profile.generator.agentCreateFailed'));
    } finally {
      setCreating(false);
    }
  }

  const online = listeners.filter(l => l.online);
  const lastSync = online.length > 0
    ? new Date(Math.max(...online.map(l => new Date(l.lastPoll).getTime()))).toLocaleTimeString()
    : null;

  return html`
    <div class="pf-gen-listener-bar">
      <div class="pf-gen-listener-status">
        <span class="pf-gen-listener-dot ${online.length > 0 ? 'online' : 'offline'}"></span>
        <span class="pf-gen-listener-count">
          ${online.length > 0
            ? `${online.length} ${t('profile.generator.agentsListening')}`
            : t('profile.generator.noAgentsListening')}
        </span>
        ${lastSync && html`<span class="pf-gen-listener-sync">${t('profile.generator.lastSync')}: ${lastSync}</span>`}
      </div>
      <div class="pf-gen-listener-actions">
        <button class="btn-ghost btn-xs" onClick=${() => setShowPrompt(!showPrompt)}>
          ${showPrompt ? t('profile.generator.hideSetup') : t('profile.generator.agentSetup')}
        </button>
      </div>
    </div>
    ${showPrompt && html`
      <div class="pf-gen-agent-prompt-panel">
        <p class="pf-gen-subtitle">${t('profile.generator.agentSetupDesc')}</p>
        <button class="btn-outline btn-sm" onClick=${handleCopyPrompt} disabled=${creating}>
          ${creating ? t('profile.generator.creatingAgent') : t('profile.generator.copyAgentPrompt')}
        </button>
      </div>
    `}
  `;
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
      <${AgentListenerBar} showToast=${showToast} session=${session} />
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

function NewProjectView({ onBack, onCreated, showToast }) {
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState('describe'); // describe | blueprint | review
  const [project, setProject] = useState(null);
  const [blueprintResult, setBlueprintResult] = useState('');
  const [blueprintErrors, setBlueprintErrors] = useState([]);
  const [interviewSpec, setInterviewSpec] = useState('');
  const [interviewErrors, setInterviewErrors] = useState([]);
  const [interviewParsed, setInterviewParsed] = useState(null);

  async function handleAnalyze() {
    if (!description.trim()) return;
    try {
      const name = description.slice(0, 60).replace(/\n/g, ' ');
      const p = await createProject(name, description);
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

    async function handleSubmitSpec() {
      const vr = validateInterviewSpec(interviewSpec);
      if (!vr.valid) {
        setInterviewErrors(vr.errors);
        return;
      }
      setInterviewErrors([]);
      setInterviewParsed(vr.parsed);
      await saveInterviewSpec(project.projectId, vr.parsed);
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
          <button class="btn-primary" onClick=${handleCopyInterviewPrompt}>
            ${t('profile.generator.copyPrompt')}
          </button>
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
          <button class="btn-primary" onClick=${handleCopyBlueprintPrompt}>
            ${t('profile.generator.copyPrompt')}
          </button>
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

function AgentProgressBanner({ session, components, projectId, onStop }) {
  const isStale = session &&
    (Date.now() - new Date(session.heartbeat).getTime()) > 5 * 60 * 1000;

  async function handleStop() {
    try {
      await apiDelete(`/v1/generator/${projectId}/session`);
    } catch { /* best effort */ }
    onStop();
  }

  if (!session) return null;

  return html`<div class="pf-gen-agent-banner ${isStale ? 'stale' : ''}">
    <div class="pf-gen-agent-banner-info">
      <strong>${isStale
        ? t('profile.generator.agentBanner.disconnected')
        : t('profile.generator.agentBanner.working').replace('{agentName}', session.agentName)
      }</strong>
      ${!isStale && session.totalSteps > 0 && html`
        <span class="pf-gen-agent-banner-phase">
          ${t('profile.generator.agentBanner.phase')
            .replace('{phase}', session.phase)
            .replace('{step}', session.stepNumber)
            .replace('{total}', session.totalSteps)}
        </span>
      `}
    </div>
    <div class="pf-gen-step-indicators">
      ${components.map(c => html`
        <span class="pf-gen-step-dot ${c.status === 'registered' ? 'done' : c.id === session.componentId ? 'active' : 'pending'}"
              title=${c.id}></span>
      `)}
    </div>
    <button class="btn-ghost pf-gen-stop-btn" onClick=${handleStop}>
      ${isStale
        ? t('profile.generator.agentBanner.continueManually')
        : t('profile.generator.agentBanner.stopButton')
      }
    </button>
  </div>`;
}

function AgentSelector({ projectId, listeners, onAgentStart, onManual }) {
  const [selected, setSelected] = useState(listeners[0]?.gaii ?? null);

  useEffect(() => {
    if (listeners.length > 0 && !listeners.find(a => a.gaii === selected)) {
      setSelected(listeners[0].gaii);
    }
  }, [listeners]);

  if (listeners.length === 0) {
    return html`<div class="pf-gen-agent-selector">
      <p class="pf-gen-agent-selector-empty">${t('profile.generator.agentSelector.noAgents')}</p>
      <button class="btn-ghost" onClick=${onManual}>${t('profile.generator.agentSelector.manualButton')}</button>
    </div>`;
  }

  return html`<div class="pf-gen-agent-selector">
    <p class="pf-gen-agent-selector-subtitle">${t('profile.generator.agentSelector.subtitle')}</p>
    <div class="pf-gen-agent-list">
      ${listeners.map(agent => html`
        <label class="pf-gen-agent-option ${selected === agent.gaii ? 'selected' : ''}">
          <input type="radio" name="agent" value=${agent.gaii}
            checked=${selected === agent.gaii}
            onChange=${() => setSelected(agent.gaii)} />
          <span class="pf-gen-agent-name">${agent.name ?? agent.gaii}</span>
          <span class="pf-gen-agent-gaii">${agent.gaii}</span>
        </label>
      `)}
    </div>
    <div class="pf-gen-agent-actions">
      <button class="btn-primary" disabled=${!selected}
        onClick=${() => selected && onAgentStart(selected)}>
        ${t('profile.generator.agentSelector.startButton')}
      </button>
      <button class="btn-ghost" onClick=${onManual}>${t('profile.generator.agentSelector.manualButton')}</button>
    </div>
  </div>`;
}

function ProjectDashboard({ projectId, onBack, session, showToast }) {
  const [project, setProject] = useState(null);
  const [components, setComponents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [agents, setAgents] = useState([]);
  const [logFilter, setLogFilter] = useState(null); // null = all, or componentId
  const { confirm, ConfirmUI } = useConfirm();

  // Phase 5: Lifecycle state
  const [liveStatuses, setLiveStatuses] = useState({});
  const [lifecycleLoading, setLifecycleLoading] = useState(null); // 'activate' | 'deactivate' | null
  const [showRemovePanel, setShowRemovePanel] = useState(false);
  const [removeSelection, setRemoveSelection] = useState({});
  const [removeMemory, setRemoveMemory] = useState(false);

  // Phase 6: Edit service state
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

  // Agent-driven session state
  const [generatorSession, setGeneratorSession] = useState(null);
  const [listeners, setListeners] = useState([]);

  useEffect(() => { loadData(); }, [projectId]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [projectId]);

  async function loadData() {
    const p = await getProject(projectId);
    setProject(p);
    // Load interview spec BEFORE components — prompts need it for locale/data source threading
    try {
      const spec = await getInterviewSpec(projectId);
      setInterviewSpec(spec);
    } catch { /* no interview spec — that's fine */ }
    // Load generator session state (if any agent is executing)
    try {
      const sessionResp = await apiGet(`/v1/memory/generator.${projectId}.session`);
      setGeneratorSession(sessionResp?.data?.value ?? null);
    } catch { /* no session — that's fine */ }
    // Load listening agents for the selector
    try {
      setListeners(await getListeners(projectId));
    } catch { /* best effort */ }
    if (p?.blueprint?.components) {
      const comps = await loadAllComponents(projectId);
      setComponents(comps.length > 0 ? comps : p.blueprint.components.map(c => ({ ...c, status: 'not_started', history: [], _version: 0 })));
    }
    setAgents(await discoverAgents());
    cleanupOldEntries(projectId).catch(() => {});
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
  function handleCopyImpactPrompt() {
    const prompt = buildImpactPrompt(changeRequest, project?.blueprint);
    navigator.clipboard.writeText(prompt).catch(() => {});
    showToast?.(t('profile.generator.impactPromptCopied'));
    setEditMode('impact');
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
    } catch (e) {
      setImpactErrors([t('profile.generator.invalidJson').replace('{error}', e.message)]);
    }
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

  const selected = components.find(c => c.id === selectedId);
  const phases = project?.blueprint?.phases || [];

  // Build activity log from all component histories
  const allLogs = components.flatMap(c =>
    (c.history || []).map(h => ({ ...h, componentId: c.id, componentLabel: c.label }))
  ).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
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

  async function handleAgentStart(agentGaii) {
    const agentRecord = listeners.find(a => a.gaii === agentGaii);
    try {
      await apiPost(`/v1/generator/${projectId}/session/claim`, {
        agentGaii,
        agentName: agentRecord?.name ?? agentGaii,
      });
      await loadData();
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  function handleDeleteProject() {
    confirm(t('profile.generator.confirmDelete'), async () => {
      try {
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
      <${AgentProgressBanner}
        session=${generatorSession}
        components=${components}
        projectId=${projectId}
        onStop=${loadData}
      />
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

      ${interviewSpec && !generatorSession && !project?.blueprint && html`
        <${AgentSelector}
          projectId=${projectId}
          listeners=${listeners}
          onAgentStart=${handleAgentStart}
          onManual=${() => { /* just dismiss — user proceeds manually */ }}
        />
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
            <button class="btn-ghost btn-sm" onClick=${() => setEditMode(editMode ? null : 'request')}>
              ${editMode ? t('profile.generator.cancelEdit') : t('profile.generator.editService')}
            </button>
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
                    <button class="btn-outline btn-sm mt-xs"
                      onClick=${() => handleCopyEditPrompt(comp, a.suggestedChange)}>
                      ${t('profile.generator.copyEditPrompt')}
                    </button>
                  `}
                </div>
              `;
            })}
          </div>
          <div class="pf-gen-actions">
            <button class="btn-outline btn-sm" onClick=${() => setEditMode('impact')}>${t('profile.generator.backToImpact')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => setEditMode(null)}>${t('profile.generator.done')}</button>
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

      <div class="pf-gen-dash-body">
        <!-- Sidebar -->
        <div class="pf-gen-sidebar">
          ${phases.map(phase => html`
            <div class="pf-gen-phase-group">
              <div class="pf-gen-phase-label">${phase.label}</div>
              ${(phase.componentIds || []).map(cid => {
                const comp = components.find(c => c.id === cid) || { id: cid, label: cid, type: '?', status: 'not_started' };
                const live = liveStatuses[cid];
                return html`
                  <div
                    class="pf-gen-comp-item ${selectedId === cid ? 'active' : ''} status-${comp.status}"
                    onClick=${() => setSelectedId(cid)}
                  >
                    <span class="pf-gen-comp-name">${comp.label}</span>
                    <span class="pf-gen-type-badge type-${comp.type} ${live ? (live.active ? 'live-active' : live.installed ? 'live-installed' : 'live-missing') : ''}"
                      title=${live?.status || ''}>${comp.type.toUpperCase()}</span>
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
                agents=${agents}
                projectId=${projectId}
                interviewSpec=${interviewSpec}
                liveStatuses=${liveStatuses}
                onUpdate=${loadData}
                onAdvance=${advanceToNext}
                showToast=${showToast}
                session=${session}
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

function ComponentDetail({ component, project, components, agents, projectId, interviewSpec, liveStatuses, onUpdate, onAdvance, showToast, session }) {
  const [mode, setMode] = useState('chat');
  const [result, setResult] = useState(component.result || '');
  const [validationResult, setValidationResult] = useState(null);
  const [registering, setRegistering] = useState(false);
  const resultRef = { current: null };

  useEffect(() => {
    setResult(component.result || '');
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
  }, [component.id]);

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

  async function handleSendToAgent() {
    const agent = agents[0];
    if (!agent) return;
    await enqueueTask(projectId, component.id, component.type, prompt, agent.gaii, 'generator');
    const updated = addHistory(component, 'sent_to_agent', { agent: agent.name || agent.gaii });
    await saveComponent(projectId, { ...updated, status: 'waiting_agent', prompt });
    onUpdate();
  }

  const fixPrompt = validationResult && !validationResult.valid
    ? buildFixPrompt(prompt, result, validationResult.errors, component.type)
    : null;

  return html`
    <div class="pf-gen-component-detail">
      <div class="pf-gen-comp-header">
        <h4>${component.label}</h4>
        <span class="pf-gen-type-badge type-${component.type}">${component.type.toUpperCase()}</span>
        <span class="pf-gen-status-badge status-${component.status}">${component.status}</span>
      </div>

      <!-- Mode toggle -->
      <div class="pf-gen-mode-toggle">
        <button class=${`btn btn-sm ${mode === 'chat' ? 'btn-primary' : 'btn-ghost'}`} onClick=${() => setMode('chat')}
          title=${t('profile.generator.modeChatHint')}>
          ${t('profile.generator.modeChat')}
        </button>
        ${agents.length > 0 && html`
          <button class=${`btn btn-sm ${mode === 'agent' ? 'btn-primary' : 'btn-ghost'}`} onClick=${() => setMode('agent')}
            title=${t('profile.generator.modeAgentHint')}>
            ${t('profile.generator.modeAgent')}
          </button>
        `}
      </div>

      ${mode === 'chat' ? html`
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
      ` : html`
        <!-- Agent Mode -->
        <div class="pf-gen-section">
          <button class="btn-primary btn-sm" onClick=${handleSendToAgent}>
            ${t('profile.generator.sendToAgent')} ${agents[0]?.name || ''}
          </button>
          ${component.status === 'waiting_agent' && html`
            <div class="pf-gen-agent-status">${t('profile.generator.waitingAgent')}</div>
          `}
        </div>
      `}

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
    </div>
  `;
}

/* ── Main Tab ────────────────────────────────────────── */

export default function GeneratorTab({ session, showToast }) {
  const [view, setView] = useState('list');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [generatorEnabled, setGeneratorEnabled] = useState(true);

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
    setView('dashboard');
  }

  if (view === 'new') {
    return html`<${NewProjectView} onBack=${() => setView('list')} onCreated=${handleCreated} showToast=${showToast} />`;
  }
  if (view === 'dashboard' && activeProjectId) {
    return html`<${ProjectDashboard}
      projectId=${activeProjectId}
      onBack=${() => { setView('list'); setActiveProjectId(null); }}
      session=${session}
      showToast=${showToast}
    />`;
  }
  return html`<${ProjectListView} onSelect=${handleSelectProject} onCreate=${() => setView('new')} showToast=${showToast} session=${session} />`;
}
