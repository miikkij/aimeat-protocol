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
 *   import { RemovePanel } from './generator-dashboard/RemovePanel.js';
 *   ${lifecycle.showRemovePanel && html`<${RemovePanel} components=${core.components} lifecycle=${lifecycle} />`}
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js ProjectDashboard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export function RemovePanel({ components, lifecycle }) {
  return html`
    <div class="pf-gen-remove-panel">
      <p class="pf-gen-remove-heading">${t('profile.generator.removeSelectLabel')}</p>
      <div class="pf-gen-remove-list">
        ${components.filter(c => c.registeredAs).map(c => html`
          <label class="pf-gen-remove-item">
            <input type="checkbox"
              checked=${!!lifecycle.removeSelection[c.id]}
              onChange=${e => lifecycle.setRemoveSelection({ ...lifecycle.removeSelection, [c.id]: e.target.checked })}
            />
            <span>${c.label}</span>
            <span class="pf-gen-type-badge type-${c.type}">${c.type}</span>
            <span class="pf-gen-remove-name">${c.registeredAs}</span>
          </label>
        `)}
      </div>
      <div class="flex-row">
        <label class="pf-gen-checkbox-label">
          <input type="checkbox" checked=${lifecycle.removeMemory} onChange=${e => lifecycle.setRemoveMemory(e.target.checked)} />
          ${t('profile.generator.deleteExtensionMemory')}
        </label>
        <button class="btn-danger-solid btn-sm"
          onClick=${lifecycle.handleRemoveConfirmed}
          disabled=${lifecycle.lifecycleLoading === 'remove' || Object.values(lifecycle.removeSelection).filter(Boolean).length === 0}>
          ${lifecycle.lifecycleLoading === 'remove' ? t('profile.generator.removingLabel') : t('profile.generator.removeSelected').replace('{count}', Object.values(lifecycle.removeSelection).filter(Boolean).length)}
        </button>
      </div>
    </div>
  `;
}
