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
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, crumb, pageLinks, agentRule, agentRequest, bindingFile, daysAgo, visibilityWord } from './frame.js';
import { skillRow, loadingRow } from './rows.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`sk-facet ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<em>${n}</em></button>`;
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
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;

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
          <h1 class="og-title">${t('skills.tabLabel')}<small>${x('titleSub')}</small></h1>
          <div class="og-chips">
            ${lib ? chip(none ? x('chipNone') : x('chipOwn', { n: own.length }), none ? 'og-chip--coral' : 'og-chip--sun') : null}
            ${lib ? chip(x('chipNode', { n: node.length })) : null}
            ${lib ? chip(x('chipWs', { n: ws.length }), ws.length ? '' : 'og-chip--dim') : null}
            ${lib && bound.length ? chip(x('chipBound', { n: bound.length })) : null}
            ${lib ? chip(x('chipLinked', { n: linked.length }), linked.length ? '' : 'og-chip--coral') : null}
          </div>
          <p class="og-desc">${none ? x('descEmpty', { n: node.length }) : x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <${CopyButton} text=${agentRule(ctx.nodeUrl)} className="og-slab" label=${x('copyRule')} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))} />
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => { ctx.openEditor(); scrollTo('sk-new'); }}>${x('newSkill')}</button></div>
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
    <${Section} id=${ids[key]} num=${num} title=${title} count=${sub} first=${first}>
      ${!ctx.library ? loadingRow() : !list.length ? (key === 'own' ? null : html`<p class="sk-empty">${x(key === 'node' ? 'emptyNode' : 'emptyWs')}</p>`) : html`
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
        <div class="sk-search"><input class="og-input" type="search" value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} aria-label=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} /><small>${x('searchOrder')}</small></div>
        ${!rows.length ? html`<p class="sk-empty">${x('noMatch')}</p>` : html`
          <div class="sk-pl">
            <div class="sk-p sk-p--head"><div>${x('colSkill')}</div><div>${x('colTeaches')}</div><div>${x('colWho')}</div><div></div></div>
            ${shown.map((s) => skillRow(ctx, s))}
          </div>`}
        <div class="sk-more">
          ${shown.length < rows.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShown(key, ctx.shown[key] + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>`}
      ${ctx.library && key === 'own' && !list.length ? html`<p class="sk-empty"><b>${x('emptyOwn')}</b> ${x('emptyOwnSub')}</p>` : null}
      ${ctx.library && list.length ? html`<p class="sk-hint">${x('hint.' + key)}</p>` : null}
    <//>`;
}

/* ── A new skill: ask your AI, or write it yourself ───────────────────────────────────────────── */

function secNew(ctx, num) {
  const e = ctx.editor;
  return html`
    <${Section} id="sk-new" num=${num} title=${x('secNew')} count=${null}>
      <p class="sk-para">${x('newIntro')}</p>
      <div class="sk-roads">
        <div class="sk-road sk-road--lead">
          <span class="sk-road-t">${x('roadAsk')}</span>
          <p class="sk-para">${x('roadAskBody')}</p>
          <pre class="sk-pre">${agentRequest(ctx.ownerName)}</pre>
          <div class="og-doors"><${CopyButton} text=${agentRequest(ctx.ownerName)} className="og-door" label=${x('copyRequest')} copiedLabel=${x('copied')} /></div>
        </div>
        <div class="sk-road">
          <span class="sk-road-t">${e.editing ? x('roadEdit', { name: e.editing }) : x('roadWrite')}</span>
          <p class="sk-para">${x('roadWriteBody')}</p>
          ${e.open ? html`
            <textarea class="og-textarea sk-editor" rows="16" value=${e.md} onInput=${(ev) => ctx.setEditor({ md: ev.target.value })} placeholder=${x('editorPlaceholder')}></textarea>
            <div class="og-doors sk-editor-doors">
              <span class="og-label">${x('vis.k')}</span>
              ${['owner', 'members', 'public'].map((v) => html`<button type="button" key=${v} class=${`og-door og-door--quiet ${e.visibility === v ? 'is-on' : ''}`} onClick=${() => ctx.setEditor({ visibility: v })}>${visibilityWord(v)}</button>`)}
              <button type="button" class="og-door" disabled=${e.publishing || !e.md.trim()} onClick=${() => ctx.publish()}>${e.publishing ? x('publishing') : x('publish')}</button>
              <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.closeEditor()}>${x('cancel')}</button>
            </div>
            <p class="sk-hint">${x('editorHint')}</p>` : html`
            <div class="og-doors"><button type="button" class="og-door" onClick=${() => ctx.openEditor()}>${x('openEditor')}</button></div>`}
        </div>
      </div>
    <//>`;
}

/* ── How an agent loads a skill ───────────────────────────────────────────────────────────────── */

function secAgent(ctx, num, node) {
  const pub = node.filter((s) => s.visibility === 'public').length;
  return html`
    <${Section} id="sk-ai" num=${num} title=${x('secAi')} count=${null}>
      <p class="sk-para">${x('aiIntro')}</p>
      <div class="sk-rule">
        <span class="og-label">${x('ruleLabel')}</span>
        <p class="sk-para">${x('ruleBody')}</p>
        <div class="og-doors"><${CopyButton} text=${agentRule(ctx.nodeUrl)} className="og-door" label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
      </div>
      <div class="sk-kv sk-kv--wide">
        <div class="sk-k">${x('who.k')}</div><div class="sk-v">${x('aiWhoBody')}<small>${x('aiWhoSub')}</small></div>
        <div class="sk-k">${x('vis.k')}</div><div class="sk-v">${x('aiVisBody')}<small>${x('aiVisSub', { n: pub, url: `${ctx.nodeUrl}/.well-known/agent-skills/index.json` })}</small></div>
        <div class="sk-k">${x('aiVersionsK')}</div><div class="sk-v">${x('aiVersionsBody')}</div>
        <div class="sk-k">${x('aiInstallK')}</div><div class="sk-v">${x('aiInstallBody')}<code>aimeat skill install node:aimeat-node-guide</code></div>
      </div>
    <//>`;
}
