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
 *   v1.0.0 — 2026-09-02 — Initial (design canvas "AIMEAT MCP-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold } from '/views/profile/organisms/poster-parts.js';
import { CopyButton } from '/components/CopyButton.js';
import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
import { McpSetupGuide } from '/views/profile/ai-setup-guide.js';
import { m, day } from './frame.js';

export function secConnect(ctx, proven) {
  const toolCount = Array.isArray(ctx.tools) ? ctx.tools.length : null;
  return html`
    <${Section} id="mcp-connect" num="02" title=${proven ? m('secConnect') : m('secConnectFirst')} count=${toolCount ? m('toolCount', { n: toolCount }) : null}>
      ${proven ? html`
        <p class="mc-lead">${m('connectLeadProven')}</p>
        ${quickWays(ctx)}
        <div class="og-folds">
          <${Fold} id="mcp-guide" num="·" title=${m('guideFold')} sub=${m('guideFoldSub')} open=${ctx.folds.guide} onToggle=${() => ctx.setFold('guide', !ctx.folds.guide)}>
            <${McpSetupGuide} />
          <//>
          <${Fold} id="mcp-proof" num="·" title=${m('proofFold')} sub=${m('proofFoldSub', { date: day(ctx.proof?.at) })} open=${ctx.folds.proof} onToggle=${() => ctx.setFold('proof', !ctx.folds.proof)}>
            ${proofBlock(ctx, true)}
          <//>
        </div>` : html`
        <p class="mc-lead">${m('connectLeadNew')}</p>
        <${McpSetupGuide} />
        <div class="mc-pre">
          <span class="mc-pre-label">${m('preTitle')}</span>
          <p>${m('preAddress')}</p>
          <p>${m('preManaged')}</p>
          <p>${m('preTime')}</p>
        </div>
        ${quickWays(ctx)}
        <h3 class="mc-h3">${m('proofTitle')}</h3>
        ${proofBlock(ctx, false)}`}
    <//>`;
}

/** Every tool that can be attached without walking its settings menu, from the tool table. */
function quickWays(ctx) {
  const tools = (ctx.tools || []).filter((tool) => tool?.mcp?.install && (tool.mcp.install.link || tool.mcp.install.scripts?.length || tool.mcp.install.file));
  if (!tools.length) return null;
  return html`
    <div class="mc-quick">
      <span class="og-label">${m('quickTitle')}</span>
      <div class="mc-quick-grid">
        ${tools.map((tool) => {
          const ins = tool.mcp.install;
          return html`
            <div class="mc-quick-k" key=${'k' + tool.id}>${tool.label}</div>
            <div class="mc-quick-v" key=${'v' + tool.id}>
              <div class="og-doors">
                ${ins.link ? html`<a class="og-door" href=${ins.link.href}>${ins.link.label}</a>` : null}
                ${(ins.scripts || []).map((sc) => html`<a class="og-door" key=${sc.os} href=${sc.url} download=${sc.filename} title=${sc.note}>${sc.label}</a>`)}
                ${ins.file ? html`<a class="og-door og-door--quiet" href=${ins.file.url} download=${ins.file.filename} title=${ins.file.where}>${ins.file.label}</a>` : null}
              </div>
              <small>${ins.link ? ins.link.note : ins.scripts?.[0] ? ins.scripts[0].note : ins.file.where}</small>
            </div>`;
        })}
      </div>
      <p class="mc-hint">${m('quickHint')}</p>
    </div>`;
}

/** The proof: paste one prompt into the chat, press check, read the answer here. */
function proofBlock(ctx, again) {
  return html`
    <div class="mc-proof">
      <p>${again ? m('proofLeadAgain') : m('proofLead')}</p>
      <pre class="mc-code">${ctx.prompt || t('helloMcp.proof.loading')}</pre>
      <div class="og-doors mc-proof-doors">
        <${CopyButton} text=${ctx.prompt} className=${again ? 'og-door' : 'og-slab'} label=${t('helloMcp.proof.copy')} copiedLabel=${t('common.copied')} />
        <button type="button" class="og-door" disabled=${ctx.checking} onClick=${ctx.check}>${ctx.checking ? t('helloMcp.proof.checking') : t('helloMcp.proof.check')}</button>
      </div>
      ${ctx.proofState === 'fail' ? failList() : html`<p class="mc-hint">${m('proofHint')}</p>`}
      <${ManagedEnvNote} compact=${true} />
    </div>`;
}

/** The failure path, the usual cause first. */
function failList() {
  return html`
    <div class="mc-fail">
      <b>${t('helloMcp.fail.title')}</b>
      <ol>
        <li>${t('helloMcp.fail.s1')}</li>
        <li>${t('helloMcp.fail.s2')}</li>
        <li>${t('helloMcp.fail.s3')}</li>
        <li>${t('helloMcp.fail.s4')}</li>
        <li>${t('helloMcp.fail.s5')}</li>
      </ol>
      <p class="mc-hint">${t('helloMcp.fail.retry')}</p>
    </div>`;
}
