/**
 * @file public/views/profile/skills/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Skills page in the poster face: the owner's shelf of expertise. The mast and the
 *   strip; three shelves as rows (own skills, this server's library, workspace skills), each with a
 *   filter row and a search; the two roads to a new skill (ask your AI, or write it yourself in the
 *   editor); and the section that says how an agent loads a skill. What opens under a row is
 *   rows.js. Pure render over the ctx bag.
 * @structure renderPage · shelf · secNew · secAgent
 * @usage import { renderPage } from './skills/page.js';
 * @version-history
 *   v1.24.0 -- 2026-09-26 -- On the component kit (page group G7): the empty lines and leads are the Note, the editor is the TextArea with the Tabs for who may see it and the Action doors, the rule an AI gets is the Box with its copy door; the workspace tag counts nothing yet in the dim tone again (main's og-chip--dim). The page writes no class.
 *   v1.23.0 -- 2026-09-26 -- A shelf's filters, search line, rows and more line are the List component (components/List.js: Filters, SearchLine, List, More): the page passes the words, the counts and the rows (component plan C1).
 *   v1.23.0 -- 2026-09-26 -- The page's frame is the SettingsPage component (components/SettingsPage.js): the crumb, the head (its tags as data, the loud copy and the new-skill link from the Action kit), the rail's sections and its sibling pages are data, and the rail owns the scroll (component plan C9).
 *   v1.22.0 -- 2026-09-26 -- The two roads to a new skill are the Roads component (components/Roads.js): the page passes the words, the request and the doors; the copy door is the Action's copy (component plan C3).
 *   v1.21.0 -- 2026-09-26 -- The strip is the FigureStrip component (the agents figure's coral is its notice tone) and the AI section's facts are the Facts component: the page passes data (component plan C4).
 *   v1.20.0 -- 2026-09-26 -- The request for an agent is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.19.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.18.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.17.0 -- 2026-09-25 -- A filter's count is the Count (.poster-count, tally), a unification: Jouni's decision "Count".
 *   v1.16.0 -- 2026-09-25 -- Who may see a new skill (owner, members, public) is a choice: the Tab (.poster-tab, the chosen one .is-on), a unification: Jouni's decision "Choice".
 *   v1.15.0 -- 2026-09-25 -- The line under each shelf (show more, how many shown) is the More line (.more-line, css/components/more-line.css), a library part by a move.
 *   v1.14.0 -- 2026-09-25 -- The AI section facts are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- The shelves are the Listing (listing, listing-row, its head row), a unification: the look most tabs use.
 *   v1.12.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.10.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.9.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: select the shared ink frame for the agent rule.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { scrollToSection } from '/components/Rail.js';
import { x, crumb, pageLinks, agentRule, agentRequest, bindingFile, daysAgo, visibilityWord } from './frame.js';
import { skillRow, loadingRow } from './rows.js';
import { Hint } from '/components/Hint.js';
import { Facts } from '/components/Facts.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Code, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { TextArea } from '/components/TextField.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Roads, Road } from '/components/Roads.js';
import { List, Filters, Filter, SearchLine, More } from '/components/List.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<${Filter} key=${key} on=${on} count=${n} onClick=${onClick}>${label}<//>`;
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));

export function renderPage(ctx) {
  const lib = ctx.library;   // null while loading
  const own = lib ? lib.user : [];
  const node = lib ? lib.node : [];
  const ws = lib ? lib.workspace : [];
  const bound = own.filter((s) => bindingFile(s));
  const linked = [...own, ...node, ...ws].filter((s) => (s.linkedBy || []).length);
  const agentsLinking = new Set(linked.flatMap((s) => s.linkedBy.map((l) => l.agent)));
  const none = lib && own.length === 0;

  const strip = html`<${FigureStrip} items=${[
    { n: lib ? own.length : '…', label: x('stripOwn'), sub: lib ? (own.length ? x('stripOwnSub', { bound: bound.length, mine: own.filter((s) => s.visibility === 'owner').length }) : x('stripOwnNone')) : '' },
    { n: lib ? node.length : '…', label: x('stripNode'), sub: lib ? x('stripNodeSub', { pub: node.filter((s) => s.visibility === 'public').length, members: node.filter((s) => s.visibility !== 'public').length }) : '' },
    { n: lib ? ws.length : '…', label: x('stripWs'), sub: lib ? (ws.length ? x('stripWsSub', { n: new Set(ws.map((s) => s.org)).size }) : x('stripWsNone')) : '' },
    { n: lib ? agentsLinking.size : '…', tone: agentsLinking.size ? undefined : 'notice', label: x('stripAgents'), sub: lib ? x('stripAgentsSub', { total: ctx.agentCount ?? '?', apps: new Set(bound.map(bindingFile)).size }) : '' },
  ]} />`;

  const marks = lib ? [
    { label: none ? x('chipNone') : x('chipOwn', { n: own.length }), tone: none ? 'coral' : 'sun' },
    { label: x('chipNode', { n: node.length }) },
    { label: x('chipWs', { n: ws.length }), tone: ws.length ? undefined : 'dim' },
    bound.length ? { label: x('chipBound', { n: bound.length }) } : null,
    { label: x('chipLinked', { n: linked.length }), tone: linked.length ? undefined : 'coral' },
  ] : [];
  const actions = html`
    <${Loud} copy=${agentRule(ctx.nodeUrl)} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))}>${x('copyRule')}<//>
    <${Actions}><${Action} small onClick=${() => { ctx.openEditor(); scrollToSection('sk-new'); }}>${x('newSkill')}<//><//>`;
  const sections = [
    { id: 'sk-own', num: '01', label: x('secOwn'), count: lib ? own.length : '' },
    { id: 'sk-node', num: '02', label: x('secNode'), count: lib ? node.length : '' },
    { id: 'sk-ws', num: '03', label: x('secWs'), count: lib ? ws.length : '' },
    { id: 'sk-new', num: '04', label: x('secNew') },
    { id: 'sk-ai', num: '05', label: x('secAi') },
  ];

  return html`
    <${SettingsPage} name="skills" crumb=${crumb()} title=${t('skills.tabLabel')} sub=${x('titleSub')} marks=${marks}
      desc=${none ? x('descEmpty', { n: node.length }) : x('desc')} actions=${actions} strip=${strip}
      railTitle=${x('railTitle')} sections=${sections} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${shelf(ctx, 'own', '01', x('secOwn'), lib ? (own.length ? x('secOwnSub', { n: own.length, bound: bound.length }) : x('secOwnNone')) : null, own, true)}
      ${shelf(ctx, 'node', '02', x('secNode'), lib ? x('secNodeSub', { n: node.length }) : null, node, false)}
      ${shelf(ctx, 'ws', '03', x('secWs'), lib ? (ws.length ? x('secWsSub', { n: ws.length, orgs: new Set(ws.map((s) => s.org)).size }) : x('secWsNone')) : null, ws, false)}
      ${secNew(ctx, '04')}
      ${secAgent(ctx, '05', node)}
    <//>`;
}

/* ── One shelf: facets, search, rows ─────────────────────────────────────────────────────────── */

