/**
 * @file RemovePanel.js
 * @description Remove components panel sub-component — renders checkboxes for
 *   selecting registered components to remove, with memory deletion toggle.
 *   Pure rendering component: all state and handlers come from useLifecycle hook.
 *
 *   Part of the hook-per-domain architecture. Receives the useLifecycle() return
 *   value as `lifecycle` prop.
 *
 * @structure
 *   - RemovePanel({ components, lifecycle }): panel with component checkboxes + remove button
 * @usage
 *   import { RemovePanel } from './foundry-dashboard/RemovePanel.js';
 *   ${lifecycle.showRemovePanel && html`<${RemovePanel} components=${core.components} lifecycle=${lifecycle} />`}
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js ProjectDashboard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export function RemovePanel({ components, lifecycle }) {
  return html`
    <div class="fnd-remove-panel">
      <p class="fnd-remove-heading">${t('profile.foundry.removeSelectLabel')}</p>
      <div class="fnd-remove-list">
        ${components.filter(c => c.registeredAs).map(c => html`
          <label class="fnd-remove-item">
            <input type="checkbox"
              checked=${!!lifecycle.removeSelection[c.id]}
              onChange=${e => lifecycle.setRemoveSelection({ ...lifecycle.removeSelection, [c.id]: e.target.checked })}
            />
            <span>${c.label}</span>
            <span class="fnd-type-badge type-${c.type}">${c.type}</span>
            <span class="fnd-remove-name">${c.registeredAs}</span>
          </label>
        `)}
      </div>
      <div class="flex-row">
        <label class="fnd-checkbox-label">
          <input type="checkbox" checked=${lifecycle.removeMemory} onChange=${e => lifecycle.setRemoveMemory(e.target.checked)} />
          ${t('profile.foundry.deleteExtensionMemory')}
        </label>
        <button class="btn-danger-solid btn-sm"
          onClick=${lifecycle.handleRemoveConfirmed}
          disabled=${lifecycle.lifecycleLoading === 'remove' || Object.values(lifecycle.removeSelection).filter(Boolean).length === 0}>
          ${lifecycle.lifecycleLoading === 'remove' ? t('profile.foundry.removingLabel') : t('profile.foundry.removeSelected').replace('{count}', Object.values(lifecycle.removeSelection).filter(Boolean).length)}
        </button>
      </div>
    </div>
  `;
}
