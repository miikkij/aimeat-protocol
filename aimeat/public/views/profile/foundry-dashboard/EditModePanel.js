/**
 * @file EditModePanel.js
 * @description Edit service panel sub-component — renders the 3-phase edit flow:
 *   1. Request mode: textarea for describing the change
 *   2. Impact mode: paste/parse AI impact analysis JSON
 *   3. Editing mode: per-component edit buttons with impact classification
 *
 *   Pure rendering component: all state and handlers come from useEditMode hook.
 *   The batch edit "Run All" button uses autopilotState for progress display.
 *
 *   Part of the hook-per-domain architecture.
 *
 * @structure
 *   - EditModePanel({ edit, core, autopilotState, orSettings }): renders the active
 *     edit sub-mode based on edit.editMode value
 * @usage
 *   import { EditModePanel } from './foundry-dashboard/EditModePanel.js';
 *   ${edit.editMode && html`<${EditModePanel} edit=${edit} core=${core} autopilotState=${autopilotState} orSettings=${orSettings} />`}
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-tab.js ProjectDashboard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export function EditModePanel({ edit, core, autopilotState, orSettings }) {
  if (edit.editMode === 'request') {
    return html`
      <div class="fnd-edit-panel">
        <h4>${t('profile.foundry.editService')}</h4>
        <p class="fnd-subtitle">${t('profile.foundry.editServiceDesc')}</p>
        <textarea class="fnd-result-area" rows="4"
          placeholder="${t('profile.foundry.editPlaceholder')}"
          value=${edit.changeRequest}
          onInput=${e => edit.setChangeRequest(e.target.value)}
        />
        <div class="fnd-actions">
          <button class="btn-primary btn-sm" onClick=${edit.handleCopyImpactPrompt} disabled=${!edit.changeRequest.trim()}>
            ${t('profile.foundry.copyImpactPrompt')}
          </button>
          ${orSettings?.hasApiKey && html`
            <button class="btn-outline btn-sm fnd-or-run-btn ${edit.aiRunning === 'impact' ? 'fnd-or-running' : ''}"
              onClick=${edit.handleRunImpactAi}
              disabled=${!edit.changeRequest.trim() || edit.aiRunning !== null}>
              ${edit.aiRunning === 'impact'
                ? html`<span class="fnd-or-spin">⟳</span> ${t('profile.foundry.openrouter.waiting')}`
                : t('profile.foundry.openrouter.runWithAi')}
            </button>
          `}
        </div>
      </div>
    `;
  }

  if (edit.editMode === 'impact') {
    return html`
      <div class="fnd-edit-panel">
        <h4>${t('profile.foundry.impactAnalysis')}</h4>
        <p class="fnd-subtitle">${t('profile.foundry.impactPasteDesc')}</p>
        <textarea class="fnd-result-area" rows="8"
          placeholder="Paste the JSON response from AI Chat..."
          value=${edit.impactResult}
          onInput=${e => edit.setImpactResult(e.target.value)}
        />
        ${edit.impactErrors.length > 0 && html`
          <div class="fnd-errors">
            <ul>${edit.impactErrors.map(e => html`<li>${e}</li>`)}</ul>
          </div>
        `}
        <div class="fnd-actions">
          <button class="btn-primary btn-sm" onClick=${edit.handleParseImpact} disabled=${!edit.impactResult.trim()}>
            ${t('profile.foundry.analyzeImpact')}
          </button>
          <button class="btn-outline btn-sm" onClick=${() => edit.setEditMode('request')}>${t('profile.foundry.back')}</button>
        </div>
      </div>
    `;
  }

  if (edit.editMode === 'editing' && edit.impactParsed) {
    return html`
      <div class="fnd-edit-panel">
        <h4>${t('profile.foundry.impactResults')}</h4>
        ${edit.impactParsed.summary && html`<p class="fnd-subtitle">${edit.impactParsed.summary}</p>`}
        <div class="fnd-impact-list">
          ${edit.impactParsed.analysis.map(a => {
            const comp = core.components.find(c => c.id === a.id);
            const impactClass = a.impact === 'root' ? 'impact-root' : a.impact === 'update' ? 'impact-update' : 'impact-none';
            return html`
              <div class="fnd-impact-item ${impactClass}">
                <div class="fnd-impact-header">
                  <span class="fnd-impact-badge ${impactClass}">${a.impact.toUpperCase()}</span>
                  <span class="fnd-impact-label">${a.label}</span>
                </div>
                <div class="fnd-impact-reason">${a.reason}</div>
                ${(a.impact === 'root' || a.impact === 'update') && comp && html`
                  <div class="fnd-actions mt-xs">
                    <button class="btn-outline btn-sm"
                      onClick=${() => edit.handleCopyEditPrompt(comp, a.suggestedChange)}>
                      ${t('profile.foundry.copyEditPrompt')}
                    </button>
                    ${orSettings?.hasApiKey && html`
                      <button class="btn-outline btn-sm fnd-or-run-btn ${edit.aiRunning === comp.id ? 'fnd-or-running' : ''}"
                        onClick=${() => edit.handleRunSingleEditAi(comp, a.suggestedChange)}
                        disabled=${edit.aiRunning !== null || autopilotState.running}>
                        ${edit.aiRunning === comp.id
                          ? html`<span class="fnd-or-spin">⟳</span> ${t('profile.foundry.openrouter.waiting')}`
                          : t('profile.foundry.openrouter.runWithAi')}
                      </button>
                    `}
                  </div>
                `}
              </div>
            `;
          })}
        </div>
        <div class="fnd-actions">
          ${orSettings?.hasApiKey && edit.impactParsed.analysis.some(a => a.impact === 'root' || a.impact === 'update') && html`
            <button class="btn-primary btn-sm fnd-or-run-btn ${autopilotState.running ? 'fnd-or-running' : ''}"
              onClick=${edit.handleRunAllEditsAi}
              disabled=${autopilotState.running}>
              ${autopilotState.running
                ? html`<span class="fnd-or-spin">⟳</span> ${autopilotState.step}`
                : t('profile.foundry.openrouter.runAll')}
            </button>
            ${autopilotState.running && html`
              <button class="btn-danger btn-sm" onClick=${autopilotState.cancel}>
                ${t('profile.foundry.openrouter.cancel')}
              </button>
            `}
          `}
          <button class="btn-outline btn-sm" onClick=${() => edit.setEditMode('impact')}>${t('profile.foundry.backToImpact')}</button>
          <button class="btn-ghost btn-sm" onClick=${edit.exitEditMode}>${t('profile.foundry.done')}</button>
        </div>
      </div>
    `;
  }

  return null;
}
