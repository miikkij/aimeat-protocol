/**
 * @file views/profile/calibrator-batch.step4.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Step 4 (Synthesis) render block for the Prompt Calibrator V2 batch card — grouped
 *   proposals, A/B/C options, recommendation, apply/copy actions and paste-back. Extracted
 *   verbatim from calibrator-batch.js to satisfy max-file-lines. Holds no hooks of its own; all
 *   state and handlers are passed in from the parent BatchCard as props.
 * @structure
 *   - Step4View: renders the Step 4 <details> block
 * @usage
 *   import { Step4View } from './calibrator-batch.step4.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from calibrator-batch.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CollapsiblePre, PasteBack } from './calibrator-batch.helpers.js';

// ── Render: Step 4 (Synthesis) ──

export function Step4View({
  detail, selectedOption, setSelectedOption, applyingFixes, hasReasoningModel,
  handleApplySelected, handleCopyPromptAndProposals, applyElapsed, handlePasteSynthesis,
  running, handleStep4,
}) {
  const models = detail?.models || [];
  const anyReflected = models.some(m => m.step3_reflection?.status === 'done');
  const synth = detail?.step4_synthesis;
  const hasSynthesis = synth?.status === 'done';

  return html`
    <details class="fnd-cal-step" open=${hasSynthesis}>
      <summary>${t('profile.calibrator.step4')}</summary>
      <div class="fnd-cal-step-body">
        ${synth?.error ? html`<div class="fnd-cal-warning" style="color:var(--danger)">Error: ${synth.error}</div>` : ''}
        ${synth?.status === 'error' && synth?.analysis ? html`<div class="fnd-cal-hint" style="color:var(--danger)">${synth.analysis}</div>` : ''}

        <!-- Grouped proposals -->
        ${synth?.groupedProposals?.length > 0 ? html`
          <div class="fnd-cal-synthesis">
            <div class="fnd-cal-editor-label">${t('profile.calibrator.groupedProposals')}</div>
            ${synth.groupedProposals.map((gp, i) => html`
              <div class="fnd-cal-proposal-card" key=${gp.id || i}>
                <div>${gp.text || gp.proposal || JSON.stringify(gp)}</div>
                ${gp.sources ? html`<div class="fnd-cal-proposal-sources">${t('profile.calibrator.overlap')}: ${Array.isArray(gp.sources) ? gp.sources.join(', ') : gp.sources}</div>` : ''}
                ${gp.overlap ? html`<span class="fnd-cal-dim-badge ${gp.overlap > 1 ? 'pass' : 'fail'}">${t('profile.calibrator.overlap')}: ${gp.overlap}</span> ` : ''}
                ${gp.impact ? html`<span class="fnd-cal-proposal-impact ${gp.impact}">${t('profile.calibrator.impact')}: ${gp.impact}</span>` : ''}
              </div>
            `)}
          </div>
        ` : ''}

        <!-- Options A/B/C -->
        ${synth?.options ? html`
          <div class="fnd-cal-options">
            ${['A', 'B', 'C'].map(key => {
              const opt = synth.options[key];
              if (!opt) return null;
              return html`
                <div class="fnd-cal-option ${selectedOption === key ? 'selected' : ''}"
                  onClick=${() => setSelectedOption(key)}>
                  <input type="radio" name="synth-option" value=${key}
                    checked=${selectedOption === key}
                    onChange=${() => setSelectedOption(key)} />
                  <div>
                    <div class="fnd-cal-option-label">${t('profile.calibrator.option' + key)}</div>
                    ${opt.description ? html`<div class="fnd-cal-option-impact">${opt.description}</div>` : ''}
                    ${opt.proposalIds ? html`<div class="fnd-cal-option-impact">${opt.proposalIds.length} ${t('profile.calibrator.proposals')}</div>` : ''}
                  </div>
                </div>
              `;
            })}
          </div>
        ` : ''}

        <!-- Recommendation -->
        ${synth?.recommendation ? html`
          <div class="fnd-cal-recommendation">
            <strong>${t('profile.calibrator.recommendation')}:</strong> ${synth.recommendation}
          </div>
        ` : ''}

        <!-- Apply / Copy actions -->
        ${hasSynthesis && synth?.options ? html`
          <div class="fnd-cal-step-actions">
            <button class="btn-primary btn-sm" onClick=${handleApplySelected}
              disabled=${applyingFixes || !hasReasoningModel}>
              ${applyingFixes ? t('profile.calibrator.applyingFixes') : t('profile.calibrator.applySelected')}
            </button>
            <button class="btn-ghost btn-sm" onClick=${handleCopyPromptAndProposals}>
              ${t('profile.calibrator.copyPromptAndProposals')}
            </button>
          </div>
          ${applyingFixes ? html`
            <div class="fnd-cal-progress">
              ${t('profile.calibrator.applyingFixes')} ${applyElapsed}s — ${applyElapsed > 30 ? 'Large prompts take time. Do not close the browser.' : 'Rewriting prompt with selected proposals...'}
            </div>
          ` : ''}
        ` : ''}

        <!-- Collapsible prompt/response -->
        ${synth?.promptSent ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewPromptSent')} text=${synth.promptSent} />` : ''}
        ${synth?.rawResponse ? html`<${CollapsiblePre} label=${t('profile.calibrator.viewRawResponse')} text=${synth.rawResponse} />` : ''}
        <${PasteBack} label=${t('profile.calibrator.pasteSynthesis')} onSave=${handlePasteSynthesis} />

        <!-- Run button -->
        <div class="fnd-cal-step-actions">
          <button class="btn-primary btn-sm" onClick=${() => handleStep4()} disabled=${running || !hasReasoningModel || !anyReflected}>
            ${t('profile.calibrator.runStep4')}
          </button>
          ${!hasReasoningModel ? html`<span class="fnd-cal-hint">${t('profile.calibrator.setReasoningModel')}</span>` : ''}
        </div>
      </div>
    </details>
  `;
}
