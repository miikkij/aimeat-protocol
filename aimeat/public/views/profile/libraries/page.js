/**
 * @file public/views/profile/libraries/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Libraries page in the poster face: the builder's shelf. The mast and the strip;
 *   three shelves as rows (the base the app signs in and stores with, the ready-made UI a cortex
 *   gives, the third-party libraries served from this node at a fixed version), each with a filter
 *   row and a search; and the fourth section that says how an AI takes a library into use. What
 *   opens under a row is rows.js. Pure render over the ctx bag.
 * @structure renderPage · shelf · secAI
 * @usage import { renderPage } from './libraries/page.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, shelfOf, isCommunity, crumb, pageLinks, aiRule } from './frame.js';
import { packRow } from './rows.js';

const PAGE = 20;
const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`lb-facet ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<em>${n}</em></button>`;
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
const used = (p) => p.used_by?.apps || 0;
const proven = (p) => (p.proofs || []).length > 0;

export function renderPage(ctx) {
  const packs = ctx.packs;   // null while loading
  const all = packs || [];
  const base = all.filter((p) => shelfOf(p) === 'base');
  const ui = all.filter((p) => shelfOf(p) === 'ui');
  const third = all.filter((p) => shelfOf(p) === 'third');
  const inUse = all.filter((p) => used(p) > 0).length;
  const provenN = all.filter(proven).length;
  const deprecatedN = all.filter((p) => p.status === 'deprecated').length;
  const appsUsing = ctx.appsUsing;   // { using, total } or null
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
  const top = all.slice().sort((a, b) => used(b) - used(a)).slice(0, 3).filter((p) => used(p) > 0).map((p) => `${p.id} ${used(p)}`).join(' · ');

  const strip = html`
    <div class="og-strip">
      <div><b>${packs ? base.length : '…'}</b><span>${x('stripBase')}</span><small>${x('stripBaseSub')}${deprecatedN && base.some((p) => p.status === 'deprecated') ? ` · ${x('deprecatedN', { n: base.filter((p) => p.status === 'deprecated').length })}` : ''}</small></div>
      <div><b>${packs ? ui.length : '…'}</b><span>${x('stripUi')}</span><small>${packs ? x('stripUiSub', { node: ui.filter((p) => !isCommunity(p)).length, community: ui.filter(isCommunity).length }) : ''}</small></div>
      <div><b>${packs ? third.length : '…'}</b><span>${x('stripThird')}</span><small>${x('stripThirdSub')}${third.some((p) => p.status === 'deprecated') ? ` · ${x('deprecatedN', { n: third.filter((p) => p.status === 'deprecated').length })}` : ''}</small></div>
      <div><b>${appsUsing ? appsUsing.using : (packs ? inUse : '…')}</b><span>${appsUsing ? x('stripApps', { total: appsUsing.total }) : x('stripInUse')}</span><small>${top ? x('stripTop', { list: top }) : ''}</small></div>
    </div>`;

  return html`
    <div class="og og-libs">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${t('librariesTab.tabLabel')}<small>${x('titleSub')}</small></h1>
          <div class="og-chips">
            ${packs ? chip(x('chipAll', { n: all.length }), 'og-chip--sun') : null}
            ${packs ? chip(x('chipInUse', { n: inUse })) : null}
            ${packs ? chip(x('chipProven', { n: provenN })) : null}
            ${packs && deprecatedN ? chip(x('chipDeprecated', { n: deprecatedN }), 'og-chip--dim') : null}
          </div>
          <p class="og-desc">${x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <${CopyButton} text=${aiRule(ctx.nodeUrl)} className="og-slab" label=${x('copyRule')} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))} />
          <div class="og-doors"><a class="og-door" href="https://design-book.apps.aimeat.io/" target="_blank" rel="noopener">Design Book</a></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${shelf(ctx, 'base', '01', x('secBase'), x('secBaseSub'), base, true)}
          ${shelf(ctx, 'ui', '02', x('secUi'), x('secUiSub'), ui, false)}
          ${shelf(ctx, 'third', '03', x('secThird'), x('secThirdSub'), third, false)}
          ${secAI(ctx, '04', all)}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${[['01', 'lb-base', x('secBase'), packs ? base.length : ''], ['02', 'lb-ui', x('secUi'), packs ? ui.length : ''], ['03', 'lb-third', x('secThird'), packs ? third.length : ''], ['04', 'lb-ai', x('secAi'), '']].map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
    </div>`;
}

/* ── One shelf: facets, search, rows ─────────────────────────────────────────────────────────── */

