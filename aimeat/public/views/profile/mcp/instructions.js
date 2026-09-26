/**
 * @file public/views/profile/mcp/instructions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 03 of the MCP page: the instructions an AI reads at the start of every
 *   conversation, generated from the chosen organism's real structure (the InstructionBlock the
 *   organism pages render too), and the prompt that has the AI create an organism for a person who
 *   has none yet. With organisms the prompt sits in a fold; without them it is the section.
 * @structure secInstructions · orgPromptBlock
 * @usage import { secInstructions } from './instructions.js';
 * @version-history
 *   v1.11.0 — 2026-09-26 — The organism prompt is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.10.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 — 2026-09-26 — The one organism, shown where the drop-down would stand, is the Text field (.og-input), a unification: its own copy of that look goes.
 *   v1.8.0 — 2026-09-26 — The paragraph that opens the proof and the organism prompt is the lead (.og-lead), a unification: the look most tabs use; the Form message and the managed-environment note under it keep their own look.
 *   v1.7.0 — 2026-09-25 — A line that says a part is still loading is the quiet sentence with the Loading mark (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — A line that says what happened after an action is the Form message, a failure in its error tone (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.4.0 — 2026-09-25 — A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-09-02 — Initial (design canvas "AIMEAT MCP-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { CopyButton } from '/components/CopyButton.js';
import { InstructionBlock } from '/views/profile/instruction-block.js';
import { m } from './frame.js';

export function secInstructions(ctx) {
  const orgs = ctx.organisms;
  return html`
    <${PageSection} id="mcp-instr" num="03" title=${m('secInstructions')} count=${m('secInstructionsSub')}>
      ${orgs === null ? html`<p class="poster-quiet loading-mark">${t('helloMcp.block.loading')}</p>`
        : !orgs.length ? html`
          <p class="og-lead">${m('noOrgLead')}</p>
          ${orgPromptBlock(ctx)}`
        : html`
          <p class="og-lead">${m('instrLead')}</p>
          <div class="mc-instr-pick">
            ${orgs.length > 1 ? html`
              <label class="mc-field">
                <span class="poster-label">${m('orgLabel')}</span>
                <select class="select-field" value=${ctx.orgId} onChange=${(e) => ctx.setOrgId(e.target.value)}>
                  ${orgs.map((o) => html`<option value=${o.id} key=${o.id}>${o.name || o.id}</option>`)}
                </select>
              </label>` : html`<div class="mc-field"><span class="poster-label">${m('orgLabel')}</span><div class="og-input">${orgs[0].name || orgs[0].id}</div></div>`}
          </div>
          <${InstructionBlock} orgId=${ctx.orgId} />
          <div class="og-folds mc-org-fold">
            <${FoldSection} id="mcp-org" num="·" title=${m('orgFold')} sub=${m('orgFoldSub')} open=${ctx.folds.org} onToggle=${() => ctx.setFold('org', !ctx.folds.org)}>
              ${orgPromptBlock(ctx)}
            <//>
          </div>`}
    <//>`;
}

/** The prompt that has the AI create an organism, and the button that shows it once it exists. */
function orgPromptBlock(ctx) {
  const f = ctx.found;
  return html`
    <div class="mc-org">
      <p class="og-lead">${m('orgLead')}</p>
      <label class="mc-field">
        <span class="poster-label">${m('orgPurposeLabel')}</span>
        <input class="og-input" value=${ctx.purpose} placeholder=${m('orgPurposePh')} onInput=${(e) => ctx.setPurpose(e.target.value)} />
      </label>
      <pre class="code-block mc-code">${ctx.orgPrompt}</pre>
      <div class="og-doors mc-proof-doors">
        <${CopyButton} text=${ctx.orgPrompt} className="poster-action poster-action--small" label=${t('helloMcp.org.copy')} copiedLabel=${t('common.copied')} />
        <button type="button" class="poster-action poster-action--small" disabled=${ctx.orgBusy} onClick=${ctx.refreshOrgs}>${ctx.orgBusy ? t('helloMcp.org.refreshing') : t('helloMcp.org.refresh')}</button>
      </div>
      ${f ? html`<p class=${'form-message mc-found' + (f.ok ? '' : ' form-message--error')}>
        ${f.ok ? m('foundOne', { name: f.name })
          : f.failed ? t('helloMcp.org.foundFailed')
            : f.count ? m('foundNoneButHave', { n: f.count })
              : t('helloMcp.org.foundNone')}
      </p>` : null}
    </div>`;
}
