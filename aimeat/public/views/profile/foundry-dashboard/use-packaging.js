/**
 * @file use-packaging.js
 * @description Custom hook for the Template Packaging system — manages state for
 *   packaging a foundry project into a reusable template bundle, updating existing
 *   packages, and detecting changes between versions.
 *
 *   Part of the hook-per-domain architecture for ProjectDashboard. This hook owns
 *   all packaging-related state (dialog visibility, form fields, loading, change
 *   detection) and exposes handlers for opening the dialog and executing packaging.
 *   The dashboard shell passes `core` (from useDashboardCore) for access to project
 *   and component data.
 *
 *   Architecture: useDashboardCore → usePackaging → PackageDialog (sub-component)
 *
 * @structure
 *   - usePackaging(core, projectId, showToast): custom hook
 *     State: showDialog, loading, changes, category, tags, visibility, changelogNote
 *     Handlers: handleOpen, handlePackage
 * @usage
 *   import { usePackaging } from './foundry-dashboard/use-packaging.js';
 *   const pkg = usePackaging(core, projectId, showToast);
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js ProjectDashboard
 */
import { useState } from 'preact/hooks';
import { t } from '/js/i18n.js';
import {
  packageProject, updatePackageVersion, detectChanges,
} from '/js/services/foundry-packaging.js';
import { getPackage } from '/js/services/packages.js';

/**
 * @param {Object} core — useDashboardCore return value (project, components, loadData)
 * @param {string} projectId
 * @param {Function} showToast
 */
export function usePackaging(core, projectId, showToast) {
  const [showDialog, setShowDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [changes, setChanges] = useState(null);
  const [category, setCategory] = useState('utility');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [changelogNote, setChangelogNote] = useState('');

  async function handleOpen() {
    setShowDialog(true);
    setChanges(null);
    setChangelogNote('');
    // If project is linked to a package, detect changes
    if (core.project?.packageGroupId) {
      try {
        const pkgResp = await getPackage(core.project.packageGroupId);
        const pkg = pkgResp?.data || pkgResp;
        const packageable = core.components.filter(c => c.status === 'done' && c.result);
        const ch = await detectChanges(packageable, pkg?.components);
        setChanges(ch);
      } catch { /* first time — no changes to detect */ }
    }
  }

  async function handlePackage() {
    setLoading(true);
    try {
      const tagList = tags.split(',').map(s => s.trim()).filter(Boolean);
      if (core.project?.packageGroupId) {
        // Update existing package
        const { result } = await updatePackageVersion(projectId, {
          category,
          tags: tagList,
          changelogNote,
        });
        showToast?.(t('profile.foundry.packageUpdateSuccess').replace('{version}', result?.data?.version || ''));
      } else {
        // Create new package
        await packageProject(projectId, {
          category,
          tags: tagList,
          visibility,
        });
        showToast?.(t('profile.foundry.packageSuccess'));
      }
      setShowDialog(false);
      await core.loadData();
    } catch (e) {
      showToast?.(e.message, true);
    }
    setLoading(false);
  }

  return {
    showDialog, setShowDialog, loading, changes,
    category, setCategory, tags, setTags,
    visibility, setVisibility, changelogNote, setChangelogNote,
    handleOpen, handlePackage,
  };
}
