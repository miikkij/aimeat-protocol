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
 *   2026-09-22 -- Composed from the shared component set: the proof prompt is a code Surface with a
 *     CopyAction, the before-you-start note an aside, the short ways KeyValue rows, the failure path
 *     Steps; no own CSS. The setup guide is the shared one and takes no class any more.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   2026-09-13 -- V2aa: compose the proof section headline with the shared B1 class.
 *   v1.0.0 — 2026-09-02 — Initial (design canvas "AIMEAT MCP-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, Stack, Surface, KeyValue, Steps, Action, CopyAction, Text } from '/components/poster-parts.js';
import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
import { McpSetupGuide } from '/views/profile/ai-setup-guide.js';
import { m, day } from './frame.js';

export function secConnect(ctx, proven) {
  const toolCount = Array.isArray(ctx.tools) ? ctx.tools.length : null;
  return html`
    <${Section} id="mcp-connect" title=${proven ? m('secConnect') : m('secConnectFirst')} count=${toolCount ? m('toolCount', { n: toolCount }) : null}>
      ${proven ? html`<${Stack}>
        <${Text} kind="lead">${m('connectLeadProven')}<//>
        ${quickWays(ctx)}
        <${Stack} density="compact">
          <${Fold} id="mcp-guide" number="·" title=${m('guideFold')} sub=${m('guideFoldSub')} open=${ctx.folds.guide} onToggle=${() => ctx.setFold('guide', !ctx.folds.guide)}>
            <${McpSetupGuide} />
          <//>
          <${Fold} id="mcp-proof" number="·" title=${m('proofFold')} sub=${m('proofFoldSub', { date: day(ctx.proof?.at) })} open=${ctx.folds.proof} onToggle=${() => ctx.setFold('proof', !ctx.folds.proof)}>
            ${proofBlock(ctx, true)}
          <//>
        <//>
      <//>` : html`<${Stack}>
        <${Text} kind="lead">${m('connectLeadNew')}<//>
        <${McpSetupGuide} />
        <${Surface} kind="aside"><${Stack} density="compact">
          <${Text} kind="label">${m('preTitle')}<//>
          <${Text}>${m('preAddress')}<//>
          <${Text}>${m('preManaged')}<//>
          <${Text}>${m('preTime')}<//>
        <//><//>
        ${quickWays(ctx)}
        ${proofBlock(ctx, false)}
      <//>`}
    <//>`;
}

/** Every tool that can be attached without walking its settings menu, from the tool table. */
function quickWays(ctx) {
  const tools = (ctx.tools || []).filter((tool) => tool?.mcp?.install && (tool.mcp.install.link || tool.mcp.install.scripts?.length || tool.mcp.install.file));
  if (!tools.length) return null;
  return html`<${Stack} density="compact">
    <${Text} kind="label">${m('quickTitle')}<//>
    ${tools.map((tool) => {
      const ins = tool.mcp.install;
      return html`<${KeyValue} key=${tool.id} label=${tool.label} value=${html`<${Stack} density="compact">
        <${Stack} direction="wrap" density="compact">
          ${ins.link ? html`<${Action} href=${ins.link.href}>${ins.link.label}<//>` : null}
          ${(ins.scripts || []).map((sc) => html`<${Action} key=${sc.os} href=${sc.url} download=${sc.filename} title=${sc.note}>${sc.label}<//>`)}
          ${ins.file ? html`<${Action} href=${ins.file.url} download=${ins.file.filename} title=${ins.file.where}>${ins.file.label}<//>` : null}
        <//>
        <${Text} kind="caption" tone="muted">${ins.link ? ins.link.note : ins.scripts?.[0] ? ins.scripts[0].note : ins.file.where}<//>
      <//>`} />`;
    })}
    <${Text} kind="caption" tone="muted">${m('quickHint')}<//>
  <//>`;
}

/** The proof: paste one prompt into the chat, press check, read the answer here. */
function proofBlock(ctx, again) {
  return html`<${Stack}>
    ${!again && html`<${Text} kind="heading">${m('proofTitle')}<//>`}
    <${Text}>${again ? m('proofLeadAgain') : m('proofLead')}<//>
    <${Surface} kind="code">${ctx.prompt || t('helloMcp.proof.loading')}<//>
    <${Stack} direction="wrap" align="center">
      <${CopyAction} text=${ctx.prompt} kind=${again ? 'secondary' : 'primary'} label=${t('helloMcp.proof.copy')} copiedLabel=${t('common.copied')} />
      <${Action} disabled=${ctx.checking} onClick=${ctx.check}>${ctx.checking ? t('helloMcp.proof.checking') : t('helloMcp.proof.check')}<//>
    <//>
    ${ctx.proofState === 'fail' ? failList() : html`<${Text} kind="caption" tone="muted">${m('proofHint')}<//>`}
    <${ManagedEnvNote} compact=${true} />
  <//>`;
}

/** The failure path, the usual cause first. */
function failList() {
  return html`<${Surface} kind="aside"><${Stack} density="compact">
    <${Text} kind="label">${t('helloMcp.fail.title')}<//>
    <${Steps} items=${[t('helloMcp.fail.s1'), t('helloMcp.fail.s2'), t('helloMcp.fail.s3'), t('helloMcp.fail.s4'), t('helloMcp.fail.s5')]} />
    <${Text} kind="caption" tone="muted">${t('helloMcp.fail.retry')}<//>
  <//><//>`;
}
