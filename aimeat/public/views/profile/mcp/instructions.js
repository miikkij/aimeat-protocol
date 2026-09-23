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
 *   2026-09-22 -- Composed from the shared component set (Field, KeyValue, Surface code, CopyAction,
 *     Fold); no own CSS. Same prompt, same refresh and the same answer after it.
 *   v1.0.0 — 2026-09-02 — Initial (design canvas "AIMEAT MCP-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, Stack, Surface, KeyValue, Field, Action, CopyAction, Text } from '/components/poster-parts.js';
import { InstructionBlock } from '/views/profile/instruction-block.js';
import { m } from './frame.js';

export function secInstructions(ctx) {
  const orgs = ctx.organisms;
  return html`
    <${Section} id="mcp-instr" title=${m('secInstructions')} count=${m('secInstructionsSub')}>
      ${orgs === null ? html`<${Text} kind="caption" tone="muted">${t('helloMcp.block.loading')}<//>`
        : !orgs.length ? html`<${Stack}>
          <${Text} kind="lead">${m('noOrgLead')}<//>
          ${orgPromptBlock(ctx)}
        <//>`
        : html`<${Stack}>
          <${Text} kind="lead">${m('instrLead')}<//>
          ${orgs.length > 1
            ? html`<${Field} type="select" label=${m('orgLabel')} value=${ctx.orgId} onChange=${(e) => ctx.setOrgId(e.target.value)}
                options=${orgs.map((o) => ({ value: o.id, label: o.name || o.id }))} />`
            : html`<${KeyValue} label=${m('orgLabel')} value=${orgs[0].name || orgs[0].id} />`}
          <${InstructionBlock} orgId=${ctx.orgId} />
          <${Fold} id="mcp-org" number="·" title=${m('orgFold')} sub=${m('orgFoldSub')} open=${ctx.folds.org} onToggle=${() => ctx.setFold('org', !ctx.folds.org)}>
            ${orgPromptBlock(ctx)}
          <//>
        <//>`}
    <//>`;
}

/** The prompt that has the AI create an organism, and the button that shows it once it exists. */
function orgPromptBlock(ctx) {
  const f = ctx.found;
  return html`<${Stack}>
    <${Text}>${m('orgLead')}<//>
    <${Field} label=${m('orgPurposeLabel')} value=${ctx.purpose} placeholder=${m('orgPurposePh')} onInput=${(e) => ctx.setPurpose(e.target.value)} />
    <${Surface} kind="code">${ctx.orgPrompt}<//>
    <${Stack} direction="wrap" align="center">
      <${CopyAction} text=${ctx.orgPrompt} label=${t('helloMcp.org.copy')} copiedLabel=${t('common.copied')} />
      <${Action} disabled=${ctx.orgBusy} onClick=${ctx.refreshOrgs}>${ctx.orgBusy ? t('helloMcp.org.refreshing') : t('helloMcp.org.refresh')}<//>
    <//>
    ${f ? html`<${Text} tone=${f.ok ? 'success' : 'muted'}>
      ${f.ok ? m('foundOne', { name: f.name })
        : f.failed ? t('helloMcp.org.foundFailed')
          : f.count ? m('foundNoneButHave', { n: f.count })
            : t('helloMcp.org.foundNone')}
    <//>` : null}
  <//>`;
}
