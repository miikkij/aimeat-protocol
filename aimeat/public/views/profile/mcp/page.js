/**
 * @file public/views/profile/mcp/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP page in the poster face (design canvas "AIMEAT MCP-sivu", direction A): the
 *   mast and the strip, the AIs connected here as rows (what each may do, when it last spoke, open
 *   it, disconnect it), the connect and instructions sections from their own files, the
 *   suggestions switch, and the rail. Pure render over the ctx bag, made of the component kit: the
 *   page passes data and never a class.
 * @structure renderPage · secRows · secSuggest
 * @usage import { renderPage } from './mcp/page.js';
 * @version-history
 *   v2.1.0 -- 2026-10-03 -- The page's start (components/PageStart.js: the first prompt names this server's MCP address, its button opens the connect steps) and the title's question mark, concept.connect (guidance part B).
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): the frame
 *     is SettingsPage (crumb, head, marks, strip, rail as data), the strip FigureStrip, the connected
 *     AIs the List (the mark the Avatar through Lead, the coral word of an AI that may do everything
 *     a Tinted notice word), the actions Action/Loud, the hints and empty lines Note, the suggestions
 *     setting a Row of the Sub-heading with its hint beside the Switch. The page writes no class.
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
import { SettingsPage } from '/components/SettingsPage.js';
import { PageStart } from '/components/PageStart.js';
import { getNodeUrl } from '/js/services/auth.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tinted } from '/components/Figure.js';
import { List, Row, Name, Who, Doors, Lead } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Row as Line, Stack } from '/components/Layout.js';
import { Switch } from '/components/Switch.js';
import { scrollToSection } from '/components/Rail.js';
import { m, rel, day, initials, mayWord, crumb, pageLinks, goTab } from './frame.js';
import { secConnect } from './connect.js';
import { secInstructions } from './instructions.js';

export function renderPage(ctx) {
  const rows = ctx.rows;
  const proven = !!ctx.proof?.passed;
  const latest = rows[0] || null;
  const on = ctx.proactive ? ctx.proactive.enabled !== false : true;
  const p = ctx.proactive;

  const strip = html`<${FigureStrip} items=${[
    { key: 'ais', n: rows.length, label: m('stripAis'), sub: rows.length ? rows.slice(0, 4).map((r) => r.tool).join(', ') : m('stripNone') },
    { key: 'proof', n: proven ? m('stripProven') : m('stripNotYet'), tone: 'coral', label: proven ? m('stripProofOk') : m('stripProofPending'), sub: proven ? m('stripProvenSub', { date: day(ctx.proof.at) }) : m('stripNotYetSub') },
    { key: 'last', n: latest ? rel(latest.when) : '–', label: m('stripLast'), sub: latest ? `${latest.tool} · ${latest.name}` : m('stripLastNone') },
    { key: 'suggest', n: on ? m('on') : m('off'), tone: 'coral', label: m('stripSuggest'), sub: p?.available_here === false ? m('stripSuggestOperator') : p?.set_by === 'ai' ? m('stripSuggestByAi') : p?.set_by === 'person' ? m('stripSuggestByYou') : m('stripSuggestDefault') },
  ]} />`;

  const marks = [
    rows.length ? { label: m('chipCount', { n: rows.length }) } : { label: m('chipNone'), tone: 'coral' },
    proven ? { label: m('chipProven', { date: day(ctx.proof.at) }), tone: 'sun' } : { label: m('chipUnproven'), tone: 'coral' },
    { label: on ? m('chipSuggestOn') : m('chipSuggestOff') },
  ];

  // One loud action per page: while the connection is unproven, that action is the proof's copy button in section 02.
  const actions = html`
    ${proven ? html`<${Loud} onClick=${() => scrollToSection('mcp-connect')}>${m('connectDoor')}<//>` : null}
    <${Actions}><${Action} small onClick=${() => goTab('agents')}>${m('agentsDoor')}<//><//>`;

  return html`
    <${SettingsPage} name="mcp" crumb=${crumb()} title=${t('profile.tabs.mcp')} sub=${m('titleSub')} help="concept.connect" marks=${marks}
      desc=${`${m('desc')} ${proven ? m('descProven') : m('descNew')}`} actions=${actions} strip=${strip}
      start=${html`<${PageStart} id="mcp" vars=${{ url: getNodeUrl() + '/v1/mcp' }} done=${ctx.proof ? proven : null}
        action=${{ onClick: () => { if (proven) ctx.setFold('guide', true); scrollToSection('mcp-connect'); } }} />`}
      railTitle=${m('railTitle')}
      sections=${[
        { id: 'mcp-rows', num: '01', label: m('secRows'), count: rows.length },
        { id: 'mcp-connect', num: '02', label: m('secConnect'), count: '' },
        { id: 'mcp-instr', num: '03', label: m('secInstructions'), count: '' },
        { id: 'mcp-suggest', num: '04', label: m('secSuggest'), count: on ? m('on') : m('off') },
      ]}
      pagesLabel=${m('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secRows(ctx, rows)}
      ${secConnect(ctx, proven)}
      ${secInstructions(ctx)}
      ${secSuggest(ctx, on)}
    <//>`;
}

function secRows(ctx, rows) {
  return html`
    <${Section} id="mcp-rows" num="01" title=${m('secRows')} count=${rows.length} first
      doors=${html`<${Action} small soft onClick=${() => goTab('agents')}>${m('allAgents')}<//>`}>
      <${List} cols="mark-name-who-when-doors" keepCols loading=${ctx.agents === null ? t('common.loading') : false}
        head=${['', m('colAi'), m('colMay'), m('colWhen'), '']}
        empty=${html`<${Note} kind="quiet"><b>${m('emptyRowsHead')}</b> ${m('emptyRows')}<//>`}
        rows=${rows} render=${(r) => {
          const may = r.agent ? mayWord(r.agent) : null;
          return html`
            <${Row} key=${r.id}>
              <${Lead} text=${r.gone ? '?' : initials(r.tool)} agent=${r.kind === 'tool' && r.gone} />
              <${Name} meta=${r.name || m('agentNone')}>${r.tool}<//>
              ${may
                ? html`<${Who} sub=${may.note}>${may.full ? html`<${Tinted} strong tone="notice">${may.word}<//>` : html`<b>${may.word}</b>`}<//>`
                : html`<${Who} sub=${m('agentGoneNote')}><b>${m('agentGone')}</b><//>`}
              <${Who} sub=${m('since', { date: day(r.since) })}><b>${r.when ? rel(r.when) : m('neverUsed')}</b><//>
              <${Doors}>
                ${r.agent ? html`<${Action} small row onClick=${() => ctx.openAgent(r)}>${m('open')}<//>` : null}
                <${Action} small row soft disabled=${ctx.busy === r.id} onClick=${() => ctx.disconnect(r)}>${r.gone ? m('removeRow') : m('disconnect')}<//>
              <//>
            <//>`;
        }} />
      <${Note}>${m('rowsHint')}<//>
    <//>`;
}

function secSuggest(ctx, on) {
  const p = ctx.proactive;
  const operatorOff = p?.available_here === false;
  return html`
    <${Section} id="mcp-suggest" num="04" title=${m('secSuggest')} count=${null}>
      <${Line} gap="section" align="start" justify="between" wrap>
        <${Stack} gap="none">
          <${SubHeading}>${m('suggestTitle')}<//>
          <${Note}>${m('suggestDesc')}${p?.set_by === 'ai' ? html` <${Tinted} tone="notice">${t('profile.mcp.proactiveSetByAi')}<//>` : null}<//>
          ${operatorOff ? html`<${Note}><${Tinted} tone="notice">${t('profile.mcp.proactiveOperatorOff')}<//><//>` : null}
        <//>
        ${operatorOff || !p ? null : html`<${Switch} on=${on} ariaLabel=${m('suggestTitle')} onToggle=${() => ctx.setProactiveEnabled(!on)} />`}
      <//>
    <//>`;
}
