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
 *   v2.0.0 — 2026-09-26 — Every part is a component call that gets data (page group G6): Section
 *     (fold in Folds), Note (lead, loading, the Form message), Select or a read-only TextField for the
 *     organism, a TextField for the purpose, the Code block (tall) for the prompt, Action with
 *     `copy`. The page writes no class.
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
import { Section } from '/components/Section.js';
import { Folds } from '/components/Folds.js';
import { Action, Actions } from '/components/Action.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { Space } from '/components/Layout.js';
import { InstructionBlock } from '/components/InstructionBlock.js';
import { m } from './frame.js';

export function secInstructions(ctx) {
  const orgs = ctx.organisms;
  return html`
    <${Section} id="mcp-instr" num="03" title=${m('secInstructions')} count=${m('secInstructionsSub')}>
      ${orgs === null ? html`<${Note} kind="loading">${t('helloMcp.block.loading')}<//>`
        : !orgs.length ? html`
          <${Note} kind="lead">${m('noOrgLead')}<//>
          ${orgPromptBlock(ctx)}`
        : html`
          <${Note} kind="lead">${m('instrLead')}<//>
          <${Space} below="small">
            ${orgs.length > 1
              ? html`<${Select} label=${m('orgLabel')} value=${ctx.orgId} onChange=${ctx.setOrgId}
                  options=${orgs.map((o) => [o.id, o.name || o.id])} />`
              : html`<${TextField} label=${m('orgLabel')} readOnly value=${orgs[0].name || orgs[0].id} />`}
          <//>
          <${InstructionBlock} orgId=${ctx.orgId} />
          <${Space} above="large">
            <${Folds}>
              <${Section} fold clip id="mcp-org" num="·" title=${m('orgFold')} sub=${m('orgFoldSub')} open=${ctx.folds.org} onToggle=${() => ctx.setFold('org', !ctx.folds.org)}>
                ${orgPromptBlock(ctx)}
              <//>
            <//>
          <//>`}
    <//>`;
}

/** The prompt that has the AI create an organism, and the button that shows it once it exists. */
function orgPromptBlock(ctx) {
  const f = ctx.found;
  return html`
    <${Note} kind="lead">${m('orgLead')}<//>
    <${TextField} label=${m('orgPurposeLabel')} value=${ctx.purpose} placeholder=${m('orgPurposePh')} onInput=${ctx.setPurpose} />
    <${Code} block tall>${ctx.orgPrompt}<//>
    <${Actions}>
      <${Action} small copy=${ctx.orgPrompt} copiedLabel=${t('common.copied')}>${t('helloMcp.org.copy')}<//>
      <${Action} small disabled=${ctx.orgBusy} onClick=${ctx.refreshOrgs}>${ctx.orgBusy ? t('helloMcp.org.refreshing') : t('helloMcp.org.refresh')}<//>
    <//>
    ${f ? html`<${Note} kind="message" error=${!f.ok}>
      ${f.ok ? m('foundOne', { name: f.name })
        : f.failed ? t('helloMcp.org.foundFailed')
          : f.count ? m('foundNoneButHave', { n: f.count })
            : t('helloMcp.org.foundNone')}
    <//>` : null}`;
}
