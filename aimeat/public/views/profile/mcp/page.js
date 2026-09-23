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
 *   2026-09-22 -- Composed from the shared component set: Page, Rail, NumeralBand strip, ListRow
 *     for a connected AI (its initials a Chip), the suggestions switch a pressed toggle Action;
 *     no own CSS. The table's column heads are gone: each row says what it is in its own words.
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-02 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Stack, ListRow, NumeralBand, Action, Chip, Text } from '/components/poster-parts.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { m, rel, day, initials, mayWord, crumb, pageLinks, goTab } from './frame.js';
import { secConnect } from './connect.js';
import { secInstructions } from './instructions.js';

export function renderPage(ctx) {
  const rows = ctx.rows;
  const proven = !!ctx.proof?.passed;
  const latest = rows[0] || null;
  const on = ctx.proactive ? ctx.proactive.enabled !== false : true;

  const strip = html`<${NumeralBand} tone="plain" items=${[
    { label: m('stripAis'), value: rows.length, note: rows.length ? rows.slice(0, 4).map((r) => r.tool).join(', ') : m('stripNone') },
    { label: proven ? m('stripProofOk') : m('stripProofPending'), value: proven ? m('stripProven') : m('stripNotYet'), note: proven ? m('stripProvenSub', { date: day(ctx.proof.at) }) : m('stripNotYetSub'), tone: 'coral' },
    { label: m('stripLast'), value: latest ? rel(latest.when) : '–', note: latest ? `${latest.tool} · ${latest.name}` : m('stripLastNone') },
    { label: m('stripSuggest'), value: on ? m('on') : m('off'), tone: 'coral',
      note: ctx.proactive?.available_here === false ? m('stripSuggestOperator') : ctx.proactive?.set_by === 'ai' ? m('stripSuggestByAi') : ctx.proactive?.set_by === 'person' ? m('stripSuggestByYou') : m('stripSuggestDefault') },
  ]} />`;

  const identity = html`<${Stack} density="compact">
    <${Text} kind="label">${m('titleSub')}<//>
    <${Stack} direction="wrap" density="compact">
      ${rows.length ? html`<${Chip}>${m('chipCount', { n: rows.length })}<//>` : html`<${Chip} tone="sun">${m('chipNone')}<//>`}
      ${proven ? html`<${Chip} tone="sun">${m('chipProven', { date: day(ctx.proof.at) })}<//>` : html`<${Chip} tone="sun">${m('chipUnproven')}<//>`}
      <${Chip} tone="muted">${on ? m('chipSuggestOn') : m('chipSuggestOff')}<//>
    <//>
  <//>`;
  // One loud action per page: while the connection is unproven, that action is the proof's copy button in the connect section.
  const actions = html`${proven ? html`<${Action} kind="primary" onClick=${() => scrollTo('mcp-connect')}>${m('connectDoor')}<//>` : null}
    <${Action} onClick=${() => goTab('agents')}>${m('agentsDoor')}<//>`;
  const rail = html`<${Rail} kind="index" title=${m('railTitle')} entries=${[
    { href: '#mcp-rows', label: m('secRows'), count: rows.length },
    { href: '#mcp-connect', label: m('secConnect') },
    { href: '#mcp-instr', label: m('secInstructions') },
    { href: '#mcp-suggest', label: m('secSuggest'), count: on ? m('on') : m('off') },
  ]}>${pageLinks()}<//>`;

  return html`<${Page} width="wide" title=${t('profile.tabs.mcp')} crumbs=${crumb()} identity=${identity} actions=${actions} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${m('desc')} ${proven ? m('descProven') : m('descNew')}<//>
      ${strip}
      ${secRows(ctx, rows)}
      ${secConnect(ctx, proven)}
      ${secInstructions(ctx)}
      ${secSuggest(ctx, on)}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

function secRows(ctx, rows) {
  return html`
    <${Section} id="mcp-rows" title=${m('secRows')} count=${rows.length}
      actions=${html`<${Action} onClick=${() => goTab('agents')}>${m('allAgents')}<//>`}>
      <${Stack}>
        ${ctx.agents === null ? html`<${Text} tone="muted">${t('common.loading')}<//>`
          : !rows.length ? html`<${Text}><strong>${m('emptyRowsHead')}</strong> ${m('emptyRows')}<//>` : html`<${Stack} density="compact">
          ${rows.map((r) => {
            const may = r.agent ? mayWord(r.agent) : null;
            return html`<${ListRow} key=${r.id}
              mark=${html`<${Chip} tone=${r.kind === 'tool' && r.gone ? 'muted' : 'plain'}>${r.gone ? '?' : initials(r.tool)}<//>`}
              name=${r.tool} detail=${`${r.name || m('agentNone')} · ${r.when ? rel(r.when) : m('neverUsed')} · ${m('since', { date: day(r.since) })}`}
              value=${may ? html`<${Stack} density="compact"><${Text} kind="label" tone=${may.full ? 'coral' : 'plain'}>${may.word}<//><${Text} kind="caption">${may.note}<//><//>`
                : html`<${Stack} density="compact"><${Text} kind="label">${m('agentGone')}<//><${Text} kind="caption">${m('agentGoneNote')}<//><//>`}
              actions=${html`${r.agent ? html`<${Action} onClick=${() => ctx.openAgent(r)}>${m('open')}<//>` : null}
                <${Action} disabled=${ctx.busy === r.id} onClick=${() => ctx.disconnect(r)}>${r.gone ? m('removeRow') : m('disconnect')}<//>`} />`;
          })}
        <//>`}
        <${Text} kind="caption" tone="muted">${m('rowsHint')}<//>
      <//>
    <//>`;
}

function secSuggest(ctx, on) {
  const p = ctx.proactive;
  const operatorOff = p?.available_here === false;
  return html`
    <${Section} id="mcp-suggest" title=${m('secSuggest')}>
      <${Stack} direction="horizontal" align="between">
        <${Stack} density="compact">
          <${Text}><strong>${m('suggestTitle')}</strong><//>
          <${Text}>${m('suggestDesc')}${p?.set_by === 'ai' ? html` <${Text} kind="caption" tone="coral">${t('profile.mcp.proactiveSetByAi')}<//>` : null}<//>
          ${operatorOff ? html`<${Text} kind="caption" tone="coral">${t('profile.mcp.proactiveOperatorOff')}<//>` : null}
        <//>
        ${operatorOff || !p ? null : html`<${Action} kind="tab" selected=${on} label=${m('suggestTitle')} onClick=${() => ctx.setProactiveEnabled(!on)}>${on ? m('on') : m('off')}<//>`}
      <//>
    <//>`;
}
