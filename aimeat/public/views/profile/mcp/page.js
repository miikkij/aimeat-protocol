/**
 * @file public/views/profile/mcp/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP page in the poster face (design canvas "AIMEAT MCP-sivu", direction A): the
 *   mast and the strip, the AIs connected here as rows (what each may do, when it last spoke, open
 *   it, disconnect it), the connect and instructions sections from their own files, the
 *   suggestions switch, and the rail. Pure render over the ctx bag.
 * @structure renderPage · secRows · secSuggest
 * @usage import { renderPage } from './mcp/page.js';
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { m, rel, day, initials, mayWord, crumb, pageLinks, goTab } from './frame.js';
import { secConnect } from './connect.js';
import { secInstructions } from './instructions.js';

export function renderPage(ctx) {
  const rows = ctx.rows;
  const proven = !!ctx.proof?.passed;
  const latest = rows[0] || null;
  const on = ctx.proactive ? ctx.proactive.enabled !== false : true;
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;

  const strip = html`
    <div class="og-strip">
      <div><b>${rows.length}</b><span>${m('stripAis')}</span><small>${rows.length ? rows.slice(0, 4).map((r) => r.tool).join(', ') : m('stripNone')}</small></div>
      <div><b class="og-strip-coral">${proven ? m('stripProven') : m('stripNotYet')}</b><span>${proven ? m('stripProofOk') : m('stripProofPending')}</span><small>${proven ? m('stripProvenSub', { date: day(ctx.proof.at) }) : m('stripNotYetSub')}</small></div>
      <div><b>${latest ? rel(latest.when) : '–'}</b><span>${m('stripLast')}</span><small>${latest ? `${latest.tool} · ${latest.name}` : m('stripLastNone')}</small></div>
      <div><b class="og-strip-coral">${on ? m('on') : m('off')}</b><span>${m('stripSuggest')}</span><small>${ctx.proactive?.available_here === false ? m('stripSuggestOperator') : ctx.proactive?.set_by === 'ai' ? m('stripSuggestByAi') : ctx.proactive?.set_by === 'person' ? m('stripSuggestByYou') : m('stripSuggestDefault')}</small></div>
    </div>`;

  return html`
    <div class="og og-mcp">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${t('profile.tabs.mcp')}<small>${m('titleSub')}</small></h1>
          <div class="og-chips">
            ${rows.length ? chip(m('chipCount', { n: rows.length })) : chip(m('chipNone'), 'og-chip--coral')}
            ${proven ? chip(m('chipProven', { date: day(ctx.proof.at) }), 'og-chip--sun') : chip(m('chipUnproven'), 'og-chip--coral')}
            ${chip(on ? m('chipSuggestOn') : m('chipSuggestOff'), 'og-chip--dim')}
          </div>
          <p class="og-desc">${m('desc')} ${proven ? m('descProven') : m('descNew')}</p>
        </div>
        <div class="og-mast-actions">
          ${/* One loud action per page: while the connection is unproven, that action is the proof's copy button in section 02. */''}
          ${proven ? html`<button type="button" class="og-slab" onClick=${() => scrollTo('mcp-connect')}>${m('connectDoor')}</button>` : null}
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => goTab('agents')}>${m('agentsDoor')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secRows(ctx, rows)}
          ${secConnect(ctx, proven)}
          ${secInstructions(ctx)}
          ${secSuggest(ctx, on)}
        </div>
        <nav class="og-rail" aria-label=${m('railTitle')}>
          <span class="og-rail-label">${m('railTitle')}</span>
          ${[['01', 'mcp-rows', m('secRows'), rows.length], ['02', 'mcp-connect', m('secConnect'), ''], ['03', 'mcp-instr', m('secInstructions'), ''], ['04', 'mcp-suggest', m('secSuggest'), on ? m('on') : m('off')]]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${m('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function secRows(ctx, rows) {
  return html`
    <${Section} id="mcp-rows" num="01" title=${m('secRows')} count=${rows.length} first
      doors=${html`<button type="button" class="og-door og-door--quiet" onClick=${() => goTab('agents')}>${m('allAgents')}</button>`}>
      ${ctx.agents === null ? html`<p class="og-empty">${t('common.loading')}</p>`
        : !rows.length ? html`<p class="mc-empty"><b>${m('emptyRowsHead')}</b> ${m('emptyRows')}</p>` : html`
        <div class="mc-rows">
          <div class="mc-head" aria-hidden="true"></div><div class="mc-head">${m('colAi')}</div><div class="mc-head">${m('colMay')}</div><div class="mc-head">${m('colWhen')}</div><div class="mc-head"></div>
          ${rows.map((r) => {
            const may = r.agent ? mayWord(r.agent) : null;
            return html`
            <div class=${`mc-av ${r.kind === 'tool' && r.gone ? 'mc-av--dash' : ''}`} key=${'a' + r.id} aria-hidden="true">${r.gone ? '?' : initials(r.tool)}</div>
            <div class="mc-nm" key=${'n' + r.id}>${r.tool}<small>${r.name || m('agentNone')}</small></div>
            <div class="mc-w" key=${'m' + r.id}>${may ? html`<b class=${may.full ? 'mc-coral' : ''}>${may.word}</b><small>${may.note}</small>` : html`<b>${m('agentGone')}</b><small>${m('agentGoneNote')}</small>`}</div>
            <div class="mc-w" key=${'w' + r.id}><b>${r.when ? rel(r.when) : m('neverUsed')}</b><small>${m('since', { date: day(r.since) })}</small></div>
            <div class="mc-ctl" key=${'d' + r.id}>
              ${r.agent ? html`<button type="button" class="og-door" onClick=${() => ctx.openAgent(r)}>${m('open')}</button>` : null}
              <button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === r.id} onClick=${() => ctx.disconnect(r)}>${r.gone ? m('removeRow') : m('disconnect')}</button>
            </div>`;
          })}
        </div>`}
      <p class="mc-hint">${m('rowsHint')}</p>
    <//>`;
}

function secSuggest(ctx, on) {
  const p = ctx.proactive;
  const operatorOff = p?.available_here === false;
  return html`
    <${Section} id="mcp-suggest" num="04" title=${m('secSuggest')} count=${null}>
      <div class="mc-setting">
        <div class="mc-setting-words">
          <b>${m('suggestTitle')}</b>
          <p>${m('suggestDesc')}${p?.set_by === 'ai' ? html` <span class="mc-by">${t('profile.mcp.proactiveSetByAi')}</span>` : null}</p>
          ${operatorOff ? html`<p class="mc-by">${t('profile.mcp.proactiveOperatorOff')}</p>` : null}
        </div>
        ${operatorOff || !p ? null : html`
          <button type="button" role="switch" aria-checked=${on ? 'true' : 'false'} aria-label=${m('suggestTitle')}
            class=${`mc-switch ${on ? 'on' : ''}`} onClick=${() => ctx.setProactiveEnabled(!on)}><i></i></button>`}
      </div>
    <//>`;
}
