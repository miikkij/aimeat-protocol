/**
 * @file PackageDialog.js
 * @description Package dialog sub-component — renders the form for packaging a
 *   foundry project into a reusable template or updating an existing package.
 *   Pure rendering component: all state and handlers come from usePackaging hook.
 *
 *   Part of the hook-per-domain architecture. Receives the full usePackaging()
 *   return value as `pkg` prop.
 *
 * @structure
 *   - PackageDialog({ project, pkg }): dialog with visibility, category, tags,
 *     changelog fields + action buttons
 * @usage
 *   import { PackageDialog } from './foundry-dashboard/PackageDialog.js';
 *   ${pkg.showDialog && html`<${PackageDialog} project=${project} pkg=${pkg} />`}
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js ProjectDashboard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export function PackageDialog({ project, pkg }) {
  return html`
    <div class="fnd-package-dialog">
      <h4>${project.packageGroupId
        ? t('profile.foundry.updatePackage')
        : t('profile.foundry.packageProject')}</h4>
      ${project.forkedFrom && html`
        <p class="text-caption mb-half">
          ${t('profile.foundry.forkedFrom').replace('{name}', project.forkedFrom.packageGroupId).replace('{author}', project.forkedFrom.author)}
        </p>
      `}

      ${!project.packageGroupId && html`
        <label class="fnd-pkg-label">${t('profile.foundry.packageVisibility')}
          <select value=${pkg.visibility} onChange=${e => pkg.setVisibility(e.target.value)}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
      `}

      <label class="fnd-pkg-label">${t('profile.foundry.packageCategory')}
        <input type="text" value=${pkg.category}
          onChange=${e => pkg.setCategory(e.target.value)}
          placeholder="utility" />
      </label>

      <label class="fnd-pkg-label">${t('profile.foundry.packageTags')}
        <input type="text" value=${pkg.tags}
          onChange=${e => pkg.setTags(e.target.value)}
          placeholder="alerts, maps, finland" />
      </label>

      ${project.packageGroupId && html`
        <div class="fnd-changes-summary">
          <strong>${t('profile.foundry.changesSummary')}</strong>
          ${pkg.changes ? html`
            <ul class="fnd-changes-list">
              ${pkg.changes.filter(c => c.action === 'added').map(c => html`
                <li class="fnd-change-added">${t('profile.foundry.changeAdded')}: ${c.label}</li>
              `)}
              ${pkg.changes.filter(c => c.action === 'modified').map(c => html`
                <li class="fnd-change-modified">${t('profile.foundry.changeModified')}: ${c.label}</li>
              `)}
              ${pkg.changes.filter(c => c.action === 'removed').map(c => html`
                <li class="fnd-change-removed">${t('profile.foundry.changeRemoved')}: ${c.label}</li>
              `)}
              ${pkg.changes.filter(c => c.action === 'unchanged').map(c => html`
                <li class="fnd-change-unchanged">${t('profile.foundry.changeUnchanged')}: ${c.label}</li>
              `)}
            </ul>
          ` : html`<span class="text-caption">...</span>`}
          <label class="fnd-pkg-label">${t('profile.foundry.changelogNote')}
            <input type="text" value=${pkg.changelogNote}
              onChange=${e => pkg.setChangelogNote(e.target.value)}
              placeholder=${t('profile.foundry.changelogPlaceholder')} />
          </label>
        </div>
      `}

      <div class="flex-actions">
        <button class="btn-outline btn-sm" onClick=${() => pkg.setShowDialog(false)}>
          ${t('profile.foundry.cancelRemove')}
        </button>
        <button class="btn-primary btn-sm" onClick=${pkg.handlePackage} disabled=${pkg.loading}>
          ${pkg.loading ? '...' : (project.packageGroupId
            ? t('profile.foundry.updatePackage')
            : t('profile.foundry.packageProject'))}
        </button>
      </div>
    </div>
  `;
}
