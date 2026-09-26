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
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): the
 *     sections Section (fold for the guide and the proof, in Folds), the leads and hints Note, the
 *     short ways in Facts with Action links, the before-you-start note the aside Note with its Label,
 *     the proof's heading the Sub-heading, its prompt the Code block (tall: it scrolls after 24rem),
 *     its copy Loud or Action with `copy`, the failure path the aside with the numbered steps
 *     (IndexList steps, Jouni's decision "Numbered list"), the managed-environment note its poster
 *     tone, the setup guide the SetupGuide component with its named options (poster, asideInstall,
 *     facts, stepRows; page group G1a's). The page writes no class.
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
import { Section } from '/components/Section.js';
import { Folds } from '/components/Folds.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { SubHeading } from '/components/SubHeading.js';
import { Space, Stack } from '/components/Layout.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
import { SetupGuide } from '/components/SetupGuide.js';
import { m, day } from './frame.js';

/** The per-tool setup guide: the tool tabs, the install row in the attention note, facts, numbered steps. */
const guide = () => html`<${SetupGuide} poster asideInstall facts stepRows />`;

export function secConnect(ctx, proven) {
  const toolCount = Array.isArray(ctx.tools) ? ctx.tools.length : null;
  return html`
    <${Section} id="mcp-connect" num="02" title=${proven ? m('secConnect') : m('secConnectFirst')} count=${toolCount ? m('toolCount', { n: toolCount }) : null}>
      ${proven ? html`
        <${Note} kind="lead">${m('connectLeadProven')}<//>
        ${quickWays(ctx)}
        <${Folds}>
          <${Section} fold clip id="mcp-guide" num="·" title=${m('guideFold')} sub=${m('guideFoldSub')} open=${ctx.folds.guide} onToggle=${() => ctx.setFold('guide', !ctx.folds.guide)}>
            ${guide()}
          <//>
          <${Section} fold clip id="mcp-proof" num="·" title=${m('proofFold')} sub=${m('proofFoldSub', { date: day(ctx.proof?.at) })} open=${ctx.folds.proof} onToggle=${() => ctx.setFold('proof', !ctx.folds.proof)}>
            ${proofBlock(ctx, true)}
          <//>
        <//>` : html`
        <${Note} kind="lead">${m('connectLeadNew')}<//>
        ${guide()}
        <${Space} above="large">
          <${Note} kind="aside">
            <${Stack} gap="small">
              <${Label} block>${m('preTitle')}<//>
              <span>${m('preAddress')}</span>
              <span>${m('preManaged')}</span>
              <span>${m('preTime')}</span>
            <//>
          <//>
        <//>
        ${quickWays(ctx)}
        ${proofBlock(ctx, false)}`}
    <//>`;
}

/** Every tool that can be attached without walking its settings menu, from the tool table. */
function quickWays(ctx) {
  const tools = (ctx.tools || []).filter((tool) => tool?.mcp?.install && (tool.mcp.install.link || tool.mcp.install.scripts?.length || tool.mcp.install.file));
  if (!tools.length) return null;
  return html`
    <${Space} above="large">
      <${Label} block>${m('quickTitle')}<//>
      <${Facts} rows=${tools.map((tool) => {
        const ins = tool.mcp.install;
        return {
          key: tool.id,
          k: tool.label,
          v: html`<${Actions}>
            ${ins.link ? html`<${Action} small href=${ins.link.href}>${ins.link.label}<//>` : null}
            ${(ins.scripts || []).map((sc) => html`<${Action} small key=${sc.os} href=${sc.url} download=${sc.filename} title=${sc.note}>${sc.label}<//>`)}
            ${ins.file ? html`<${Action} small soft href=${ins.file.url} download=${ins.file.filename} title=${ins.file.where}>${ins.file.label}<//>` : null}
          <//>`,
          sub: ins.link ? ins.link.note : ins.scripts?.[0] ? ins.scripts[0].note : ins.file.where,
        };
      })} />
      <${Note}>${m('quickHint')}<//>
    <//>`;
}

/** The proof: paste one prompt into the chat, press check, read the answer here. */
function proofBlock(ctx, again) {
  const copy = { copy: ctx.prompt, copiedLabel: t('common.copied') };
  return html`
    <${Space} above=${again ? undefined : 'section'}>
      ${!again && html`<${SubHeading} level=${3}>${m('proofTitle')}<//>`}
      <${Note} kind="lead">${again ? m('proofLeadAgain') : m('proofLead')}<//>
      <${Code} block tall>${ctx.prompt || t('helloMcp.proof.loading')}<//>
      <${Actions}>
        ${again
          ? html`<${Action} small ...${copy}>${t('helloMcp.proof.copy')}<//>`
          : html`<${Loud} ...${copy}>${t('helloMcp.proof.copy')}<//>`}
        <${Action} small disabled=${ctx.checking} onClick=${ctx.check}>${ctx.checking ? t('helloMcp.proof.checking') : t('helloMcp.proof.check')}<//>
      <//>
      ${ctx.proofState === 'fail' ? failList() : html`<${Note}>${m('proofHint')}<//>`}
      <${ManagedEnvNote} compact poster />
    <//>`;
}

/** The failure path, the usual cause first. */
function failList() {
  return html`
    <${Space} above="medium">
      <${Note} kind="aside" size="small" tone="irreversible">
        <b>${t('helloMcp.fail.title')}</b>
        <${IndexList} steps>
          <${IndexStep}>${t('helloMcp.fail.s1')}<//>
          <${IndexStep}>${t('helloMcp.fail.s2')}<//>
          <${IndexStep}>${t('helloMcp.fail.s3')}<//>
          <${IndexStep}>${t('helloMcp.fail.s4')}<//>
          <${IndexStep}>${t('helloMcp.fail.s5')}<//>
        <//>
        <${Note}>${t('helloMcp.fail.retry')}<//>
      <//>
    <//>`;
}
