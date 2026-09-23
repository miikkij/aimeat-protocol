/**
 * @file public/views/profile/extensions/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Extensions page in the poster face: the builder's catalogue of building blocks.
 *   The mast and the strip; the server extensions as rows (yours first, the others' behind a
 *   filter; what each does, who uses it, its actions) with a filter row and a search; the cortexes
 *   the same way; and how a new one starts (the two prompts from the node, the install form). What
 *   opens under a row is rows.js. Pure render over the ctx bag.
 * @structure renderPage · secExtensions · secCortexes · secNew
 * @usage import { renderPage } from './extensions/page.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: Page, Rail, a plain NumeralBand strip,
 *     Toolbar filters for the facets, Field for the search and the install form, Fold for the form,
 *     choice-group tabs for extension or cortex; no own CSS. The lists' column heads are gone: each
 *     row says what it is.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Fold, Stack, Columns, NumeralBand, Toolbar, Field, KeyValue, Action, CopyAction, Chip, Text, Surface, scrollToId } from '/components/poster-parts.js';
import { x, kindOf, crumb, pageLinks } from './frame.js';
import { extRow, cortexRow } from './rows.js';
import { num as fmtNum } from '/js/format.js';

const PAGE = 20;

export function renderPage(ctx) {
  const owner = ctx.session?.owner;
  const exts = ctx.extensions;         // null while loading
  const cxs = ctx.cortexes;
  const mine = (exts || []).filter((e) => e.installedBy === owner);
  const others = (exts || []).filter((e) => e.installedBy !== owner);
  const myCx = (cxs || []).filter((c) => c.installed_by === owner);
  const otherCx = (cxs || []).filter((c) => c.installed_by !== owner);
  const platformCx = otherCx.filter((c) => String(c.installed_by || '').startsWith('system'));
  const none = exts && cxs && mine.length === 0 && myCx.length === 0;
  const actions = mine.reduce((s, e) => s + (e.actionCount || 0), 0);

  const strip = html`<${NumeralBand} tone="plain" items=${[
    { label: x('stripExt'), value: exts ? mine.length : '…', note: exts ? (mine.length ? x('stripExtSub', { actions, active: mine.filter((e) => e.status === 'active').length }) : x('stripNone')) : '' },
    { label: x('stripCortex'), value: cxs ? myCx.length : '…', note: cxs ? (myCx.length ? x('stripCortexSub', { pub: myCx.filter((c) => c.visibility === 'public').length }) : x('stripNone')) : '' },
    { label: x('stripOthersExt'), value: exts ? others.length : '…', note: x('stripOthersExtSub') },
    { label: x('stripOthersCortex'), value: cxs ? otherCx.length : '…', note: cxs ? x('stripOthersCortexSub', { platform: platformCx.length, pub: otherCx.length - platformCx.length }) : '' },
  ]} />`;

  const entries = none
    ? [{ href: '#ex-new', label: x('secNew') }, { href: '#ex-ext', label: x('secExt'), count: 0 }, { href: '#ex-cortex', label: x('secCortex'), count: platformCx.length }]
    : [{ href: '#ex-ext', label: x('secExt'), count: exts ? mine.length : undefined }, { href: '#ex-cortex', label: x('secCortex'), count: cxs ? myCx.length : undefined }, { href: '#ex-new', label: x('secNew') }];

  const identity = html`<${Stack} density="compact">
    <${Text} kind="label">${x('titleSub')}<//>
    <${Stack} direction="wrap" density="compact">
      ${none ? html`<${Chip} tone="coral">${x('chipNone')}<//>` : exts ? html`<${Chip}>${x('chipExt', { n: mine.length })}<//>` : null}
      ${!none && cxs ? html`<${Chip}>${x('chipCortex', { n: myCx.length })}<//>` : null}
      ${exts ? html`<${Chip} tone="muted">${x('chipOthers', { n: others.length })}<//>` : null}
    <//>
  <//>`;
  const doors = html`<${CopyAction} kind="primary" text=${ctx.extPrompt} label=${x('createSlab')} copiedLabel=${x('copied')} disabled=${!ctx.extPrompt} onCopied=${() => ctx.showToast?.(x('promptCopiedToast'))} />
    <${Action} onClick=${() => { ctx.setFormOpen(true); scrollToId('ex-new'); }}>${x('addFromFiles')}<//>`;
  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${entries}>${pageLinks()}<//>`;

  return html`<${Page} width="wide" title=${t('profile.tabs.extensions')} crumbs=${crumb()} identity=${identity} actions=${doors} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${none ? x('descEmpty') : x('desc')}<//>
      ${strip}
      ${none ? html`${secNew(ctx)}${secExtensions(ctx, mine, others)}${secCortexes(ctx, myCx, otherCx, platformCx)}`
        : html`${secExtensions(ctx, mine, others)}${secCortexes(ctx, myCx, otherCx, platformCx)}${secNew(ctx)}`}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

/** A facet: a filter tab with its count. */
const facet = (id, on, label, n, onClick) => ({ id, selected: on, label: `${label} ${n}`, onClick });
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));