function shelf(ctx, key, num, title, sub, list, first) {
  const F = ctx.filters[key];
  const q = (ctx.queries[key] || '').trim().toLowerCase();
  const count = (f) => list.filter(f).length;
  let rows = list;
  if (F.status) rows = rows.filter((p) => p.status === F.status);
  if (F.model) rows = rows.filter((p) => p.modelTier === F.model);
  if (F.use === 'used') rows = rows.filter((p) => used(p) > 0);
  if (F.use === 'unused') rows = rows.filter((p) => used(p) === 0);
  if (F.proven) rows = rows.filter(proven);
  if (F.who === 'node') rows = rows.filter((p) => !isCommunity(p));
  if (F.who === 'community') rows = rows.filter(isCommunity);
  if (q) rows = rows.filter((p) => matches(q, p.id, p.title, p.description, p.apiSurface, (p.interviewTriggers || []).join(' ')));
  rows = rows.slice().sort((a, b) => used(b) - used(a) || String(a.title || a.id).localeCompare(String(b.title || b.id)));
  const shown = rows.slice(0, ctx.shown[key]);
  const set = (patch) => ctx.setFilter(key, patch);
  const tog = (field, value) => set({ [field]: F[field] === value ? '' : value });
  const facets = [
    facet(!F.status && !F.model && !F.use && !F.proven && !F.who, x('facetAll'), list.length, () => set({ status: '', model: '', use: '', proven: false, who: '' }), 'all'),
    ...(key === 'ui' ? [
      facet(F.who === 'node', x('facetNode'), count((p) => !isCommunity(p)), () => tog('who', 'node'), 'node'),
      facet(F.who === 'community', x('facetCommunity'), count(isCommunity), () => tog('who', 'community'), 'community'),
    ] : []),
    ...(key === 'third' ? [
      facet(F.model === 'any', x('model.any'), count((p) => p.modelTier === 'any'), () => tog('model', 'any'), 'any'),
      facet(F.model === 'frontier', x('model.frontier'), count((p) => p.modelTier === 'frontier'), () => tog('model', 'frontier'), 'frontier'),
    ] : []),
    facet(F.status === 'stable', x('status.stable'), count((p) => p.status === 'stable'), () => tog('status', 'stable'), 'stable'),
    facet(F.status === 'preview', x('status.preview'), count((p) => p.status === 'preview'), () => tog('status', 'preview'), 'preview'),
    ...(count((p) => p.status === 'deprecated') ? [facet(F.status === 'deprecated', x('status.deprecated'), count((p) => p.status === 'deprecated'), () => tog('status', 'deprecated'), 'deprecated')] : []),
    facet(F.use === 'used', x('facetUsed'), count((p) => used(p) > 0), () => tog('use', 'used'), 'used'),
    facet(F.use === 'unused', x('facetUnused'), count((p) => used(p) === 0), () => tog('use', 'unused'), 'unused'),
    ...(count(proven) ? [facet(!!F.proven, x('facetProven'), count(proven), () => set({ proven: !F.proven }), 'proven')] : []),
  ];
  const ids = { base: 'lb-base', ui: 'lb-ui', third: 'lb-third' };
  return html`
    <${Section} id=${ids[key]} num=${num} title=${title} count=${ctx.packs ? sub : null} first=${first}>
      ${!ctx.packs ? html`<p class="lb-empty">${t('common.loading')}</p>` : html`
        <div class="lb-facets">${facets}</div>
        <div class="lb-search"><input class="og-input" type="search" value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} aria-label=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} /><small>${x('searchOrder')}</small></div>
        ${!rows.length ? html`<p class="lb-empty">${key === 'ui' && F.who === 'community' && !count(isCommunity) ? x('communityEmpty') : x('noMatch')}</p>` : html`
          <div class="lb-pl">
            <div class="lb-p lb-p--head"><div>${x('col.' + key)}</div><div>${key === 'ui' ? x('colGives') : x('colDoes')}</div><div>${x('colInApp')}</div><div></div></div>
            ${shown.map((p) => packRow(ctx, p))}
          </div>`}
        <div class="lb-more">
          ${shown.length < rows.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShown(key, ctx.shown[key] + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>
        <p class="lb-hint">${x('hint.' + key)}</p>`}
    <//>`;
}

/* ── How an AI takes a library into use ──────────────────────────────────────────────────────── */

function secAI(ctx, num, all) {
  const proofs = all.reduce((s, p) => s + (p.proofs || []).length, 0);
  const passed = all.reduce((s, p) => s + (p.proofs || []).filter((pr) => pr.verdict === 'pass').length, 0);
  const inUse = all.filter((p) => used(p) > 0).length;
  const appsUsing = ctx.appsUsing;
  return html`
    <${Section} id="lb-ai" num=${num} title=${x('secAi')} count=${null}>
      <p class="lb-para">${x('aiIntro')}</p>
      <div class="lb-rule">
        <span class="og-label">${x('ruleLabel')}</span>
        <p class="lb-para">${x('ruleBody', { base: ctx.nodeUrl })}</p>
        <div class="og-doors"><${CopyButton} text=${aiRule(ctx.nodeUrl)} className="og-door" label=${x('copyRule')} copiedLabel=${x('copied')} /></div>
      </div>
      <div class="lb-kv lb-kv--wide">
        <div class="lb-k">${x('aiModelK')}</div><div class="lb-v">${x('aiModelBody')}<small>${x('aiModelSub')}</small></div>
        <div class="lb-k">${x('aiProvenK')}</div><div class="lb-v">${x('aiProvenBody', { n: all.filter(proven).length, runs: proofs, passed, failed: proofs - passed })}<small>${x('aiProvenSub')}</small></div>
        <div class="lb-k">${x('aiUsedK')}</div><div class="lb-v">${appsUsing ? x('aiUsedBody', { using: appsUsing.using, total: appsUsing.total, libs: inUse, unused: all.length - inUse }) : x('aiUsedBodyShort', { libs: inUse, unused: all.length - inUse })}</div>
      </div>
    <//>`;
}