function shelf(ctx, key, num, title, sub, list, first) {
  const F = ctx.filters[key];
  const q = (ctx.queries[key] || '').trim().toLowerCase();
  const count = (f) => list.filter(f).length;
  const recent = (s) => daysAgo(s.updatedAt) <= 30;
  let rows = list;
  if (F.who === 'bound') rows = rows.filter((s) => bindingFile(s));
  if (F.who === 'free') rows = rows.filter((s) => !bindingFile(s) && !(s.linkedBy || []).length && !s.supersededBy);
  if (F.who === 'linked') rows = rows.filter((s) => (s.linkedBy || []).length);
  if (F.vis) rows = rows.filter((s) => s.visibility === F.vis);
  if (F.recent) rows = rows.filter(recent);
  if (F.replaced) rows = rows.filter((s) => s.supersededBy);
  if (F.builtin) rows = rows.filter((s) => s.builtin);
  if (q) rows = rows.filter((s) => matches(q, s.name, s.description, bindingFile(s), ctx.apps?.[bindingFile(s)], (s.linkedBy || []).map((l) => l.agent).join(' ')));
  rows = rows.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const shown = rows.slice(0, ctx.shown[key]);
  const set = (patch) => ctx.setFilter(key, patch);
  const tog = (field, value) => set({ [field]: F[field] === value ? '' : value });
  const ids = { own: 'sk-own', node: 'sk-node', ws: 'sk-ws' };
  const isAll = !F.who && !F.vis && !F.recent && !F.replaced && !F.builtin;
  const clear = () => set({ who: '', vis: '', recent: false, replaced: false, builtin: false });
  return html`
    <${PageSection} id=${ids[key]} num=${num} title=${title} count=${sub} first=${first}>
      ${!ctx.library ? loadingRow() : !list.length ? (key === 'own' ? null : html`<${Note} kind="quiet">${x(key === 'node' ? 'emptyNode' : 'emptyWs')}<//>`) : html`
        <${Filters}>
          ${facet(isAll, x('facetAll'), list.length, clear, 'all')}
          ${key === 'own' ? facet(F.who === 'bound', x('facetBound'), count((s) => bindingFile(s)), () => tog('who', 'bound'), 'bound') : null}
          ${key === 'own' ? facet(F.who === 'free', x('facetFree'), count((s) => !bindingFile(s) && !(s.linkedBy || []).length && !s.supersededBy), () => tog('who', 'free'), 'free') : null}
          ${count((s) => (s.linkedBy || []).length) ? facet(F.who === 'linked', x('facetLinked'), count((s) => (s.linkedBy || []).length), () => tog('who', 'linked'), 'linked') : null}
          ${key === 'own' ? facet(F.vis === 'owner', x('facetOwner'), count((s) => s.visibility === 'owner'), () => tog('vis', 'owner'), 'owner') : null}
          ${key !== 'ws' ? facet(F.vis === 'members', x('facetMembers'), count((s) => s.visibility === 'members'), () => tog('vis', 'members'), 'members') : null}
          ${key !== 'ws' ? facet(F.vis === 'public', x('facetPublic'), count((s) => s.visibility === 'public'), () => tog('vis', 'public'), 'public') : null}
          ${facet(!!F.recent, x('facetRecent'), count(recent), () => set({ recent: !F.recent }), 'recent')}
          ${count((s) => s.supersededBy) ? facet(!!F.replaced, x('facetReplaced'), count((s) => s.supersededBy), () => set({ replaced: !F.replaced }), 'replaced') : null}
          ${key === 'node' && count((s) => s.builtin) ? facet(!!F.builtin, x('facetBuiltin'), count((s) => s.builtin), () => set({ builtin: !F.builtin }), 'builtin') : null}
        <//>
        <${SearchLine} value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} note=${x('searchOrder')} />
        <${List} cols="name-desc-who-doors" head=${[x('colSkill'), x('colTeaches'), x('colWho'), '']} empty=${x('noMatch')}>
          ${shown.map((s) => skillRow(ctx, s))}
        <//>
        <${More} note=${x('shownOf', { shown: shown.length, total: rows.length })}
          label=${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}
          onMore=${shown.length < rows.length ? () => ctx.setShown(key, ctx.shown[key] + PAGE) : null} />`}
      ${ctx.library && key === 'own' && !list.length ? html`<${Note} kind="quiet"><b>${x('emptyOwn')}</b> ${x('emptyOwnSub')}<//>` : null}
      ${ctx.library && list.length ? html`<${Hint}>${x('hint.' + key)}<//>` : null}
    <//>`;
}