/** The search field and its note on the order. */
const search = (value, placeholder, onInput) => html`<${Stack} density="compact">
  <${Field} type="search" value=${value} placeholder=${placeholder} ariaLabel=${placeholder} onInput=${onInput} />
  <${Text} kind="caption" tone="muted">${x('searchOrder', { n: PAGE })}<//>
<//>`;

/** "Show more" and "n of m shown" under a list. */
const more = (shown, total, onMore) => html`<${Stack} direction="horizontal" align="between">
  ${shown < total ? html`<${Action} onClick=${onMore}>${x('showMore', { n: Math.min(PAGE, total - shown) })}<//>` : html`<span></span>`}
  <${Text} kind="mono" tone="muted">${x('shownOf', { shown, total })}<//>
<//>`;

/* ── Server extensions ────────────────────────────────────────────────────────────────────────── */

function secExtensions(ctx, mine, others) {
  const F = ctx.extFilter;
  const q = (ctx.extQuery || '').trim().toLowerCase();
  const pool = F.who === 'others' ? others : mine;
  let rows = pool;
  if (F.state === 'active') rows = rows.filter((e) => e.status === 'active');
  if (F.state === 'off') rows = rows.filter((e) => e.status !== 'active');
  if (F.kind) rows = rows.filter((e) => kindOf(e) === F.kind);
  if (F.instances) rows = rows.filter((e) => e.instances?.supported);
  if (q) rows = rows.filter((e) => matches(q, e.name, e.description, (e.actions || []).map((a) => a.id).join(' ')));
  rows = [...rows].sort((a, b) => String(b.installedAt || '').localeCompare(String(a.installedAt || '')));
  const shown = rows.slice(0, ctx.extShown);
  const count = (f) => mine.filter(f).length;
  return html`
    <${Section} id="ex-ext" title=${x('secExt')} count=${ctx.extensions ? mine.length : null}>
      ${!ctx.extensions ? html`<${Text} tone="muted">${t('common.loading')}<//>` : !mine.length && F.who !== 'others' ? html`
        <${Stack}>
          <${Text}><strong>${x('extEmptyHead')}</strong> ${x('extEmptyBody', { n: others.length })}<//>
          <${Toolbar} filters=${[facet('others', false, x('facetOthers'), others.length, () => ctx.setExtFilter({ who: 'others' }))]} />
        <//>` : html`
        <${Stack}>
          <${Toolbar} filters=${[
            facet('mine', F.who !== 'others', x('facetMine'), mine.length, () => ctx.setExtFilter({ who: 'mine' })),
            facet('others', F.who === 'others', x('facetOthers'), others.length, () => ctx.setExtFilter({ who: 'others' })),
            facet('active', F.state === 'active', x('facetActive'), count((e) => e.status === 'active'), () => ctx.setExtFilter({ state: F.state === 'active' ? '' : 'active' })),
            facet('off', F.state === 'off', x('facetOff'), count((e) => e.status !== 'active'), () => ctx.setExtFilter({ state: F.state === 'off' ? '' : 'off' })),
            facet('apps', F.kind === 'apps', x('facetApps'), count((e) => kindOf(e) === 'apps'), () => ctx.setExtFilter({ kind: F.kind === 'apps' ? '' : 'apps' })),
            facet('bg', F.kind === 'background', x('facetBackground'), count((e) => kindOf(e) === 'background'), () => ctx.setExtFilter({ kind: F.kind === 'background' ? '' : 'background' })),
            facet('unseen', F.kind === 'unseen', x('facetUnseen'), count((e) => kindOf(e) === 'unseen'), () => ctx.setExtFilter({ kind: F.kind === 'unseen' ? '' : 'unseen' })),
            facet('inst', !!F.instances, x('facetInstances'), count((e) => e.instances?.supported), () => ctx.setExtFilter({ instances: !F.instances })),
          ]} />
          ${search(ctx.extQuery, x('searchExt'), (e) => ctx.setExtQuery(e.target.value))}
          ${!rows.length ? html`<${Text} tone="muted">${x('noMatch')}<//>` : html`
            <${Stack} density="compact">${shown.map((e) => extRow(ctx, e))}<//>`}
          ${more(shown.length, rows.length, () => ctx.setExtShown(ctx.extShown + PAGE))}
          <${Text} kind="caption" tone="muted">${F.who === 'others' ? x('othersHint') : x('extHint')}<//>
        <//>`}
    <//>`;
}

