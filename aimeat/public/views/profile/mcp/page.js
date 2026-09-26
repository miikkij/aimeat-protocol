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
 *   v1.14.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-26 -- A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-26 -- The mark of a sender that is not a person is the avatar's agent tone (.poster-box--agent, css/poster.css), a unification: the look Contacts, Notifications, Email and MCP drew alike.
 *   v1.9.0 -- 2026-09-25 -- The connected AIs are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- A setting that is on or off is the library's Switch (components/Switch.js), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-02 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { m, rel, day, initials, mayWord, crumb, pageLinks, goTab } from './frame.js';
import { secConnect } from './connect.js';
import { secInstructions } from './instructions.js';
import { Hint } from '/components/Hint.js';
import { Switch } from '/components/Switch.js';

export function renderPage(ctx) {
  const rows = ctx.rows;
  const proven = !!ctx.proof?.passed;
  const latest = rows[0] || null;
  const on = ctx.proactive ? ctx.proactive.enabled !== false : true;
  const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;

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
          <h1 class="og-title poster-page-title">${t('profile.tabs.mcp')}<small>${m('titleSub')}</small></h1>
          <div class="poster-chips">
            ${rows.length ? chip(m('chipCount', { n: rows.length })) : chip(m('chipNone'), 'poster-chip--coral')}
            ${proven ? chip(m('chipProven', { date: day(ctx.proof.at) }), 'poster-chip--sun') : chip(m('chipUnproven'), 'poster-chip--coral')}
            ${chip(on ? m('chipSuggestOn') : m('chipSuggestOff'))}
          </div>
          <p class="og-desc">${m('desc')} ${proven ? m('descProven') : m('descNew')}</p>
        </div>
        <div class="og-mast-actions">
          ${/* One loud action per page: while the connection is unproven, that action is the proof's copy button in section 02. */''}
          ${proven ? html`<button type="button" class="poster-slab" onClick=${() => scrollTo('mcp-connect')}>${m('connectDoor')}</button>` : null}
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => goTab('agents')}>${m('agentsDoor')}</button></div>
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
    <${PageSection} id="mcp-rows" num="01" title=${m('secRows')} count=${rows.length} first
      doors=${html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => goTab('agents')}>${m('allAgents')}</button>`}>
      ${ctx.agents === null ? html`<p class="poster-quiet loading-mark">${t('common.loading')}</p>`
        : !rows.length ? html`<p class="poster-quiet mc-empty"><b>${m('emptyRowsHead')}</b> ${m('emptyRows')}</p>` : html`
        <div class="listing listing--cols listing--mark-name-who-when-doors">
          <div class="listing-row listing-row--head"><div class="poster-label" aria-hidden="true"></div><div class="poster-label">${m('colAi')}</div><div class="poster-label">${m('colMay')}</div><div class="poster-label">${m('colWhen')}</div><div class="poster-label"></div></div>
          ${rows.map((r) => {
            const may = r.agent ? mayWord(r.agent) : null;
            return html`
            <div class="listing-row" key=${r.id}>
              <div><div class=${`mc-av poster-box poster-box--avatar poster-box--small ${r.kind === 'tool' && r.gone ? 'poster-box--agent' : ''}`} aria-hidden="true">${r.gone ? '?' : initials(r.tool)}</div></div>
              <div class="listing-name">${r.tool}<small>${r.name || m('agentNone')}</small></div>
              <div class="listing-who">${may ? html`<b class=${may.full ? 'mc-coral' : ''}>${may.word}</b><small>${may.note}</small>` : html`<b>${m('agentGone')}</b><small>${m('agentGoneNote')}</small>`}</div>
              <div class="listing-who"><b>${r.when ? rel(r.when) : m('neverUsed')}</b><small>${m('since', { date: day(r.since) })}</small></div>
              <div class="listing-doors">
                ${r.agent ? html`<button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.openAgent(r)}>${m('open')}</button>` : null}
                <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${ctx.busy === r.id} onClick=${() => ctx.disconnect(r)}>${r.gone ? m('removeRow') : m('disconnect')}</button>
              </div>
            </div>`;
          })}
        </div>`}
      <${Hint}>${m('rowsHint')}<//>
    <//>`;
}

function secSuggest(ctx, on) {
  const p = ctx.proactive;
  const operatorOff = p?.available_here === false;
  return html`
    <${PageSection} id="mcp-suggest" num="04" title=${m('secSuggest')} count=${null}>
      <div class="mc-setting">
        <div class="mc-setting-words">
          <b class="sub-heading">${m('suggestTitle')}</b>
          <p class="poster-hint">${m('suggestDesc')}${p?.set_by === 'ai' ? html` <span class="mc-by">${t('profile.mcp.proactiveSetByAi')}</span>` : null}</p>
          ${operatorOff ? html`<p class="poster-hint mc-by">${t('profile.mcp.proactiveOperatorOff')}</p>` : null}
        </div>
        ${operatorOff || !p ? null : html`<${Switch} on=${on} ariaLabel=${m('suggestTitle')} onToggle=${() => ctx.setProactiveEnabled(!on)} />`}
      </div>
    <//>`;
}
