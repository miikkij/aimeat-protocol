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
 *   2026-09-22 -- Composed from the shared component set (Page, Rail, Section, NumeralBand, Toolbar,
 *     ListRow, Field, Surface, KeyValue), so the page follows the theme and the parts in one edit;
 *     skills-poster.css is gone.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: select the shared ink frame for the agent rule.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Stack, Columns, NumeralBand, Toolbar, Field, ListRow, Surface, KeyValue,
  Text, Chip, Action, CopyAction, scrollToId } from '/components/poster-parts.js';
import { x, crumb, pageLinks, agentRule, agentRequest, bindingFile, daysAgo, visibilityWord } from './frame.js';
import { skillRow, loadingRow } from './rows.js';

const PAGE = 20;
const facet = (on, label, n, onClick, id) => ({ id, label: `${label} ${n}`, selected: on, onClick });
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

  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    { id: 'own', label: x('stripOwn'), value: lib ? own.length : '…', note: lib ? (own.length ? x('stripOwnSub', { bound: bound.length, mine: own.filter((s) => s.visibility === 'owner').length }) : x('stripOwnNone')) : '' },
    { id: 'node', label: x('stripNode'), value: lib ? node.length : '…', note: lib ? x('stripNodeSub', { pub: node.filter((s) => s.visibility === 'public').length, members: node.filter((s) => s.visibility !== 'public').length }) : '' },
    { id: 'ws', label: x('stripWs'), value: lib ? ws.length : '…', note: lib ? (ws.length ? x('stripWsSub', { n: new Set(ws.map((s) => s.org)).size }) : x('stripWsNone')) : '' },
    { id: 'agents', label: x('stripAgents'), value: lib ? agentsLinking.size : '…', tone: agentsLinking.size ? undefined : 'coral', note: lib ? x('stripAgentsSub', { total: ctx.agentCount ?? '?', apps: new Set(bound.map(bindingFile)).size }) : '' },
  ]} />`;

  const identity = html`<${Stack} density="compact"><${Text} tone="muted">${x('titleSub')}<//>${lib ? html`<${Stack} direction="wrap" density="compact">
    <${Chip} tone=${none ? 'coral' : 'sun'}>${none ? x('chipNone') : x('chipOwn', { n: own.length })}<//>
    <${Chip}>${x('chipNode', { n: node.length })}<//>
    <${Chip} tone=${ws.length ? 'plain' : 'muted'}>${x('chipWs', { n: ws.length })}<//>
    ${bound.length ? html`<${Chip}>${x('chipBound', { n: bound.length })}<//>` : null}
    <${Chip} tone=${linked.length ? 'plain' : 'coral'}>${x('chipLinked', { n: linked.length })}<//>
  <//>` : null}<//>`;

  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${[
    { href: '#sk-own', label: x('secOwn'), count: lib ? own.length : undefined },
    { href: '#sk-node', label: x('secNode'), count: lib ? node.length : undefined },
    { href: '#sk-ws', label: x('secWs'), count: lib ? ws.length : undefined },
    { href: '#sk-new', label: x('secNew') },
    { href: '#sk-ai', label: x('secAi') },
  ]}>${pageLinks()}<//>`;

  return html`<${Page} crumbs=${crumb()}
    title=${t('skills.tabLabel')}
    identity=${identity}
    actions=${html`<${CopyAction} kind="primary" text=${agentRule(ctx.nodeUrl)} label=${x('copyRule')} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))} />
      <${Action} onClick=${() => { ctx.openEditor(); scrollToId('sk-new'); }}>${x('newSkill')}<//>`}
    rail=${rail}>
    <${Stack}>
      <${Text} tone="muted">${none ? x('descEmpty', { n: node.length }) : x('desc')}<//>
      ${strip}
      ${shelf(ctx, 'own', x('secOwn'), lib ? (own.length ? x('secOwnSub', { n: own.length, bound: bound.length }) : x('secOwnNone')) : null, own)}
      ${shelf(ctx, 'node', x('secNode'), lib ? x('secNodeSub', { n: node.length }) : null, node)}
      ${shelf(ctx, 'ws', x('secWs'), lib ? (ws.length ? x('secWsSub', { n: ws.length, orgs: new Set(ws.map((s) => s.org)).size }) : x('secWsNone')) : null, ws)}
      ${secNew(ctx)}
      ${secAgent(ctx, node)}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

/* ── One shelf: facets, search, rows ─────────────────────────────────────────────────────────── */