/* ── A new skill: ask your AI, or write it yourself ───────────────────────────────────────────── */

function secNew(ctx, num) {
  const e = ctx.editor;
  return html`
    <${PageSection} id="sk-new" num=${num} title=${x('secNew')} count=${null}>
      <${Note} kind="lead">${x('newIntro')}<//>
      <${Roads}>
        <${Road} lead name=${x('roadAsk')} text=${x('roadAskBody')} code=${agentRequest(ctx.ownerName)}
          doors=${html`<${Action} small copy=${agentRequest(ctx.ownerName)} copiedLabel=${x('copied')}>${x('copyRequest')}<//>`} />
        <${Road} name=${e.editing ? x('roadEdit', { name: e.editing }) : x('roadWrite')} text=${x('roadWriteBody')}
          doors=${e.open ? null : html`<${Action} small onClick=${() => ctx.openEditor()}>${x('openEditor')}<//>`}>
          ${e.open ? html`
            <${TextArea} rows=${16} value=${e.md} onInput=${(md) => ctx.setEditor({ md })} placeholder=${x('editorPlaceholder')} ariaLabel=${x('roadWrite')} />
            <${Actions}>
              <${Label}>${x('vis.k')}<//>
              <${Tabs} label=${x('vis.k')} value=${e.visibility} onSelect=${(v) => ctx.setEditor({ visibility: v })}
                items=${['owner', 'members', 'public'].map((v) => ({ value: v, label: visibilityWord(v) }))} />
              <${Action} small disabled=${e.publishing || !e.md.trim()} onClick=${() => ctx.publish()}>${e.publishing ? x('publishing') : x('publish')}<//>
              <${Action} small soft onClick=${() => ctx.closeEditor()}>${x('cancel')}<//>
            <//>
            <${Hint}>${x('editorHint')}<//>` : null}
        <//>
      <//>
    <//>`;
}

/* ── How an agent loads a skill ───────────────────────────────────────────────────────────────── */

function secAgent(ctx, num, node) {
  const pub = node.filter((s) => s.visibility === 'public').length;
  return html`
    <${PageSection} id="sk-ai" num=${num} title=${x('secAi')} count=${null}>
      <${Note} kind="lead">${x('aiIntro')}<//>
      <${Box} doors=${html`<${Action} small copy=${agentRule(ctx.nodeUrl)} copiedLabel=${x('copied')}>${x('copyRule')}<//>`}>
        <${Label} block>${x('ruleLabel')}<//>
        <${Note} kind="lead">${x('ruleBody')}<//>
      <//>
      <${Facts} wide rows=${[
        { k: x('who.k'), v: x('aiWhoBody'), sub: x('aiWhoSub') },
        { k: x('vis.k'), v: x('aiVisBody'), sub: x('aiVisSub', { n: pub, url: `${ctx.nodeUrl}/.well-known/agent-skills/index.json` }) },
        { k: x('aiVersionsK'), v: x('aiVersionsBody') },
        { k: x('aiInstallK'), v: html`${x('aiInstallBody')}<${Code}>aimeat skill install node:aimeat-node-guide<//>` },
      ]} />
    <//>`;
}