/* ── Cortexes ─────────────────────────────────────────────────────────────────────────────────── */

function secCortexes(ctx, myCx, otherCx, platformCx) {
  const F = ctx.cxFilter;
  const q = (ctx.cxQuery || '').trim().toLowerCase();
  const publicOthers = otherCx.filter((c) => !String(c.installed_by || '').startsWith('system'));
  const pool = F.who === 'platform' ? platformCx : F.who === 'others' ? publicOthers : myCx;
  let rows = pool;
  if (F.part) rows = rows.filter((c) => (c.component_types || []).includes(F.part));
  if (F.pub) rows = rows.filter((c) => c.visibility === 'public');
  if (q) rows = rows.filter((c) => matches(q, c.name, c.description, (c.tags || []).join(' ')));
  rows = [...rows].sort((a, b) => String(b.installed_at || '').localeCompare(String(a.installed_at || '')));
  const shown = rows.slice(0, ctx.cxShown);
  const parts = ['lib', 'prompt', 'schema', 'seed-data'];
  const partCount = (p) => pool.filter((c) => (c.component_types || []).includes(p)).length;
  const actions = html`<${CopyAction} text=${ctx.cortexPrompt} label=${x('copyCortexPrompt')} copiedLabel=${x('copied')} disabled=${!ctx.cortexPrompt} onCopied=${() => ctx.showToast?.(x('promptCopiedToast'))} />`;
  return html`
    <${Section} id="ex-cortex" title=${x('secCortex')} count=${ctx.cortexes ? (myCx.length ? myCx.length : x('cortexCountEmpty', { n: platformCx.length })) : null} actions=${actions}>
      ${!ctx.cortexes ? html`<${Text} tone="muted">${t('common.loading')}<//>` : html`
        <${Stack}>
          <${Toolbar} filters=${[
            facet('mine', F.who === 'mine', x('facetMine'), myCx.length, () => ctx.setCxFilter({ who: 'mine' })),
            facet('platform', F.who === 'platform', x('facetPlatform'), platformCx.length, () => ctx.setCxFilter({ who: 'platform' })),
            facet('others', F.who === 'others', x('facetOthersPublic'), publicOthers.length, () => ctx.setCxFilter({ who: 'others' })),
            facet('pub', !!F.pub, x('facetPublic'), pool.filter((c) => c.visibility === 'public').length, () => ctx.setCxFilter({ pub: !F.pub })),
            ...parts.map((p) => facet('p' + p, F.part === p, x('part.' + p), partCount(p), () => ctx.setCxFilter({ part: F.part === p ? '' : p }))),
          ]} />
          ${search(ctx.cxQuery, x('searchCortex'), (e) => ctx.setCxQuery(e.target.value))}
          ${!rows.length ? html`<${Text} tone="muted">${F.who === 'mine' && !myCx.length ? x('cortexEmpty') : x('noMatch')}<//>` : html`
            <${Stack} density="compact">${shown.map((c) => cortexRow(ctx, c))}<//>`}
          ${more(shown.length, rows.length, () => ctx.setCxShown(ctx.cxShown + PAGE))}
          <${Text} kind="caption" tone="muted">${x('cortexHint')}<//>
        <//>`}
    <//>`;
}

