/**
 * @file use-dashboard-core.js
 * @description Shared data layer for all dashboard hooks — owns the project record,
 *   component list, interview spec, selected component ID, and live statuses.
 *   Every domain hook (useAutopilot, useTestExecution, useEditMode, usePackaging,
 *   useLifecycle) receives this hook's return value as its `core` parameter.
 *
 *   This is the foundation of the hook-per-domain architecture for ProjectDashboard.
 *   It provides:
 *   - loadData(): central data refresh that reloads project, components, interviewSpec
 *   - refreshStatuses(): polls live extension/cortex status
 *   - advanceToNext(): selects the next unregistered component in phase order
 *   - pendingEdit: raw pending edit data for useEditMode to restore from
 *   - Auto-select: first incomplete component selected on mount
 *   - SSE: listens for aimeat-live-update events and auto-refreshes
 *
 *   Architecture: ProjectDashboard shell → useDashboardCore()
 *                   → core passed to all domain hooks as first parameter
 *
 * @structure
 *   - useDashboardCore(projectId, onBack, showToast): custom hook
 *     State: project, components, interviewSpec, selectedId, liveStatuses, pendingEdit
 *     Functions: loadData, refreshStatuses, advanceToNext
 *     Effects: mount load, SSE listener, auto-select, status poll
 * @usage
 *   import { useDashboardCore } from './generator-dashboard/use-dashboard-core.js';
 *   const core = useDashboardCore(projectId, onBack, showToast);
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js ProjectDashboard
 */
import { useState, useEffect } from 'preact/hooks';
import { t } from '/js/i18n.js';
import {
  getProject, loadAllComponents, saveComponent, cleanupOldEntries,
  getInterviewSpec, getComponentStatuses, getPendingEdit,
} from '/js/services/generator.js';

/**
 * @param {string} projectId
 * @param {Function} onBack — called when project is deleted/missing
 * @param {Function} showToast
 */
export function useDashboardCore(projectId, onBack, showToast) {
  const [project, setProject] = useState(null);
  const [components, setComponents] = useState([]);
  const [interviewSpec, setInterviewSpec] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [liveStatuses, setLiveStatuses] = useState({});
  const [pendingEdit, setPendingEdit] = useState(null);

  // Load on mount / when the project changes. loadData is recreated each render (closes over
  // stable setters + props); the reload is intentionally keyed to projectId only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [projectId]);

  // SSE live updates — instant refresh when data changes
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
    // Handler reloads on every data-change event; the listener is keyed to projectId only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function loadData() {
    const p = await getProject(projectId);
    if (!p || !p.projectId) {
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
        // Blueprint exists but no component records yet — initialize them
        const initialized = [];
        for (const c of p.blueprint.components) {
          // Preserve subtype (data|component|app-domain) on cortex records — the spec/code prompt
          // selectors and the spec validators dispatch on it. Dropping it here was the single hop
          // where subtype was lost end-to-end, forcing every downstream picker onto a wrong guess.
          const comp = { id: c.id, type: c.type, label: c.label, ...(c.subtype ? { subtype: c.subtype } : {}), status: 'not_started', prompt: null, result: null, validationErrors: [], registeredAs: null, history: [], _version: 0 };
          await saveComponent(projectId, comp);
          initialized.push(comp);
        }
        setComponents(initialized);
      }
    }
    cleanupOldEntries(projectId).catch(() => {});
    // Load pending edit data (useEditMode watches this to restore its state)
    try {
      const pending = await getPendingEdit(projectId);
      if (pending) setPendingEdit(pending);
    } catch { /* no pending edit */ }
  }

  // Refresh live statuses
  async function refreshStatuses() {
    try {
      const s = await getComponentStatuses(projectId);
      setLiveStatuses(s);
    } catch { /* best effort */ }
  }

  // Refresh live statuses whenever the project record changes. refreshStatuses is recreated each
  // render and is also returned from this hook (consumers depend on its runtime behavior); keep it
  // out of the deps and key the effect to the project record.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (project) refreshStatuses(); }, [project]);

  // Advance to next unregistered component in phase order
  function advanceToNext(currentId) {
    const phases = project?.blueprint?.phases || [];
    const phaseOrder = phases.flatMap(p => p.componentIds || []);
    const idx = phaseOrder.indexOf(currentId);
    for (let i = idx + 1; i < phaseOrder.length; i++) {
      const comp = components.find(c => c.id === phaseOrder[i]);
      if (comp && !comp.registeredAs) {
        setSelectedId(phaseOrder[i]);
        return;
      }
    }
    showToast?.(t('profile.generator.allComponentsRegistered'));
  }

  // Auto-select first incomplete component when components change
  useEffect(() => {
    if (!selectedId && components.length > 0) {
      const phases = project?.blueprint?.phases || [];
      const phaseOrder = phases.flatMap(p => p.componentIds || []);
      if (phaseOrder.length > 0) {
        const first = phaseOrder.find(cid => {
          const comp = components.find(c => c.id === cid);
          return comp && !comp.registeredAs;
        });
        if (first) setSelectedId(first);
        else setSelectedId(phaseOrder[0]);
      }
    }
    // Auto-select the first incomplete component only when the component-set SIZE changes.
    // Deliberately keyed to length: depending on the full `components`/`phases`/`selectedId`
    // would re-run on every reference change and could re-select on unrelated updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components.length]);

  return {
    project, components, interviewSpec,
    selectedId, setSelectedId,
    liveStatuses, pendingEdit,
    loadData, refreshStatuses, advanceToNext,
  };
}
