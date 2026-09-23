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
 *   v1.0.0 — 2026-09-02 — Initial (design canvas "AIMEAT MCP-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold } from '/views/profile/organisms/poster-parts.js';
import { CopyButton } from '/components/CopyButton.js';
import { InstructionBlock } from '/views/profile/instruction-block.js';
import { m } from './frame.js';

export function secInstructions(ctx) {
  const orgs = ctx.organisms;
  return html`
    <${Section} id="mcp-instr" num="03" title=${m('secInstructions')} count=${m('secInstructionsSub')}>
      ${orgs === null ? html`<p class="mc-hint">${t('helloMcp.block.loading')}</p>`
        : !orgs.length ? html`
          <p class="mc-lead">${m('noOrgLead')}</p>
          ${orgPromptBlock(ctx)}`
        : html`
          <p class="mc-lead">${m('instrLead')}</p>
          <div class="mc-instr-pick">
            ${orgs.length > 1 ? html`
              <label class="mc-field">
                <span class="og-label">${m('orgLabel')}</span>
                <select class="og-input" value=${ctx.orgId} onChange=${(e) => ctx.setOrgId(e.target.value)}>
                  ${orgs.map((o) => html`<option value=${o.id} key=${o.id}>${o.name || o.id}</option>`)}
                </select>
              </label>` : html`<div class="mc-field"><span class="og-label">${m('orgLabel')}</span><div class="mc-field-value">${orgs[0].name || orgs[0].id}</div></div>`}
          </div>
          <${InstructionBlock} orgId=${ctx.orgId} />
          <div class="og-folds mc-org-fold">
            <${Fold} id="mcp-org" num="·" title=${m('orgFold')} sub=${m('orgFoldSub')} open=${ctx.folds.org} onToggle=${() => ctx.setFold('org', !ctx.folds.org)}>
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
      <p>${m('orgLead')}</p>
      <label class="mc-field">
        <span class="og-label">${m('orgPurposeLabel')}</span>
        <input class="og-input" value=${ctx.purpose} placeholder=${m('orgPurposePh')} onInput=${(e) => ctx.setPurpose(e.target.value)} />
      </label>
      <pre class="mc-code">${ctx.orgPrompt}</pre>
      <div class="og-doors mc-proof-doors">
        <${CopyButton} text=${ctx.orgPrompt} className="og-door" label=${t('helloMcp.org.copy')} copiedLabel=${t('common.copied')} />
        <button type="button" class="og-door" disabled=${ctx.orgBusy} onClick=${ctx.refreshOrgs}>${ctx.orgBusy ? t('helloMcp.org.refreshing') : t('helloMcp.org.refresh')}</button>
      </div>
      ${f ? html`<p class=${'mc-found' + (f.ok ? ' mc-found--ok' : '')}>
        ${f.ok ? m('foundOne', { name: f.name })
          : f.failed ? t('helloMcp.org.foundFailed')
            : f.count ? m('foundNoneButHave', { n: f.count })
              : t('helloMcp.org.foundNone')}
      </p>` : null}
    </div>`;
}
