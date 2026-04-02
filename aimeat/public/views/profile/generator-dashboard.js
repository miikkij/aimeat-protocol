/**
 * @file generator-dashboard.js
 * @description Main dashboard shell for generator projects — wires 6 custom hooks
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
 *   import { ProjectDashboard } from './generator-dashboard.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js, hook-per-domain architecture
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { updateProject, deleteProject, getAppLaunchUrl, writeProjectLog } from '/js/services/generator.js';
import { useConfirm } from '/components/Modal.js';
import { ComponentDetail, TestScopeSelector, TestResultsView } from './generator-detail.js';
import { SettingsCollectionView } from './generator-settings.js';

// Hook-per-domain imports
import { useDashboardCore } from './generator-dashboard/use-dashboard-core.js';
import { useAutopilotState } from './generator-dashboard/use-autopilot-state.js';
import { useLifecycle } from './generator-dashboard/use-lifecycle.js';
import { useEditMode } from './generator-dashboard/use-edit-mode.js';
import { useTestExecution } from './generator-dashboard/use-test-execution.js';
import { useAutopilot } from './generator-dashboard/use-autopilot.js';
import { usePackaging } from './generator-dashboard/use-packaging.js';

// Sub-component imports
import { PackageDialog } from './generator-dashboard/PackageDialog.js';
import { RemovePanel } from './generator-dashboard/RemovePanel.js';
import { EditModePanel } from './generator-dashboard/EditModePanel.js';
import { DiagnosticsPanel } from './generator-dashboard/DiagnosticsPanel.js';
import { DebugPanel } from './generator-dashboard/DebugPanel.js';

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
      showToast?.(t('profile.generator.nameUpdated'));
    }
    setEditingName(false);
  }

  function handleLaunchApp() {
    const url = getAppLaunchUrl(components, session);
    if (url) window.open(url, '_blank');
    else showToast?.(t('profile.generator.noRegisteredApp'));
  }

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

      <!-- Blueprint & Interview Spec (always visible so user can inspect) -->
      ${project?.blueprint && html`
        <details class="pf-gen-data-viewer mb-half">
          <summary class="text-caption" style="cursor:pointer;user-select:none;font-weight:600">
            📋 Blueprint (${(project.blueprint.components || []).length} components, ${(project.blueprint.testScenarios || []).length} test scenarios)
          </summary>
          <pre class="pf-gen-data-pre">${JSON.stringify(project.blueprint, null, 2)}</pre>
        </details>
      `}
      ${interviewSpec && html`
        <details class="pf-gen-data-viewer mb-half">
          <summary class="text-caption" style="cursor:pointer;user-select:none;font-weight:600">
            📝 Interview Spec (${(interviewSpec.dataSources || []).length} data sources, ${(interviewSpec.useCases || []).length} use cases)
          </summary>
          <pre class="pf-gen-data-pre">${JSON.stringify(interviewSpec, null, 2)}</pre>
        </details>
      `}

      <!-- Test Scope -->
      ${components.length > 0 && !autopilotState.running && html`
        <${TestScopeSelector} value=${testScope} onChange=${testExec.setTestScope} />
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

      <!-- Lifecycle Toolbar -->
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
            <button class="btn-outline btn-sm" onClick=${() => core.refreshStatuses()} title=${t('profile.generator.refreshTitle')}>
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
            <button class="btn-ghost btn-sm" onClick=${() => setShowDebug(!showDebug)}>
              ${showDebug ? 'Hide Debug' : 'Debug'}
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

      <!-- Panels -->
      ${pkg.showDialog && html`<${PackageDialog} project=${project} pkg=${pkg} />`}
      ${lifecycle.showRemovePanel && html`<${RemovePanel} components=${components} lifecycle=${lifecycle} />`}
      ${editMode && html`<${EditModePanel} edit=${edit} core=${core} autopilotState=${autopilotState} orSettings=${orSettings} />`}
      ${showDiagnostics && html`<${DiagnosticsPanel} components=${components} liveStatuses=${liveStatuses} />`}
      ${showDebug && html`<${DebugPanel} projectId=${projectId} />`}

      <!-- Settings Panel -->
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
                    onClick=${() => core.setSelectedId(cid)}
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
                onUpdate=${core.loadData}
                onAdvance=${core.advanceToNext}
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