/* ── A new extension or cortex ────────────────────────────────────────────────────────────────── */

function secNew(ctx) {
  const f = ctx.form;
  return html`
    <${Section} id="ex-new" title=${x('secNew')}>
      <${Stack}>
        <div>
          <${KeyValue} label=${x('newAi')}>
            <${Stack} density="compact">
              <span>${x('newAiBody')}</span>
              <${Text} kind="caption" tone="muted">${x('newAiSub', { ext: fmtNum((ctx.extPrompt || '').length), cx: fmtNum((ctx.cortexPrompt || '').length) })}<//>
              <${Stack} direction="wrap" density="compact">
                <${CopyAction} kind="text" text=${ctx.extPrompt} label=${x('copyExtPrompt')} copiedLabel=${x('copied')} disabled=${!ctx.extPrompt} />
                <${CopyAction} kind="text" text=${ctx.cortexPrompt} label=${x('copyCortexPrompt')} copiedLabel=${x('copied')} disabled=${!ctx.cortexPrompt} />
                <${Action} kind="text" expanded=${ctx.shown === 'ext'} onClick=${() => ctx.toggleShow('ext')}>${ctx.shown === 'ext' ? x('hide') : x('showExtPrompt')}<//>
                <${Action} kind="text" expanded=${ctx.shown === 'cortex'} onClick=${() => ctx.toggleShow('cortex')}>${ctx.shown === 'cortex' ? x('hide') : x('showCortexPrompt')}<//>
              <//>
              ${ctx.shown ? html`<${Surface} kind="code" height="tall">${ctx.shown === 'ext' ? ctx.extPrompt : ctx.cortexPrompt}<//>` : null}
            <//>
          <//>
          <${KeyValue} label=${x('newFiles')} value=${x('newFilesBody')} />
        </div>
        <${Fold} title=${x('addFromFiles')} sub=${x('addFromFilesSub')} open=${f.open} onToggle=${() => ctx.setFormOpen(!f.open)}>
          <${Stack}>
            <${Stack} direction="horizontal" role="radiogroup" label=${x('secNew')}>
              <${Action} kind="tab" semantics="radio" selected=${f.kind === 'extension'} onClick=${() => ctx.setForm({ kind: 'extension' })}>${x('formExt')}<//>
              <${Action} kind="tab" semantics="radio" selected=${f.kind === 'cortex'} onClick=${() => ctx.setForm({ kind: 'cortex' })}>${x('formCortex')}<//>
            <//>
            <${Field} type="textarea" label=${x('manifest')} rows=${10} value=${f.manifest}
              placeholder=${f.kind === 'cortex' ? 'apiVersion: cortex.aimeat.org/v1\nkind: Extension\nmetadata:\n  name: my-cortex\n…' : 'metadata:\n  name: my-extension\n  version: 1.0.0\nactions:\n  - id: hello\n    script: actions/hello.js\n…'}
              onInput=${(e) => ctx.setForm({ manifest: e.target.value })} />
            ${f.files.map((file, i) => html`<${Columns} key=${'f' + i} layout="trailing" collapse=${640}>
              <${Field} label=${x('fileName')} value=${file.name} placeholder=${f.kind === 'cortex' ? 'my-cortex.js' : 'actions/hello.js'} onInput=${(e) => ctx.setFormFile(i, { name: e.target.value })} />
              <${Field} type="textarea" label=${x('fileCode')} rows=${6} value=${file.code} placeholder=${f.kind === 'cortex' ? '(function (A) { … })(window.AIMEAT = window.AIMEAT || {});' : 'export default async function(ctx, input) { … }'} onInput=${(e) => ctx.setFormFile(i, { code: e.target.value })} />
            <//>`)}
            <${Stack} direction="horizontal" align="end">
              <${Action} onClick=${() => ctx.addFormFile()}>${x('addFile')}<//>
              <${Action} disabled=${ctx.busy === 'install'} onClick=${() => ctx.installFromForm()}>${x('installActivate')}<//>
            <//>
          <//>
        <//>
      <//>
    <//>`;
}
