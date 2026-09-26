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
import { CopyButton } from '/components/CopyButton.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, crumb, pageLinks, agentRule, agentRequest, bindingFile, daysAgo, visibilityWord } from './frame.js';
import { skillRow, loadingRow } from './rows.js';
import { Hint } from '/components/Hint.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`poster-tab poster-tab--filter ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<span class="poster-count poster-count--tally">${n}</span></button>`;
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
  const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;

  const strip = html`
    <div class="og-strip">
      <div><b>${lib ? own.length : '…'}</b><span>${x('stripOwn')}</span><small>${lib ? (own.length ? x('stripOwnSub', { bound: bound.length, mine: own.filter((s) => s.visibility === 'owner').length }) : x('stripOwnNone')) : ''}</small></div>
      <div><b>${lib ? node.length : '…'}</b><span>${x('stripNode')}</span><small>${lib ? x('stripNodeSub', { pub: node.filter((s) => s.visibility === 'public').length, members: node.filter((s) => s.visibility !== 'public').length }) : ''}</small></div>
      <div><b>${lib ? ws.length : '…'}</b><span>${x('stripWs')}</span><small>${lib ? (ws.length ? x('stripWsSub', { n: new Set(ws.map((s) => s.org)).size }) : x('stripWsNone')) : ''}</small></div>
      <div><b class=${agentsLinking.size ? '' : 'is-coral'}>${lib ? agentsLinking.size : '…'}</b><span>${x('stripAgents')}</span><small>${lib ? x('stripAgentsSub', { total: ctx.agentCount ?? '?', apps: new Set(bound.map(bindingFile)).size }) : ''}</small></div>
    </div>`;

  return html`
    <div class="og og-skills">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('skills.tabLabel')}<small>${x('titleSub')}</small></h1>
          <div class="poster-chips">
            ${lib ? chip(none ? x('chipNone') : x('chipOwn', { n: own.length }), none ? 'poster-chip--coral' : 'poster-chip--sun') : null}
            ${lib ? chip(x('chipNode', { n: node.length })) : null}
            ${lib ? chip(x('chipWs', { n: ws.length })) : null}
            ${lib && bound.length ? chip(x('chipBound', { n: bound.length })) : null}
            ${lib ? chip(x('chipLinked', { n: linked.length }), linked.length ? '' : 'poster-chip--coral') : null}
          </div>
          <p class="og-desc">${none ? x('descEmpty', { n: node.length }) : x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <${CopyButton} text=${agentRule(ctx.nodeUrl)} className="poster-slab" label=${x('copyRule')} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))} />
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => { ctx.openEditor(); scrollTo('sk-new'); }}>${x('newSkill')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${shelf(ctx, 'own', '01', x('secOwn'), lib ? (own.length ? x('secOwnSub', { n: own.length, bound: bound.length }) : x('secOwnNone')) : null, own, true)}
          ${shelf(ctx, 'node', '02', x('secNode'), lib ? x('secNodeSub', { n: node.length }) : null, node, false)}
          ${shelf(ctx, 'ws', '03', x('secWs'), lib ? (ws.length ? x('secWsSub', { n: ws.length, orgs: new Set(ws.map((s) => s.org)).size }) : x('secWsNone')) : null, ws, false)}
          ${secNew(ctx, '04')}
          ${secAgent(ctx, '05', node)}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${[['01', 'sk-own', x('secOwn'), lib ? own.length : ''], ['02', 'sk-node', x('secNode'), lib ? node.length : ''], ['03', 'sk-ws', x('secWs'), lib ? ws.length : ''], ['04', 'sk-new', x('secNew'), ''], ['05', 'sk-ai', x('secAi'), '']].map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
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
      ${!ctx.library ? loadingRow() : !list.length ? (key === 'own' ? null : html`<p class="poster-quiet sk-empty">${x(key === 'node' ? 'emptyNode' : 'emptyWs')}</p>`) : html`
        <div class="sk-facets">
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
        </div>
        <div class="search-line"><input class="og-input" type="search" value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} aria-label=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} /><small>${x('searchOrder')}</small></div>
        ${!rows.length ? html`<p class="poster-quiet sk-empty">${x('noMatch')}</p>` : html`
          <div class="listing listing--name-desc-who-doors">
            <div class="listing-row listing-row--head"><div class="poster-label">${x('colSkill')}</div><div class="poster-label">${x('colTeaches')}</div><div class="poster-label">${x('colWho')}</div><div class="poster-label"></div></div>
            ${shown.map((s) => skillRow(ctx, s))}
          </div>`}
        <div class="more-line">
          ${shown.length < rows.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShown(key, ctx.shown[key] + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>`}
      ${ctx.library && key === 'own' && !list.length ? html`<p class="poster-quiet sk-empty"><b>${x('emptyOwn')}</b> ${x('emptyOwnSub')}</p>` : null}
      ${ctx.library && list.length ? html`<${Hint}>${x('hint.' + key)}<//>` : null}
    <//>`;
}

/* ── A new skill: ask your AI, or write it yourself ───────────────────────────────────────────── */

function secNew(ctx, num) {
  const e = ctx.editor;
  return html`
    <${PageSection} id="sk-new" num=${num} title=${x('secNew')} count=${null}>
      <p class="og-lead">${x('newIntro')}</p>
      <div class="sk-roads">
        <div class="sk-road poster-box poster-box--raised">
          <span class="sk-road-t">${x('roadAsk')}</span>
          <p class="og-lead">${x('roadAskBody')}</p>
          <pre class="code-block">${agentRequest(ctx.ownerName)}</pre>
          <div class="og-doors"><${CopyButton} text=${agentRequest(ctx.ownerName)} className="poster-action poster-action--small" label=${x('copyRequest')} copiedLabel=${x('copied')} /></div>
        </div>
        <div class="sk-road poster-box">
          <span class="sk-road-t">${e.editing ? x('roadEdit', { name: e.editing }) : x('roadWrite')}</span>
          <p class="og-lead">${x('roadWriteBody')}</p>
          ${e.open ? html`
            <textarea class="og-textarea sk-editor" rows="16" value=${e.md} onInput=${(ev) => ctx.setEditor({ md: ev.target.value })} placeholder=${x('editorPlaceholder')}></textarea>
            <div class="og-doors sk-editor-doors">
              <span class="poster-label">${x('vis.k')}</span>
              ${['owner', 'members', 'public'].map((v) => html`<button type="button" key=${v} class=${`poster-tab ${e.visibility === v ? 'is-on' : ''}`} onClick=${() => ctx.setEditor({ visibility: v })}>${visibilityWord(v)}</button>`)}
              <button type="button" class="poster-action poster-action--small" disabled=${e.publishing || !e.md.trim()} onClick=${() => ctx.publish()}>${e.publishing ? x('publishing') : x('publish')}</button>
              <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.closeEditor()}>${x('cancel')}</button>
            </div>
            <${Hint}>${x('editorHint')}<//>` : html`
            <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.openEditor()}>${x('openEditor')}</button></div>`}
        </div>
      </div>
    <//>`;
}

