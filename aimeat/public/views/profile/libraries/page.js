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
 *   2026-09-22 -- Composed from the shared component set: Page, Rail, a plain NumeralBand strip,
 *     Toolbar filters for the facets, Field for the search, a Surface box for the AI rule and
 *     KeyValue for how an AI takes a library; no own CSS. The shelves' column heads are gone: each
 *     row says what it is.
 *   v1.2.0 -- 2026-09-13 -- Compose the existing instruction frame from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Stack, NumeralBand, Toolbar, Field, KeyValue, Action, CopyAction, Chip, Text, Surface } from '/components/poster-parts.js';
import { x, shelfOf, isCommunity, crumb, pageLinks, aiRule } from './frame.js';
import { packRow } from './rows.js';

const PAGE = 20;
/** A facet: a filter tab with its count. */
const facet = (id, on, label, n, onClick) => ({ id, selected: on, label: `${label} ${n}`, onClick });
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
  const top = all.slice().sort((a, b) => used(b) - used(a)).slice(0, 3).filter((p) => used(p) > 0).map((p) => `${p.id} ${used(p)}`).join(' · ');

  const strip = html`<${NumeralBand} tone="plain" items=${[
    { label: x('stripBase'), value: packs ? base.length : '…', note: `${x('stripBaseSub')}${deprecatedN && base.some((p) => p.status === 'deprecated') ? ` · ${x('deprecatedN', { n: base.filter((p) => p.status === 'deprecated').length })}` : ''}` },
    { label: x('stripUi'), value: packs ? ui.length : '…', note: packs ? x('stripUiSub', { node: ui.filter((p) => !isCommunity(p)).length, community: ui.filter(isCommunity).length }) : '' },
    { label: x('stripThird'), value: packs ? third.length : '…', note: `${x('stripThirdSub')}${third.some((p) => p.status === 'deprecated') ? ` · ${x('deprecatedN', { n: third.filter((p) => p.status === 'deprecated').length })}` : ''}` },
    { label: appsUsing ? x('stripApps', { total: appsUsing.total }) : x('stripInUse'), value: appsUsing ? appsUsing.using : (packs ? inUse : '…'), note: top ? x('stripTop', { list: top }) : '' },
  ]} />`;

  const identity = html`<${Stack} density="compact">
    <${Text} kind="label">${x('titleSub')}<//>
    ${packs ? html`<${Stack} direction="wrap" density="compact">
      <${Chip} tone="sun">${x('chipAll', { n: all.length })}<//>
      <${Chip}>${x('chipInUse', { n: inUse })}<//>
      <${Chip}>${x('chipProven', { n: provenN })}<//>
      ${deprecatedN ? html`<${Chip} tone="muted">${x('chipDeprecated', { n: deprecatedN })}<//>` : null}
    <//>` : null}
  <//>`;
  const actions = html`<${CopyAction} kind="primary" text=${aiRule(ctx.nodeUrl)} label=${x('copyRule')} copiedLabel=${x('copied')} onCopied=${() => ctx.showToast?.(x('ruleCopiedToast'))} />
    <${Action} href="https://design-book.apps.aimeat.io/" target="_blank">Design Book<//>`;
  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${[
    { href: '#lb-base', label: x('secBase'), count: packs ? base.length : undefined },
    { href: '#lb-ui', label: x('secUi'), count: packs ? ui.length : undefined },
    { href: '#lb-third', label: x('secThird'), count: packs ? third.length : undefined },
    { href: '#lb-ai', label: x('secAi') },
  ]}>${pageLinks()}<//>`;

  return html`<${Page} width="wide" title=${t('librariesTab.tabLabel')} crumbs=${crumb()} identity=${identity} actions=${actions} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${x('desc')}<//>
      ${strip}
      ${shelf(ctx, 'base', x('secBase'), x('secBaseSub'), base)}
      ${shelf(ctx, 'ui', x('secUi'), x('secUiSub'), ui)}
      ${shelf(ctx, 'third', x('secThird'), x('secThirdSub'), third)}
      ${secAI(ctx, all)}
    <//>
  <//>`;
}

/* ── One shelf: facets, search, rows ─────────────────────────────────────────────────────────── */

