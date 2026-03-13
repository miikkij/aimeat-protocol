import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import {
  listProjects, getProject, createProject, updateProject, deleteProject, archiveProject,
  loadAllComponents, saveComponent, enqueueTask, pollResults, pollLogs,
  checkQueueStatus, discoverAgents, registerComponent, cleanupOldEntries,
  getListeners, buildAgentSetupPrompt, createGeneratorAgent,
} from '/js/services/generator.js';
import { buildBlueprintPrompt, buildComponentPrompt, buildFixPrompt } from '/js/services/generator-prompts.js';
import { validateBlueprint, validateComponent } from '/js/services/generator-validate.js';

/* ── Agent Listener Status ───────────────────────────── */

function AgentListenerBar({ showToast, session }) {
  const [listeners, setListeners] = useState([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [nodeUrl, setNodeUrl] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadListeners();
    apiGet('/v1/node').then(resp => {
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
        <button class="btn btn-ghost btn-xs" onClick=${() => setShowPrompt(!showPrompt)}>
          ${showPrompt ? t('profile.generator.hideSetup') : t('profile.generator.agentSetup')}
        </button>
      </div>
    </div>
    ${showPrompt && html`
      <div class="pf-gen-agent-prompt-panel">
        <p class="pf-gen-subtitle">${t('profile.generator.agentSetupDesc')}</p>
        <button class="btn btn-sm btn-outline" onClick=${handleCopyPrompt} disabled=${creating}>
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
        <h3>${t('profile.generator.title')}</h3>
        <div class="pf-gen-header-actions">
          <label class="pf-gen-archive-toggle">
            <input type="checkbox" checked=${showArchived} onChange=${e => { setShowArchived(e.target.checked); setPage(0); }} />
            ${t('profile.generator.showArchived')}
          </label>
          <button class="btn btn-primary" onClick=${onCreate}>+ ${t('profile.generator.newProject')}</button>
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
            <span class="pf-gen-project-date">${new Date(p.updatedAt).toLocaleDateString()}</span>
            ${p.status !== 'archived' && html`
              <button class="btn btn-ghost btn-xs" onClick=${e => handleArchive(e, p)}>${t('profile.generator.archive')}</button>
            `}
          </div>
        </div>
      `)}
      ${totalPages > 1 && html`
        <div class="pf-gen-pagination">
          <button class="btn btn-ghost btn-sm" disabled=${page === 0} onClick=${() => setPage(page - 1)}>←</button>
          <span>${page + 1} / ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" disabled=${page >= totalPages - 1} onClick=${() => setPage(page + 1)}>→</button>
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

  async function handleAnalyze() {
    if (!description.trim()) return;
    try {
      const name = description.slice(0, 60).replace(/\n/g, ' ');
      const p = await createProject(name, description);
      setProject(p);
      setPhase('blueprint');
    } catch (e) {
      showToast?.(e.message, true);
    }
  }

  function handleCopyBlueprintPrompt() {
    const prompt = buildBlueprintPrompt(description);
    navigator.clipboard.writeText(prompt).catch(() => {});
    showToast?.('Blueprint prompt copied!');
  }

  async function handleSubmitBlueprint() {
    const vr = validateBlueprint(blueprintResult);
    if (!vr.valid) {
      setBlueprintErrors(vr.errors);
      return;
    }
    try {
      await updateProject(project.projectId, { blueprint: vr.parsed, status: 'in_progress' });
      // Initialize components from blueprint
      for (const comp of vr.parsed.components) {
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

  if (phase === 'blueprint') {
    const fixPrompt = blueprintErrors.length > 0
      ? buildFixPrompt(buildBlueprintPrompt(description), blueprintResult, blueprintErrors)
      : null;
    return html`
      <div class="pf-gen-new-project">
        <button class="btn btn-ghost" onClick=${() => setPhase('describe')}>${t('profile.generator.back')}</button>
        <h3>${t('profile.generator.blueprintTitle')}</h3>
        <p class="pf-gen-subtitle">${t('profile.generator.blueprintDesc')}</p>
        <div class="pf-gen-section">
          <label>${t('profile.generator.prompt')}</label>
          <button class="btn btn-sm btn-outline" onClick=${handleCopyBlueprintPrompt}>
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
              <button class="btn btn-sm btn-outline" onClick=${() => navigator.clipboard.writeText(fixPrompt)}>
                ${t('profile.generator.copyFixPrompt')}
              </button>
            `}
          </div>
        `}
        <div class="pf-gen-actions">
          <button class="btn btn-primary" onClick=${handleSubmitBlueprint} disabled=${!blueprintResult.trim()}>
            ${t('profile.generator.importBlueprint')}
          </button>
        </div>
      </div>
    `;
  }

  return html`
    <div class="pf-gen-new-project">
      <button class="btn btn-ghost" onClick=${onBack}>${t('profile.generator.back')}</button>
      <h3>${t('profile.generator.newProjectTitle')}</h3>
      <p class="pf-gen-subtitle">${t('profile.generator.newProjectDesc')}</p>
      <textarea
        class="pf-gen-description"
        rows="8"
        placeholder=${t('profile.generator.descPlaceholder')}
        value=${description}
        onInput=${e => setDescription(e.target.value)}
      />
      <div class="pf-gen-actions">
        <button class="btn btn-primary" onClick=${handleAnalyze} disabled=${!description.trim()}>
          ${t('profile.generator.analyze')}
        </button>
      </div>
    </div>
  `;
}

function ProjectDashboard({ projectId, onBack, session, showToast }) {
  const [project, setProject] = useState(null);
  const [components, setComponents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [agents, setAgents] = useState([]);
  const [logFilter, setLogFilter] = useState(null); // null = all, or componentId

  useEffect(() => { loadData(); }, [projectId]);

  async function loadData() {
    const p = await getProject(projectId);
    setProject(p);
    if (p?.blueprint?.components) {
      const comps = await loadAllComponents(projectId);
      setComponents(comps.length > 0 ? comps : p.blueprint.components.map(c => ({ ...c, status: 'not_started', history: [], _version: 0 })));
    }
    setAgents(await discoverAgents());
    // Housekeeping: clean old queue/result/log entries
    cleanupOldEntries(projectId).catch(() => {});
  }

  const selected = components.find(c => c.id === selectedId);
  const phases = project?.blueprint?.phases || [];

  // Build activity log from all component histories
  const allLogs = components.flatMap(c =>
    (c.history || []).map(h => ({ ...h, componentId: c.id, componentLabel: c.label }))
  ).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const filteredLogs = logFilter ? allLogs.filter(l => l.componentId === logFilter) : allLogs;

  if (!project) return html`<div class="pf-gen-loading">${t('profile.loading')}</div>`;

  return html`
    <div class="pf-gen-dashboard">
      <div class="pf-gen-dash-header">
        <button class="btn btn-ghost btn-sm" onClick=${onBack}>${t('profile.generator.back')}</button>
        <h3>${project.name}</h3>
      </div>
      <div class="pf-gen-dash-body">
        <!-- Sidebar -->
        <div class="pf-gen-sidebar">
          ${phases.map(phase => html`
            <div class="pf-gen-phase-group">
              <div class="pf-gen-phase-label">${phase.label}</div>
              ${(phase.componentIds || []).map(cid => {
                const comp = components.find(c => c.id === cid) || { id: cid, label: cid, type: '?', status: 'not_started' };
                return html`
                  <div
                    class="pf-gen-comp-item ${selectedId === cid ? 'active' : ''} status-${comp.status}"
                    onClick=${() => setSelectedId(cid)}
                  >
                    <span class="pf-gen-comp-name">${comp.label}</span>
                    <span class="pf-gen-type-badge type-${comp.type}">${comp.type.toUpperCase()}</span>
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
                onUpdate=${loadData}
                showToast=${showToast}
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

function ComponentDetail({ component, project, components, agents, projectId, onUpdate, showToast }) {
  const [mode, setMode] = useState('chat');
  const [result, setResult] = useState(component.result || '');
  const [validationResult, setValidationResult] = useState(null);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    setResult(component.result || '');
    setValidationResult(null);
    // Auto-transition to prompt_ready when opening an unstarted component
    if (component.status === 'not_started') {
      const prompt = buildComponentPrompt(
        component.type, component.label,
        project.description, project.blueprint,
        components.filter(c => c.status === 'done'),
      );
      saveComponent(projectId, {
        ...component, status: 'prompt_ready', prompt,
        history: [...(component.history || []), { action: 'prompt_generated', at: new Date().toISOString(), by: 'system' }],
      }).then(() => onUpdate());
    }
  }, [component.id]);

  const completedComponents = components.filter(c => c.status === 'done');
  const prompt = component.prompt || buildComponentPrompt(
    component.type, component.label,
    project.description, project.blueprint, completedComponents,
  );

  function addHistory(comp, action, extra = {}) {
    return { ...comp, history: [...(comp.history || []), { action, at: new Date().toISOString(), by: 'user', ...extra }] };
  }

  async function handleValidate() {
    // Set validating status first
    const validating = addHistory(component, 'validating');
    await saveComponent(projectId, { ...validating, status: 'validating', result });

    const vr = validateComponent(component.type, result);
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
      const resp = await registerComponent(component.type, validationResult?.extracted || result);
      const registered = addHistory(component, 'registered', { registeredAs: resp?.data?.name || resp?.data?.id || 'registered' });
      await saveComponent(projectId, { ...registered, status: 'done', registeredAs: resp?.data?.name || resp?.data?.id || 'registered' });
      showToast?.('Component registered!');
      onUpdate();
    } catch (e) {
      setValidationResult({ valid: false, errors: [`Registration failed: ${e.message}`] });
      showToast?.(e.message, true);
    }
    setRegistering(false);
  }

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      const updated = addHistory(component, 'prompt_copied');
      await saveComponent(projectId, { ...updated, status: 'waiting_user', prompt });
      showToast?.('Prompt copied!');
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
    ? buildFixPrompt(prompt, result, validationResult.errors)
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
        <button class=${`btn btn-sm ${mode === 'chat' ? 'btn-primary' : 'btn-ghost'}`} onClick=${() => setMode('chat')}>
          ${t('profile.generator.modeChat')}
        </button>
        ${agents.length > 0 && html`
          <button class=${`btn btn-sm ${mode === 'agent' ? 'btn-primary' : 'btn-ghost'}`} onClick=${() => setMode('agent')}>
            ${t('profile.generator.modeAgent')}
          </button>
        `}
      </div>

      ${mode === 'chat' ? html`
        <!-- AI Chat Mode -->
        <div class="pf-gen-section">
          <label>${t('profile.generator.prompt')}</label>
          <pre class="pf-gen-prompt-box">${prompt}</pre>
          <button class="btn btn-sm btn-outline" onClick=${handleCopyPrompt}>
            ${t('profile.generator.copyPrompt')}
          </button>
        </div>
        <div class="pf-gen-section">
          <label>${t('profile.generator.result')}</label>
          <textarea
            class="pf-gen-result-area"
            rows="12"
            placeholder=${t('profile.generator.resultPlaceholder')}
            value=${result}
            onInput=${e => setResult(e.target.value)}
          />
          <div class="pf-gen-actions">
            <button class="btn btn-primary btn-sm" onClick=${handleValidate} disabled=${!result.trim()}>
              ${t('profile.generator.validate')}
            </button>
            ${validationResult?.valid && html`
              <button class="btn btn-sm" style="background:var(--success);color:#000" onClick=${handleRegister} disabled=${registering}>
                ${registering ? '...' : t('profile.generator.register')}
              </button>
            `}
          </div>
        </div>
      ` : html`
        <!-- Agent Mode -->
        <div class="pf-gen-section">
          <button class="btn btn-primary btn-sm" onClick=${handleSendToAgent}>
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
            <button class="btn btn-sm btn-outline" onClick=${() => navigator.clipboard.writeText(fixPrompt)}>
              ${t('profile.generator.copyFixPrompt')}
            </button>
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
    apiGet('/v1/node').then(resp => {
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