/* ── How an agent loads a skill ───────────────────────────────────────────────────────────────── */

function secAgent(ctx, num, node) {
  const pub = node.filter((s) => s.visibility === 'public').length;
  return html`
    <${PageSection} id="sk-ai" num=${num} title=${x('secAi')} count=${null}>
      <p class="og-lead">${x('aiIntro')}</p>
      <div class="sk-rule poster-box">
        <span class="poster-label">${x('ruleLabel')}</span>
        <p class="og-lead">${x('ruleBody')}</p>
        <div class="og-doors"><${CopyButton} text=${agentRule(ctx.nodeUrl)} className="poster-action poster-action--small" label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
      </div>
      <div class="facts facts--wide">
        <div class="facts-k poster-label">${x('who.k')}</div><div class="facts-v">${x('aiWhoBody')}<small>${x('aiWhoSub')}</small></div>
        <div class="facts-k poster-label">${x('vis.k')}</div><div class="facts-v">${x('aiVisBody')}<small>${x('aiVisSub', { n: pub, url: `${ctx.nodeUrl}/.well-known/agent-skills/index.json` })}</small></div>
        <div class="facts-k poster-label">${x('aiVersionsK')}</div><div class="facts-v">${x('aiVersionsBody')}</div>
        <div class="facts-k poster-label">${x('aiInstallK')}</div><div class="facts-v">${x('aiInstallBody')}<code class="code-inline">aimeat skill install node:aimeat-node-guide</code></div>
      </div>
    <//>`;
}