function shelf(ctx, key, title, sub, list) {
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
    facet('all', !F.status && !F.model && !F.use && !F.proven && !F.who, x('facetAll'), list.length, () => set({ status: '', model: '', use: '', proven: false, who: '' })),
    ...(key === 'ui' ? [
      facet('node', F.who === 'node', x('facetNode'), count((p) => !isCommunity(p)), () => tog('who', 'node')),
      facet('community', F.who === 'community', x('facetCommunity'), count(isCommunity), () => tog('who', 'community')),
    ] : []),
    ...(key === 'third' ? [
      facet('any', F.model === 'any', x('model.any'), count((p) => p.modelTier === 'any'), () => tog('model', 'any')),
      facet('frontier', F.model === 'frontier', x('model.frontier'), count((p) => p.modelTier === 'frontier'), () => tog('model', 'frontier')),
    ] : []),
    facet('stable', F.status === 'stable', x('status.stable'), count((p) => p.status === 'stable'), () => tog('status', 'stable')),
    facet('preview', F.status === 'preview', x('status.preview'), count((p) => p.status === 'preview'), () => tog('status', 'preview')),
    ...(count((p) => p.status === 'deprecated') ? [facet('deprecated', F.status === 'deprecated', x('status.deprecated'), count((p) => p.status === 'deprecated'), () => tog('status', 'deprecated'))] : []),
    facet('used', F.use === 'used', x('facetUsed'), count((p) => used(p) > 0), () => tog('use', 'used')),
    facet('unused', F.use === 'unused', x('facetUnused'), count((p) => used(p) === 0), () => tog('use', 'unused')),
    ...(count(proven) ? [facet('proven', !!F.proven, x('facetProven'), count(proven), () => set({ proven: !F.proven }))] : []),
  ];
  const ids = { base: 'lb-base', ui: 'lb-ui', third: 'lb-third' };
  return html`
    <${Section} id=${ids[key]} title=${title} count=${ctx.packs ? sub : null}>
      ${!ctx.packs ? html`<${Text} tone="muted">${t('common.loading')}<//>` : html`
        <${Stack}>
          <${Toolbar} filters=${facets} />
          <${Stack} density="compact">
            <${Field} type="search" value=${ctx.queries[key] || ''} placeholder=${x('search.' + key)} ariaLabel=${x('search.' + key)} onInput=${(e) => ctx.setQuery(key, e.target.value)} />
            <${Text} kind="caption" tone="muted">${x('searchOrder')}<//>
          <//>
          ${!rows.length ? html`<${Text} tone="muted">${key === 'ui' && F.who === 'community' && !count(isCommunity) ? x('communityEmpty') : x('noMatch')}<//>` : html`
            <${Stack} density="compact">${shown.map((p) => packRow(ctx, p))}<//>`}
          <${Stack} direction="horizontal" align="between">
            ${shown.length < rows.length ? html`<${Action} onClick=${() => ctx.setShown(key, ctx.shown[key] + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}<//>` : html`<span></span>`}
            <${Text} kind="mono" tone="muted">${x('shownOf', { shown: shown.length, total: rows.length })}<//>
          <//>
          <${Text} kind="caption" tone="muted">${x('hint.' + key)}<//>
        <//>`}
    <//>`;
}

/* ── How an AI takes a library into use ──────────────────────────────────────────────────────── */

function secAI(ctx, all) {
  const proofs = all.reduce((s, p) => s + (p.proofs || []).length, 0);
  const passed = all.reduce((s, p) => s + (p.proofs || []).filter((pr) => pr.verdict === 'pass').length, 0);
  const inUse = all.filter((p) => used(p) > 0).length;
  const appsUsing = ctx.appsUsing;
  const kv = (label, body, note) => html`<${KeyValue} label=${label}>
    <${Stack} density="compact"><span>${body}</span>${note ? html`<${Text} kind="caption" tone="muted">${note}<//>` : null}<//>
  <//>`;
  return html`
    <${Section} id="lb-ai" title=${x('secAi')}>
      <${Stack}>
        <${Text}>${x('aiIntro')}<//>
        <${Surface} kind="box">
          <${Stack} density="compact">
            <${Text} kind="label">${x('ruleLabel')}<//>
            <${Text}>${x('ruleBody', { base: ctx.nodeUrl })}<//>
            <${Stack} direction="horizontal" align="start"><${CopyAction} text=${aiRule(ctx.nodeUrl)} label=${x('copyRule')} copiedLabel=${x('copied')} /><//>
          <//>
        <//>
        <div>
          ${kv(x('aiModelK'), x('aiModelBody'), x('aiModelSub'))}
          ${kv(x('aiProvenK'), x('aiProvenBody', { n: all.filter(proven).length, runs: proofs, passed, failed: proofs - passed }), x('aiProvenSub'))}
          ${kv(x('aiUsedK'), appsUsing ? x('aiUsedBody', { using: appsUsing.using, total: appsUsing.total, libs: inUse, unused: all.length - inUse }) : x('aiUsedBodyShort', { libs: inUse, unused: all.length - inUse }))}
        </div>
      <//>
    <//>`;
}
