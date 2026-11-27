/**
 * @file public/views/profile/mcp/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP page in the poster face (design canvas "AIMEAT MCP-sivu", direction A): the
 *   mast and the strip, the AIs connected here as rows (what each may do, when it last spoke, open
 *   it, disconnect it), the connect and instructions sections from their own files, the
 *   suggestions switch, and the rail. Pure render over the ctx bag, made of the component kit: the
 *   page passes data and never a class.
 *   Since 2026-11-27 what is drawn follows the person's situation: with no AI connected the page is
 *   the one way to connect (the connect section, open, numbered 01) and nothing else, no strip and no
 *   head actions; with one connected, 01 is the list of connected AIs (which AI, what it may do, when
 *   it last spoke) under a strip of three figures, and connecting another AI, the instructions and
 *   the suggestions switch are rows that say their state and open in place. A row whose agent was
 *   deleted needs the person: it is counted in the notice tone and comes first in the list.
 * @structure renderPage · secRows · secSuggest
 * @usage import { renderPage } from './mcp/page.js';
 * @version-history
 *   v2.3.1 -- 2026-11-27 -- The strip's word agrees with its number (tn: "1 yhdistetty tekoäly"); the
 *     head's grey subtitle, which repeated section 01's name, is gone.
 *   v2.3.0 -- 2026-11-27 -- Usability pass on the person's three situations: nothing connected draws only
 *     the connect section (no strip of "0 / Not yet / On", no head marks, no competing actions); connected
 *     draws the list first, the strip without the suggestions figure (its state is the suggestions row) and
 *     with a notice figure for rows left behind, which lead the list; mcp-connect (when proven), mcp-instr
 *     and mcp-suggest are fold rows that say their state; sections are numbered after the filter. The head
 *     marks repeated the strip and are gone. No control was removed.
 *   v2.2.0 -- 2026-11-02 -- Connected is Home's rule: the proof, or an AI of the person's own that spoke over
 *     MCP; the place's chat and the basic agents are not listed (crew64 first-timer round, 2.11).
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
import { t, tn } from '/js/i18n.js';
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
  // Connected means what Home's "Connect your AI" means (journey-state.ts): the proof prompt passed,
  // or an AI of the person's own has spoken over MCP. The rows hold only those (frame.js buildRows),
  // so an agent row is enough; before, a real connection read "not verified yet" beside Home's tick.
  const outside = rows.find((r) => r.kind === 'agent') || null;
  const proven = !!ctx.proof?.passed || !!outside;
  const provenAt = ctx.proof?.passed ? ctx.proof.at : outside?.since;
  const on = ctx.proactive ? ctx.proactive.enabled !== false : true;
  const loading = ctx.agents === null;
  // A row whose agent was deleted needs the person (remove it), so it leads the list and has its own
  // figure; the AIs that work are the rest. Stable: within each group the newest-first order stays.
  const gone = rows.filter((r) => r.gone);
  const live = rows.filter((r) => !r.gone);
  const listed = [...gone, ...live];
  const latest = live[0] || null;
  // Connected is the proof or a row: then the page is about what is connected. Before that the page
  // is the one way to connect, and nothing else is drawn beside it.
  const connected = proven || rows.length > 0;

  // No strip while nothing is connected: "0 / Not yet / –" said nothing the connect section does not.
  // The suggestions figure is gone: its state is the suggestions row's own line.
  const strip = loading ? html`<${FigureStrip} loading=${3} />` : !connected ? null : html`<${FigureStrip} items=${[
    { key: 'ais', n: live.length, label: tn('mcppage.stripAis', live.length), sub: live.length ? live.slice(0, 4).map((r) => r.tool).join(', ') : m('stripNone') },
    { key: 'proof', n: proven ? m('stripProven') : m('stripNotYet'), tone: 'coral', label: proven ? m('stripProofOk') : m('stripProofPending'), sub: proven ? m('stripProvenSub', { date: day(provenAt) }) : m('stripNotYetSub') },
    { key: 'last', n: latest ? rel(latest.when) : '–', label: m('stripLast'), sub: latest ? `${latest.tool} · ${latest.name}` : m('stripLastNone') },
    gone.length ? { key: 'gone', n: gone.length, tone: 'notice', label: m('stripGone'), sub: m('stripGoneSub') } : null,
  ]} />`;

  const openConnect = (guide) => {
    if (proven) { ctx.setFold('connect', true); if (guide) ctx.setFold('guide', true); }
    scrollToSection('mcp-connect');
  };
  // One loud action per page: while the connection is unproven, that action is the proof's copy
  // button in the connect section; once proven, connecting another AI. With nothing connected the
  // head carries no action, so nothing competes with the one way in (the Agents page stays in the rail).
  const actions = !connected ? null : html`
    ${proven ? html`<${Loud} onClick=${() => openConnect(false)}>${m('connectDoor')}<//>` : null}
    <${Actions}><${Action} small onClick=${() => goTab('agents')}>${m('agentsDoor')}<//><//>`;

  // What is drawn, numbered after the filter: while loading only the list's place; with nothing
  // connected only the connect section; connected, the list first and the rest as rows.
  const shown = (loading
    ? [{ id: 'mcp-rows', label: m('secRows') }]
    : [
      connected ? { id: 'mcp-rows', label: m('secRows'), count: live.length } : null,
      { id: 'mcp-connect', label: proven ? m('secConnect') : m('secConnectFirst') },
      connected ? { id: 'mcp-instr', label: m('secInstructions') } : null,
      connected ? { id: 'mcp-suggest', label: m('secSuggest'), count: on ? m('on') : m('off') } : null,
    ]).filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));

  return html`
    <${SettingsPage} name="mcp" crumb=${crumb()} title=${t('profile.tabs.mcp')} help="concept.connect"
      desc=${`${m('desc')} ${proven ? m('descProven') : m('descNew')}`} actions=${actions} strip=${strip}
      start=${html`<${PageStart} id="mcp" vars=${{ url: getNodeUrl() + '/v1/mcp' }} done=${ctx.proof || outside ? proven : null}
        action=${{ onClick: () => openConnect(true) }} />`}
      railTitle=${m('railTitle')}
      sections=${shown.length > 1 ? shown : undefined}
      pagesLabel=${m('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${numOf['mcp-rows'] ? secRows(ctx, listed, live.length, numOf['mcp-rows']) : null}
      ${numOf['mcp-connect'] ? secConnect(ctx, proven, provenAt, numOf['mcp-connect'], !numOf['mcp-rows']) : null}
      ${numOf['mcp-instr'] ? secInstructions(ctx, numOf['mcp-instr']) : null}
      ${numOf['mcp-suggest'] ? secSuggest(ctx, on, numOf['mcp-suggest']) : null}
    <//>`;
}

function secRows(ctx, rows, count, n) {
  return html`
    <${Section} id="mcp-rows" num=${n} title=${m('secRows')} count=${ctx.agents === null ? '' : count} first
      doors=${html`<${Action} small soft onClick=${() => goTab('agents')}>${m('allAgents')}<//>`}>
      <${List} cols="mark-name-who-when-doors" keepCols loading=${ctx.agents === null ? t('common.loading') : false}
        head=${['', m('colAi'), m('colMay'), m('colWhen'), '']}
        empty=${html`<${Note} kind="quiet"><b>${m('emptyRowsHead')}</b> ${m('emptyRows')}<//>`}
        rows=${rows} render=${(r) => {
          const may = r.agent ? mayWord(r.agent) : null;
          return html`
            <${Row} key=${r.id}>
              <${Lead} text=${r.gone ? '?' : initials(r.tool)} agent=${r.kind === 'tool' && r.gone} />
              <${Name} attention=${!!r.gone} meta=${r.name || m('agentNone')}>${r.tool}<//>
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
      ${rows.length ? html`<${Note}>${m('rowsHint')}<//>` : null}
    <//>`;
}

/** The suggestions switch: one row that says On or Off, the switch and its words inside. */
function secSuggest(ctx, on, n) {
  const p = ctx.proactive;
  const operatorOff = p?.available_here === false;
  return html`
    <${Section} fold id="mcp-suggest" num=${n} title=${m('secSuggest')} sub=${operatorOff || !on ? m('off') : m('on')}
      open=${ctx.folds.suggest} onToggle=${() => ctx.setFold('suggest', !ctx.folds.suggest)}>
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
