/**
 * @file foundry-dashboard.js
 * @description Main dashboard shell for foundry projects — wires 6 custom hooks
 *   (core, autopilotState, autopilot, testExec, edit, packaging, lifecycle) and
 *   composes sub-components (PackageDialog, RemovePanel, EditModePanel,
 *   DiagnosticsPanel). Owns only UI-local state (logFilter, editingName, nameDraft,
 *   showDiagnostics).
 *
 *   This is the coordination layer of the hook-per-domain architecture. Each domain
 *   hook manages its own state; the dashboard shell connects them together and
 *   renders the layout. See the architecture spec for the full system design:
 *   docs/superpowers/specs/2026-03-22-generator-dashboard-hooks-design.md
 *
 * @structure
 *   - ProjectDashboard({ projectId, onBack, session, showToast, orSettings }):
 *     main dashboard component
 *     Hooks: useDashboardCore, useAutopilotState, useLifecycle, useEditMode,
 *            useTestExecution, useAutopilot, usePackaging
 *     Sub-components: PackageDialog, RemovePanel, EditModePanel, DiagnosticsPanel,
 *                     TestScopeSelector, TestResultsView, ComponentDetail,
 *                     SettingsCollectionView
 * @usage
 *   import { ProjectDashboard } from './foundry-dashboard.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js, hook-per-domain architecture
 *   v1.1.0 — 2026-03-26 — Add PassProgress component for multi-pass workflow sidebar
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { updateProject, deleteProject, getAppLaunchUrl, writeProjectLog, MULTI_PASS_TYPES } from '/js/services/foundry.js';
import { useConfirm } from '/components/Modal.js';
import { ComponentDetail, TestScopeSelector, TestResultsView } from './foundry-detail.js';
import { SettingsCollectionView } from './foundry-settings.js';

// Hook-per-domain imports
import { useDashboardCore } from './foundry-dashboard/use-dashboard-core.js';
import { useAutopilotState } from './foundry-dashboard/use-autopilot-state.js';
import { useLifecycle } from './foundry-dashboard/use-lifecycle.js';
import { useEditMode } from './foundry-dashboard/use-edit-mode.js';
import { useTestExecution } from './foundry-dashboard/use-test-execution.js';
import { useAutopilot } from './foundry-dashboard/use-autopilot.js';
import { usePackaging } from './foundry-dashboard/use-packaging.js';

// Sub-component imports
import { PackageDialog } from './foundry-dashboard/PackageDialog.js';
import { RemovePanel } from './foundry-dashboard/RemovePanel.js';
import { EditModePanel } from './foundry-dashboard/EditModePanel.js';
import { DiagnosticsPanel } from './foundry-dashboard/DiagnosticsPanel.js';
import { DebugPanel } from './foundry-dashboard/DebugPanel.js';

/* ── Pass Progress (multi-pass sidebar indicator) ──── */

const PASS_TYPE_KEY = {
  test: 'passTest',
  skeleton: 'passSkeleton',
  unit: 'passUnit',
  assembly: 'passAssembly',
  reflection: 'passReflection',
};

function PassProgress({ passes }) {
  if (!passes || passes.length === 0) return null;
  const done = passes.filter(p => p.status === 'validated').length;
  const total = passes.length;
  return html`
    <div class="fnd-pass-progress-compact">
      <span class="fnd-pass-dots">
        ${passes.map(p => html`<span class="fnd-pass-dot fnd-pass-dot-${p.status}" title=${(PASS_TYPE_KEY[p.type] ? t('profile.foundry.' + PASS_TYPE_KEY[p.type]) : p.type) + (p.unitLabel ? ': ' + p.unitLabel : '')}></span>`)}
      </span>
      <span class="fnd-pass-count">${done}/${total}</span>
    </div>
  `;
}