function shelf(ctx, key, title, sub, list) {
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
  const filters = [
    facet(isAll, x('facetAll'), list.length, clear, 'all'),
    key === 'own' ? facet(F.who === 'bound', x('facetBound'), count((s) => bindingFile(s)), () => tog('who', 'bound'), 'bound') : null,
    key === 'own' ? facet(F.who === 'free', x('facetFree'), count((s) => !bindingFile(s) && !(s.linkedBy || []).length && !s.supersededBy), () => tog('who', 'free'), 'free') : null,
    count((s) => (s.linkedBy || []).length) ? facet(F.who === 'linked', x('facetLinked'), count((s) => (s.linkedBy || []).length), () => tog('who', 'linked'), 'linked') : null,
    key === 'own' ? facet(F.vis === 'owner', x('facetOwner'), count((s) => s.visibility === 'owner'), () => tog('vis', 'owner'), 'owner') : null,
    key !== 'ws' ? facet(F.vis === 'members', x('facetMembers'), count((s) => s.visibility === 'members'), () => tog('vis', 'members'), 'members') : null,
    key !== 'ws' ? facet(F.vis === 'public', x('facetPublic'), count((s) => s.visibility === 'public'), () => tog('vis', 'public'), 'public') : null,
    facet(!!F.recent, x('facetRecent'), count(recent), () => set({ recent: !F.recent }), 'recent'),
    count((s) => s.supersededBy) ? facet(!!F.replaced, x('facetReplaced'), count((s) => s.supersededBy), () => set({ replaced: !F.replaced }), 'replaced') : null,
    key === 'node' && count((s) => s.builtin) ? facet(!!F.builtin, x('facetBuiltin'), count((s) => s.builtin), () => set({ builtin: !F.builtin }), 'builtin') : null,
  ].filter(Boolean);
  return html`
    <${Section} id=${ids[key]} title=${title} count=${sub}>
      <${Stack}>
      ${!ctx.library ? loadingRow() : !list.length ? (key === 'own' ? null : html`<${Text} tone="muted">${x(key === 'node' ? 'emptyNode' : 'emptyWs')}<//>`) : html`
        <${Toolbar} filters=${filters} />
        <${Stack} density="compact">
          <${Field} type="search" value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} ariaLabel=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} />
          <${Text} kind="caption" tone="muted">${x('searchOrder')}<//>
        <//>
        ${!rows.length ? html`<${Text} tone="muted">${x('noMatch')}<//>` : html`
          <div>
            <${ListRow} density="compact" name=${html`<${Text} kind="label">${x('colSkill')} · ${x('colTeaches')} · ${x('colWho')}<//>`} />
            ${shown.map((s) => skillRow(ctx, s))}
          </div>`}
        <${Stack} direction="wrap" align="center">
          ${shown.length < rows.length ? html`<${Action} onClick=${() => ctx.setShown(key, ctx.shown[key] + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}<//>` : null}
          <${Text} kind="caption" tone="muted">${x('shownOf', { shown: shown.length, total: rows.length })}<//>
        <//>`}
      ${ctx.library && key === 'own' && !list.length ? html`<${Text}><strong>${x('emptyOwn')}</strong> ${x('emptyOwnSub')}<//>` : null}
      ${ctx.library && list.length ? html`<${Text} kind="caption" tone="muted">${x('hint.' + key)}<//>` : null}
      <//>
    <//>`;
}

/* ── A new skill: ask your AI, or write it yourself ───────────────────────────────────────────── */

function secNew(ctx) {
  const e = ctx.editor;
  return html`
    <${Section} id="sk-new" title=${x('secNew')} description=${x('newIntro')}>
      <${Columns} collapse="900" density="roomy">
        <${Surface} kind="box">
          <${Stack}>
            <${Text} kind="heading" size="small">${x('roadAsk')}<//>
            <${Text}>${x('roadAskBody')}<//>
            <${Surface} kind="code">${agentRequest(ctx.ownerName)}<//>
            <div><${CopyAction} text=${agentRequest(ctx.ownerName)} label=${x('copyRequest')} copiedLabel=${x('copied')} /></div>
          <//>
        <//>
        <${Stack}>
          <${Text} kind="heading" size="small">${e.editing ? x('roadEdit', { name: e.editing }) : x('roadWrite')}<//>
          <${Text}>${x('roadWriteBody')}<//>
          ${e.open ? html`
            <${Field} type="textarea" rows=${16} value=${e.md} onInput=${(ev) => ctx.setEditor({ md: ev.target.value })} placeholder=${x('editorPlaceholder')} ariaLabel=${e.editing ? x('roadEdit', { name: e.editing }) : x('roadWrite')} spellCheck=${false} />
            <${Stack} direction="wrap" align="center">
              <${Text} kind="label">${x('vis.k')}<//>
              ${['owner', 'members', 'public'].map((v) => html`<${Action} key=${v} kind="tab" selected=${e.visibility === v} onClick=${() => ctx.setEditor({ visibility: v })}>${visibilityWord(v)}<//>`)}
            <//>
            <${Stack} direction="wrap" align="center">
              <${Action} disabled=${e.publishing || !e.md.trim()} onClick=${() => ctx.publish()}>${e.publishing ? x('publishing') : x('publish')}<//>
              <${Action} onClick=${() => ctx.closeEditor()}>${x('cancel')}<//>
            <//>
            <${Text} kind="caption" tone="muted">${x('editorHint')}<//>` : html`
            <div><${Action} onClick=${() => ctx.openEditor()}>${x('openEditor')}<//></div>`}
        <//>
      <//>
    <//>`;
}

/* ── How an agent loads a skill ───────────────────────────────────────────────────────────────── */

function secAgent(ctx, node) {
  const pub = node.filter((s) => s.visibility === 'public').length;
  const kv = (label, body, sub) => html`<${KeyValue} label=${label}><${Stack} density="compact"><span>${body}</span>${sub ? html`<${Text} kind="caption" tone="muted">${sub}<//>` : null}<//><//>`;
  return html`
    <${Section} id="sk-ai" title=${x('secAi')} description=${x('aiIntro')}>
      <${Stack}>
        <${Surface} kind="box">
          <${Stack}>
            <${Text} kind="label">${x('ruleLabel')}<//>
            <${Text}>${x('ruleBody')}<//>
            <div><${CopyAction} text=${agentRule(ctx.nodeUrl)} label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
          <//>
        <//>
        <div>
          ${kv(x('who.k'), x('aiWhoBody'), x('aiWhoSub'))}
          ${kv(x('vis.k'), x('aiVisBody'), x('aiVisSub', { n: pub, url: `${ctx.nodeUrl}/.well-known/agent-skills/index.json` }))}
          ${kv(x('aiVersionsK'), x('aiVersionsBody'))}
          <${KeyValue} label=${x('aiInstallK')}><${Stack} density="compact"><span>${x('aiInstallBody')}</span><${Text} kind="mono">aimeat skill install node:aimeat-node-guide<//><//><//>
        </div>
      <//>
    <//>`;
}
