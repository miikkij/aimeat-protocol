/**
 * @file use-lifecycle.js
 * @description Custom hook for component lifecycle management — activate all,
 *   deactivate all, and selective removal of registered components.
 *
 *   Part of the hook-per-domain architecture for ProjectDashboard. This hook owns
 *   the lifecycle-specific state (loading indicator, remove panel visibility,
 *   selection checkboxes, memory deletion toggle, settings panel toggle) and
 *   exposes handlers for bulk lifecycle operations.
 *
 *   Architecture: useDashboardCore → useLifecycle → RemovePanel (sub-component)
 *   The dashboard shell renders the lifecycle toolbar buttons using this hook's
 *   returned state and handlers.
 *
 * @structure
 *   - useLifecycle(core, projectId, showToast, session): custom hook
 *     State: lifecycleLoading, showRemovePanel, removeSelection, removeMemory, showSettingsPanel
 *     Handlers: handleActivateAll, handleDeactivateAll, handleRemoveConfirmed
 * @usage
 *   import { useLifecycle } from './foundry-dashboard/use-lifecycle.js';
 *   const lifecycle = useLifecycle(core, projectId, showToast, session);
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js ProjectDashboard
 */
import { useState } from 'preact/hooks';
import { t } from '/js/i18n.js';
import {
  activateAll, deactivateAll, removeComponents, writeProjectLog,
} from '/js/services/foundry.js';

/**
 * @param {Object} core — useDashboardCore return value (loadData, refreshStatuses)
 * @param {string} projectId
 * @param {Function} showToast
 * @param {Object} session
 */
export function useLifecycle(core, projectId, showToast, session) {
  const [lifecycleLoading, setLifecycleLoading] = useState(null);
  const [showRemovePanel, setShowRemovePanel] = useState(false);
  const [removeSelection, setRemoveSelection] = useState({});
  const [removeMemory, setRemoveMemory] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);

  async function handleActivateAll() {
    setLifecycleLoading('activate');
    try {
      const result = await activateAll(projectId);
      if (result.errors.length > 0) {
        showToast?.(t('profile.foundry.activatedWithErrors').replace('{count}', result.activated.length).replace('{errors}', result.errors.length), true);
      } else {
        showToast?.(t('profile.foundry.activatedCount').replace('{count}', result.activated.length));
      }
      await writeProjectLog(projectId, 'all_activated');
      await core.refreshStatuses();
    } catch (e) { showToast?.(e.message, true); }
    setLifecycleLoading(null);
  }

  async function handleDeactivateAll() {
    setLifecycleLoading('deactivate');
    try {
      const result = await deactivateAll(projectId);
      if (result.errors.length > 0) {
        showToast?.(t('profile.foundry.deactivatedWithErrors').replace('{count}', result.deactivated.length).replace('{errors}', result.errors.length), true);
      } else {
        showToast?.(t('profile.foundry.deactivatedCount').replace('{count}', result.deactivated.length));
      }
      await writeProjectLog(projectId, 'all_deactivated');
      await core.refreshStatuses();
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
        showToast?.(t('profile.foundry.removedWithErrors').replace('{count}', result.removed.length).replace('{errors}', result.errors.length), true);
      } else {
        showToast?.(t('profile.foundry.removedCount').replace('{count}', result.removed.length));
      }
      setShowRemovePanel(false);
      setRemoveSelection({});
      await core.loadData();
      await core.refreshStatuses();
    } catch (e) { showToast?.(e.message, true); }
    setLifecycleLoading(null);
  }

  return {
    lifecycleLoading,
    showRemovePanel, setShowRemovePanel,
    removeSelection, setRemoveSelection,
    removeMemory, setRemoveMemory,
    showSettingsPanel, setShowSettingsPanel,
    handleActivateAll, handleDeactivateAll, handleRemoveConfirmed,
  };
}
