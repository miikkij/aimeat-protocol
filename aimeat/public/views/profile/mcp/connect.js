/**
 * @file public/views/profile/mcp/connect.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 02 of the MCP page: connect an AI. The per-tool setup guide (the same
 *   component the Agents page renders), the short way in for every tool that has one (a link, a
 *   double-click script, a file), the two things to know before starting, and the proof: one
 *   prompt, one button, one answer. Open for a person who has not proved a connection yet; folded
 *   to its status line once the proof is in, and re-openable at any time.
 * @structure secConnect · quickWays · proofBlock · failList
 * @usage import { secConnect } from './connect.js';
 * @version-history
 *   v1.12.0 -- 2026-09-26 -- The proof prompt is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.11.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.10.0 -- 2026-09-26 -- A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v1.9.0 -- 2026-09-26 -- The paragraph that opens the proof and the organism prompt is the lead (.og-lead), a unification: the look most tabs use; the Form message and the managed-environment note under it keep their own look.
 *   v1.8.0 -- 2026-09-25 -- The short ways in and the setup guide's fields are the Facts (css/components/facts.css; the guide takes `facts`), a unification: the look most tabs use.
 *   v1.7.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v1.6.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   2026-09-13 -- V2aa: compose the proof section headline with the shared B1 class.
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
import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
import { McpSetupGuide } from '/views/profile/ai-setup-guide.js';
import { m, day } from './frame.js';
import { Hint } from '/components/Hint.js';

export function secConnect(ctx, proven) {
  const toolCount = Array.isArray(ctx.tools) ? ctx.tools.length : null;
  return html`
    <${PageSection} id="mcp-connect" num="02" title=${proven ? m('secConnect') : m('secConnectFirst')} count=${toolCount ? m('toolCount', { n: toolCount }) : null}>
      ${proven ? html`
        <p class="og-lead">${m('connectLeadProven')}</p>
        ${quickWays(ctx)}
        <div class="og-folds">
          <${FoldSection} id="mcp-guide" num="·" title=${m('guideFold')} sub=${m('guideFoldSub')} open=${ctx.folds.guide} onToggle=${() => ctx.setFold('guide', !ctx.folds.guide)}>
            <${McpSetupGuide} installClassName="poster-aside" tabClass="poster-tab" activeClass="is-on" facts stepRows />
          <//>
          <${FoldSection} id="mcp-proof" num="·" title=${m('proofFold')} sub=${m('proofFoldSub', { date: day(ctx.proof?.at) })} open=${ctx.folds.proof} onToggle=${() => ctx.setFold('proof', !ctx.folds.proof)}>
            ${proofBlock(ctx, true)}
          <//>
        </div>` : html`
        <p class="og-lead">${m('connectLeadNew')}</p>
        <${McpSetupGuide} installClassName="poster-aside" tabClass="poster-tab" activeClass="is-on" facts stepRows />
        <div class="mc-pre poster-aside">
          <span class="mc-pre-label poster-label">${m('preTitle')}</span>
          <p>${m('preAddress')}</p>
          <p>${m('preManaged')}</p>
          <p>${m('preTime')}</p>
        </div>
        ${quickWays(ctx)}
        ${proofBlock(ctx, false)}`}
    <//>`;
}

/** Every tool that can be attached without walking its settings menu, from the tool table. */
function quickWays(ctx) {
  const tools = (ctx.tools || []).filter((tool) => tool?.mcp?.install && (tool.mcp.install.link || tool.mcp.install.scripts?.length || tool.mcp.install.file));
  if (!tools.length) return null;
  return html`
    <div class="mc-quick">
      <span class="poster-label">${m('quickTitle')}</span>
      <div class="facts">
        ${tools.map((tool) => {
          const ins = tool.mcp.install;
          return html`
            <div class="facts-k poster-label" key=${'k' + tool.id}>${tool.label}</div>
            <div class="facts-v" key=${'v' + tool.id}>
              <div class="og-doors">
                ${ins.link ? html`<a class="poster-action poster-action--small" href=${ins.link.href}>${ins.link.label}</a>` : null}
                ${(ins.scripts || []).map((sc) => html`<a class="poster-action poster-action--small" key=${sc.os} href=${sc.url} download=${sc.filename} title=${sc.note}>${sc.label}</a>`)}
                ${ins.file ? html`<a class="poster-action poster-action--small poster-action--lower" href=${ins.file.url} download=${ins.file.filename} title=${ins.file.where}>${ins.file.label}</a>` : null}
              </div>
              <small>${ins.link ? ins.link.note : ins.scripts?.[0] ? ins.scripts[0].note : ins.file.where}</small>
            </div>`;
        })}
      </div>
      <${Hint}>${m('quickHint')}<//>
    </div>`;
}

/** The proof: paste one prompt into the chat, press check, read the answer here. */
function proofBlock(ctx, again) {
  return html`
    <div class="mc-proof">
      ${!again && html`<h3 class="mc-h3 poster-section-title">${m('proofTitle')}</h3>`}
      <p class="og-lead">${again ? m('proofLeadAgain') : m('proofLead')}</p>
      <pre class="code-block mc-code">${ctx.prompt || t('helloMcp.proof.loading')}</pre>
      <div class="og-doors mc-proof-doors">
        <${CopyButton} text=${ctx.prompt} className=${again ? 'poster-action poster-action--small' : 'poster-slab'} label=${t('helloMcp.proof.copy')} copiedLabel=${t('common.copied')} />
        <button type="button" class="poster-action poster-action--small" disabled=${ctx.checking} onClick=${ctx.check}>${ctx.checking ? t('helloMcp.proof.checking') : t('helloMcp.proof.check')}</button>
      </div>
      ${ctx.proofState === 'fail' ? failList() : html`<${Hint}>${m('proofHint')}<//>`}
      <${ManagedEnvNote} compact=${true} />
    </div>`;
}

/** The failure path, the usual cause first. */
function failList() {
  return html`
    <div class="mc-fail poster-aside poster-aside--small poster-aside--irreversible">
      <b>${t('helloMcp.fail.title')}</b>
      <ol>
        <li>${t('helloMcp.fail.s1')}</li>
        <li>${t('helloMcp.fail.s2')}</li>
        <li>${t('helloMcp.fail.s3')}</li>
        <li>${t('helloMcp.fail.s4')}</li>
        <li>${t('helloMcp.fail.s5')}</li>
      </ol>
      <${Hint}>${t('helloMcp.fail.retry')}<//>
    </div>`;
}
