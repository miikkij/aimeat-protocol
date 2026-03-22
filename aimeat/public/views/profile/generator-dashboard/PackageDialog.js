/**
 * @file PackageDialog.js
 * @description Package dialog sub-component — renders the form for packaging a
 *   generator project into a reusable template or updating an existing package.
 *   Pure rendering component: all state and handlers come from usePackaging hook.
 *
 *   Part of the hook-per-domain architecture. Receives the full usePackaging()
 *   return value as `pkg` prop.
 *
 * @structure
 *   - PackageDialog({ project, pkg }): dialog with visibility, category, tags,
 *     changelog fields + action buttons
 * @usage
 *   import { PackageDialog } from './generator-dashboard/PackageDialog.js';
 *   ${pkg.showDialog && html`<${PackageDialog} project=${project} pkg=${pkg} />`}
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js ProjectDashboard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export function PackageDialog({ project, pkg }) {
  return html`
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
          <select value=${pkg.visibility} onChange=${e => pkg.setVisibility(e.target.value)}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
      `}

      <label class="pf-gen-pkg-label">${t('profile.generator.packageCategory')}
        <input type="text" value=${pkg.category}
          onChange=${e => pkg.setCategory(e.target.value)}
          placeholder="utility" />
      </label>

      <label class="pf-gen-pkg-label">${t('profile.generator.packageTags')}
        <input type="text" value=${pkg.tags}
          onChange=${e => pkg.setTags(e.target.value)}
          placeholder="alerts, maps, finland" />
      </label>

      ${project.packageGroupId && html`
        <div class="pf-gen-changes-summary">
          <strong>${t('profile.generator.changesSummary')}</strong>
          ${pkg.changes ? html`
            <ul class="pf-gen-changes-list">
              ${pkg.changes.filter(c => c.action === 'added').map(c => html`
                <li class="pf-gen-change-added">${t('profile.generator.changeAdded')}: ${c.label}</li>
              `)}
              ${pkg.changes.filter(c => c.action === 'modified').map(c => html`
                <li class="pf-gen-change-modified">${t('profile.generator.changeModified')}: ${c.label}</li>
              `)}
              ${pkg.changes.filter(c => c.action === 'removed').map(c => html`
                <li class="pf-gen-change-removed">${t('profile.generator.changeRemoved')}: ${c.label}</li>
              `)}
              ${pkg.changes.filter(c => c.action === 'unchanged').map(c => html`
                <li class="pf-gen-change-unchanged">${t('profile.generator.changeUnchanged')}: ${c.label}</li>
              `)}
            </ul>
          ` : html`<span class="text-caption">...</span>`}
          <label class="pf-gen-pkg-label">${t('profile.generator.changelogNote')}
            <input type="text" value=${pkg.changelogNote}
              onChange=${e => pkg.setChangelogNote(e.target.value)}
              placeholder=${t('profile.generator.changelogPlaceholder')} />
          </label>
        </div>
      `}

      <div class="flex-actions">
        <button class="btn-outline btn-sm" onClick=${() => pkg.setShowDialog(false)}>
          ${t('profile.generator.cancelRemove')}
        </button>
        <button class="btn-primary btn-sm" onClick=${pkg.handlePackage} disabled=${pkg.loading}>
          ${pkg.loading ? '...' : (project.packageGroupId
            ? t('profile.generator.updatePackage')
            : t('profile.generator.packageProject'))}
        </button>
      </div>
    </div>
  `;
}