export function ProjectDashboard({ projectId, onBack, session, showToast, orSettings }) {
  // Local UI state
  const [logFilter, setLogFilter] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const { confirm, ConfirmUI } = useConfirm();

  // Wire hooks (order matters — testExec before autopilot, core before everything)
  const core = useDashboardCore(projectId, onBack, showToast);
  const autopilotState = useAutopilotState();
  const lifecycle = useLifecycle(core, projectId, showToast, session);
  const testExec = useTestExecution(core, projectId, orSettings, session, showToast);
  const edit = useEditMode(core, autopilotState, projectId, orSettings, session, showToast);
  const autopilot = useAutopilot(core, autopilotState, projectId, orSettings, session, testExec, showToast);
  const pkg = usePackaging(core, projectId, showToast);

  // Destructure for convenience in JSX
  const { project, components, interviewSpec, selectedId, liveStatuses } = core;
  const { testScope, testRunning, testReport } = testExec;
  const editMode = edit.editMode;

  // Derived values
  const phases = project?.blueprint?.phases || [];
  const selected = components.find(c => c.id === selectedId);
  const registeredCount = components.filter(c => c.registeredAs).length;
  const activeCount = Object.values(liveStatuses).filter(s => s.active).length;
  const hasApp = components.some(c => c.type === 'app' && c.registeredAs);
  const doneCount = components.filter(c => c.status === 'done' && c.result).length;

  // Activity log from component histories
  const componentLogs = components.flatMap(c =>
    (c.history || []).map(h => ({ ...h, componentId: c.id, componentLabel: c.label }))
  ).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const filteredLogs = logFilter ? componentLogs.filter(l => l.componentId === logFilter) : componentLogs;

  // Local handlers
  async function handleNameSave() {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== project.name) {
      await updateProject(projectId, { name: trimmed });
      await writeProjectLog(projectId, 'name_changed', { meta: { newName: nameDraft } });
      await core.loadData();
      showToast?.(t('profile.foundry.nameUpdated'));
    }
    setEditingName(false);
  }

  function handleLaunchApp() {
    const url = getAppLaunchUrl(components, session);
    if (url) window.open(url, '_blank');
    else showToast?.(t('profile.foundry.noRegisteredApp'));
  }

  function handleDeleteProject() {
    confirm(t('profile.foundry.confirmDelete'), async () => {
      try {
        await writeProjectLog(projectId, 'project_deleted');
        await deleteProject(projectId, session);
        showToast?.(t('profile.foundry.projectDeleted'));
        onBack();
      } catch (e) {
        showToast?.(e.message, true);
      }
    }, { title: t('profile.foundry.deleteProject'), confirmLabel: t('profile.foundry.deleteProject'), cancelLabel: t('profile.foundry.back'), danger: true });
  }

  if (!project) return html`<div class="fnd-loading">${t('profile.loading')}</div>`;

  return html`
    <div class="fnd-dashboard">
      <${ConfirmUI} />
      <div class="fnd-dash-header">
        <button class="btn-outline" onClick=${onBack}>${t('profile.foundry.back')}</button>
        ${editingName
          ? html`<input class="fnd-name-input" value=${nameDraft}
              onInput=${e => setNameDraft(e.target.value)}
              onBlur=${handleNameSave}
              onKeyDown=${e => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setEditingName(false); }}
              ref=${el => el && setTimeout(() => el.focus(), 0)}
            />`
          : html`<h3 class="fnd-name-editable" onClick=${() => { setNameDraft(project.name); setEditingName(true); }}
              title=${t('profile.foundry.clickToEditName')}>${project.name}</h3>`
        }
        <button class="btn-ghost btn-sm fnd-delete-btn" onClick=${handleDeleteProject}>
          ${t('profile.foundry.deleteProject')}
        </button>
      </div>
      ${project.forkedFrom && html`
        <p class="fnd-forked-from text-caption mb-half">
          ${t('profile.foundry.forkedFrom').replace('{name}', project.forkedFrom.packageGroupId).replace('{author}', project.forkedFrom.author)}
        </p>
      `}
      ${project.packageGroupId && html`
        <p class="fnd-package-link text-caption mb-half">
          Package: ${project.packageGroupId}${project.lastPackagedVersion ? ' — ' + project.lastPackagedVersion : ''}
        </p>
      `}

      <!-- Test Scope -->
      ${components.length > 0 && !autopilotState.running && html`
        <${TestScopeSelector} value=${testScope} onChange=${testExec.setTestScope} />
      `}

      <!-- Autopilot: Run All Steps -->
      ${orSettings?.hasApiKey && components.length > 0 && html`
        <div class="fnd-or-run-all-bar">
          ${autopilotState.running
            ? html`
              <div class="fnd-or-run-all-status">
                <span class="fnd-or-spinner"></span>
                <span>${autopilotState.step}</span>
              </div>
              <button class="btn-danger btn-sm" onClick=${autopilotState.cancel}>
                ${t('profile.foundry.openrouter.cancel')}
              </button>
            `
            : html`
              <button class="btn-primary btn-sm" onClick=${autopilot.handleRunAll}
                disabled=${components.every(c => c.registeredAs)}>
                ${t('profile.foundry.openrouter.runAll')}
              </button>
            `
          }
        </div>
      `}

      <!-- Lifecycle Toolbar -->
      ${registeredCount > 0 && html`
        <div class="fnd-lifecycle-toolbar">
          <div class="fnd-lifecycle-status">
            <span>${registeredCount} ${t('profile.foundry.registeredLabel')}</span>
            <span class="fnd-lifecycle-sep">/</span>
            <span>${activeCount} ${t('profile.foundry.activeLabel')}</span>
          </div>
          <div class="fnd-lifecycle-actions">
            <button class="btn-success btn-sm"
              onClick=${lifecycle.handleActivateAll}
              disabled=${lifecycle.lifecycleLoading !== null || registeredCount === 0}>
              ${lifecycle.lifecycleLoading === 'activate' ? '...' : t('profile.foundry.activateAll')}
            </button>
            <button class="btn-outline btn-sm"
              onClick=${lifecycle.handleDeactivateAll}
              disabled=${lifecycle.lifecycleLoading !== null || activeCount === 0}>
              ${lifecycle.lifecycleLoading === 'deactivate' ? '...' : t('profile.foundry.deactivateAll')}
            </button>
            ${hasApp && html`
              <button class="btn-primary btn-sm" onClick=${handleLaunchApp}>
                ${t('profile.foundry.launchApp')}
              </button>
            `}
            <button class="btn-outline btn-sm" onClick=${() => core.refreshStatuses()} title=${t('profile.foundry.refreshTitle')}>
              ${t('profile.foundry.refresh')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${() => editMode ? edit.exitEditMode() : edit.setEditMode('request')}>
              ${editMode ? t('profile.foundry.cancelEdit') : t('profile.foundry.editService')}
            </button>
            ${project?.blueprint?.settings && html`
              <button class="btn-ghost btn-sm" onClick=${() => lifecycle.setShowSettingsPanel(!lifecycle.showSettingsPanel)}>
                ${lifecycle.showSettingsPanel ? t('profile.foundry.hideSettings') : t('profile.foundry.editSettings')}
              </button>
            `}
            <button class="btn-ghost btn-sm" onClick=${() => setShowDiagnostics(!showDiagnostics)}>
              ${showDiagnostics ? t('profile.foundry.hideDiagnostics') : t('profile.foundry.diagnostics')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${() => setShowDebug(!showDebug)}>
              ${showDebug ? 'Hide Debug' : 'Debug'}
            </button>
            <button class="btn-outline btn-sm fnd-remove-toggle"
              onClick=${() => { lifecycle.setShowRemovePanel(!lifecycle.showRemovePanel); lifecycle.setRemoveSelection({}); }}>
              ${lifecycle.showRemovePanel ? t('profile.foundry.cancelRemove') : t('profile.foundry.removeEllipsis')}
            </button>
            ${doneCount > 0 && html`
              <button class="btn-info btn-sm"
                onClick=${pkg.handleOpen}
                disabled=${pkg.loading}>
                ${project.packageGroupId
                  ? t('profile.foundry.updatePackage')
                  : t('profile.foundry.packageProject')}
              </button>
            `}
          </div>
        </div>
      `}

      <!-- Panels -->
      ${pkg.showDialog && html`<${PackageDialog} project=${project} pkg=${pkg} />`}
      ${lifecycle.showRemovePanel && html`<${RemovePanel} components=${components} lifecycle=${lifecycle} />`}
      ${editMode && html`<${EditModePanel} edit=${edit} core=${core} autopilotState=${autopilotState} orSettings=${orSettings} />`}
      ${showDiagnostics && html`<${DiagnosticsPanel} components=${components} liveStatuses=${liveStatuses} />`}
      ${showDebug && html`<${DebugPanel} projectId=${projectId} />`}

      <!-- Settings Panel -->
      ${lifecycle.showSettingsPanel && project?.blueprint?.settings && html`
        <div class="fnd-settings-inline">
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
        <div class="fnd-test-panel">
          <div class="fnd-actions">
            <button class="btn-primary btn-sm"
              onClick=${testExec.handleRunTests}
              disabled=${testRunning || testScope === 'none'}>
              ${testRunning
                ? html`<span class="fnd-or-spinner"></span> ${t('profile.foundry.test_running')}`
                : t('profile.foundry.test_scope_title')}
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

      <div class="fnd-dash-body">
        <!-- Sidebar -->
        <div class="fnd-sidebar">
          ${phases.map(phase => html`
            <div class="fnd-phase-group">
              <div class="fnd-phase-label">${phase.label}</div>
              ${(phase.componentIds || []).map(cid => {
                const comp = components.find(c => c.id === cid) || { id: cid, label: cid, type: '?', status: 'not_started' };
                const live = liveStatuses[cid];
                const testComp = testReport?.components?.find(c => c.componentId === cid);
                const isTestable = ['extension', 'cortex', 'app'].includes(comp.type);
                return html`
                  <div
                    class="fnd-comp-item ${selectedId === cid ? 'active' : ''} status-${comp.status}"
                    onClick=${() => core.setSelectedId(cid)}
                  >
                    <span class="fnd-comp-name">${comp.label}</span>
                    <span class="fnd-comp-indicators">
                      ${testComp
                        ? html`<span class="fnd-test-icon fnd-test-icon-${testComp.status}"
                            title=${t('profile.foundry.test_component_' + testComp.status) + (testComp.scenarios > 0 ? ` (${testComp.passed}/${testComp.scenarios})` : '')}>${
                            testComp.status === 'passed' ? '✓' : testComp.status === 'failed' ? '✗' : '—'
                          }</span>`
                        : isTestable && testScope !== 'none'
                          ? html`<span class="fnd-test-icon fnd-test-icon-planned"
                              title=${t('profile.foundry.test_planned')}>◉</span>`
                          : null
                      }
                      <span class="fnd-type-badge type-${comp.type} ${live ? (live.active ? 'live-active' : live.installed ? 'live-installed' : 'live-missing') : ''}"
                        title=${live?.status || ''}>${comp.type.toUpperCase()}</span>
                    </span>
                    ${MULTI_PASS_TYPES.includes(comp.type) && comp.passes && comp.passes.length > 0 && selectedId === cid && html`
                      <${PassProgress} passes=${comp.passes} onGenerateNext=${() => core.setSelectedId(cid)} />
                    `}
                  </div>
                `;
              })}
            </div>
          `)}
        </div>
        <!-- Detail Panel -->
        <div class="fnd-detail">
          ${selected
            ? html`<${ComponentDetail}
                component=${selected}
                project=${project}
                components=${components}
                projectId=${projectId}
                interviewSpec=${interviewSpec}
                liveStatuses=${liveStatuses}
                onUpdate=${core.loadData}
                onAdvance=${core.advanceToNext}
                showToast=${showToast}
                session=${session}
                orSettings=${orSettings}
              />`
            : html`<div class="fnd-detail-empty">${t('profile.foundry.selectComponent')}</div>`
          }
        </div>
      </div>
      <!-- Activity Log -->
      <div class="fnd-activity-log">
        <div class="fnd-log-header">
          <label>${t('profile.foundry.activityLog')}</label>
          <select class="fnd-log-filter" onChange=${e => setLogFilter(e.target.value || null)}>
            <option value="">${t('profile.foundry.allComponents')}</option>
            ${components.map(c => html`<option value=${c.id}>${c.label}</option>`)}
          </select>
        </div>
        <div class="fnd-log-entries">
          ${filteredLogs.length === 0 && html`<div class="fnd-log-empty">${t('profile.foundry.noActivity')}</div>`}
          ${filteredLogs.slice(0, 50).map(l => html`
            <div class="fnd-log-entry">
              <span class="fnd-log-time">${new Date(l.at).toLocaleTimeString()}</span>
              <span class="fnd-log-comp">[${l.componentLabel}]</span>
              <span class="fnd-log-msg">${l.action}${l.round ? ' (' + l.round + '/' + (l.maxRounds || '?') + ')' : ''}${l.errors ? ': ' + (Array.isArray(l.errors) ? l.errors.join(', ') : l.errors) : ''}</span>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}
