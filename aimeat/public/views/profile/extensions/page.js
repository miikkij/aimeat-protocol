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
 *   v1.16.0 -- 2026-09-26 -- The prompt shown is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- A filter's count is the Count (.poster-count, tally), a unification: Jouni's decision "Count".
 *   v1.12.0 -- 2026-09-25 -- The line under each list (show more, how many shown) is the More line (.more-line, css/components/more-line.css), a library part by a move.
 *   v1.11.0 -- 2026-09-25 -- The facts of "a new one" are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- The row that opens the add-from-files form is the folded row (og-fold og-fold--toggle, its arrow at the right), a unification: the look most tabs use.
 *   v1.9.0 -- 2026-09-25 -- The server extensions and the cortexes are the Listing (listing, listing-row, its head row), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
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
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, kindOf, crumb, pageLinks } from './frame.js';
import { extRow, cortexRow } from './rows.js';
// Aliased: `num` is already the name of this page's section-number parameter.
import { num as fmtNum } from '/js/format.js';
import { Hint } from '/components/Hint.js';

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
  const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;

  const strip = html`
    <div class="og-strip">
      <div><b>${exts ? mine.length : '…'}</b><span>${x('stripExt')}</span><small>${exts ? (mine.length ? x('stripExtSub', { actions, active: mine.filter((e) => e.status === 'active').length }) : x('stripNone')) : ''}</small></div>
      <div><b>${cxs ? myCx.length : '…'}</b><span>${x('stripCortex')}</span><small>${cxs ? (myCx.length ? x('stripCortexSub', { pub: myCx.filter((c) => c.visibility === 'public').length }) : x('stripNone')) : ''}</small></div>
      <div><b>${exts ? others.length : '…'}</b><span>${x('stripOthersExt')}</span><small>${x('stripOthersExtSub')}</small></div>
      <div><b>${cxs ? otherCx.length : '…'}</b><span>${x('stripOthersCortex')}</span><small>${cxs ? x('stripOthersCortexSub', { platform: platformCx.length, pub: otherCx.length - platformCx.length }) : ''}</small></div>
    </div>`;

  const railItems = none
    ? [['01', 'ex-new', x('secNew'), ''], ['02', 'ex-ext', x('secExt'), 0], ['03', 'ex-cortex', x('secCortex'), platformCx.length]]
    : [['01', 'ex-ext', x('secExt'), exts ? mine.length : ''], ['02', 'ex-cortex', x('secCortex'), cxs ? myCx.length : ''], ['03', 'ex-new', x('secNew'), '']];

  return html`
    <div class="og og-ext">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('profile.tabs.extensions')}<small>${x('titleSub')}</small></h1>
          <div class="poster-chips">
            ${none ? chip(x('chipNone'), 'poster-chip--coral') : exts ? chip(x('chipExt', { n: mine.length })) : null}
            ${!none && cxs ? chip(x('chipCortex', { n: myCx.length })) : null}
            ${exts ? chip(x('chipOthers', { n: others.length })) : null}
          </div>
          <p class="og-desc">${none ? x('descEmpty') : x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <${CopyButton} text=${ctx.extPrompt} className="poster-slab poster-slab--control" label=${x('createSlab')} copiedLabel=${x('copied')} disabled=${!ctx.extPrompt} onCopied=${() => ctx.showToast?.(x('promptCopiedToast'))} />
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => { ctx.setFormOpen(true); scrollTo('ex-new'); }}>${x('addFromFiles')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${none ? html`${secNew(ctx, '01', true)}${secExtensions(ctx, mine, others, '02')}${secCortexes(ctx, myCx, otherCx, platformCx, '03')}`
            : html`${secExtensions(ctx, mine, others, '01')}${secCortexes(ctx, myCx, otherCx, platformCx, '02')}${secNew(ctx, '03', false)}`}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${railItems.map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`poster-tab poster-tab--filter ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<span class="poster-count poster-count--tally">${n}</span></button>`;
const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));

/* ── Server extensions ────────────────────────────────────────────────────────────────────────── */

function secExtensions(ctx, mine, others, num) {
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
    <${PageSection} id="ex-ext" num=${num} title=${x('secExt')} count=${ctx.extensions ? mine.length : null} first=${num === '01'}>
      ${!ctx.extensions ? html`<p class="poster-quiet ex-empty loading-mark">${t('common.loading')}</p>` : !mine.length && F.who !== 'others' ? html`
        <p class="poster-quiet ex-empty"><b>${x('extEmptyHead')}</b> ${x('extEmptyBody', { n: others.length })}</p>
        <div class="ex-facets">${facet(false, x('facetOthers'), others.length, () => ctx.setExtFilter({ who: 'others' }), 'others')}</div>` : html`
        <div class="ex-facets">
          ${facet(F.who !== 'others', x('facetMine'), mine.length, () => ctx.setExtFilter({ who: 'mine' }), 'mine')}
          ${facet(F.who === 'others', x('facetOthers'), others.length, () => ctx.setExtFilter({ who: 'others' }), 'others')}
          ${facet(F.state === 'active', x('facetActive'), count((e) => e.status === 'active'), () => ctx.setExtFilter({ state: F.state === 'active' ? '' : 'active' }), 'active')}
          ${facet(F.state === 'off', x('facetOff'), count((e) => e.status !== 'active'), () => ctx.setExtFilter({ state: F.state === 'off' ? '' : 'off' }), 'off')}
          ${facet(F.kind === 'apps', x('facetApps'), count((e) => kindOf(e) === 'apps'), () => ctx.setExtFilter({ kind: F.kind === 'apps' ? '' : 'apps' }), 'apps')}
          ${facet(F.kind === 'background', x('facetBackground'), count((e) => kindOf(e) === 'background'), () => ctx.setExtFilter({ kind: F.kind === 'background' ? '' : 'background' }), 'bg')}
          ${facet(F.kind === 'unseen', x('facetUnseen'), count((e) => kindOf(e) === 'unseen'), () => ctx.setExtFilter({ kind: F.kind === 'unseen' ? '' : 'unseen' }), 'unseen')}
          ${facet(!!F.instances, x('facetInstances'), count((e) => e.instances?.supported), () => ctx.setExtFilter({ instances: !F.instances }), 'inst')}
        </div>
        <div class="search-line"><input class="og-input" type="search" value=${ctx.extQuery} placeholder=${x('searchExt')} aria-label=${x('searchExt')} onInput=${(e) => ctx.setExtQuery(e.target.value)} /><small>${x('searchOrder', { n: PAGE })}</small></div>
        ${!rows.length ? html`<p class="poster-quiet ex-empty">${x('noMatch')}</p>` : html`
          <div class="listing listing--name-desc-use-doors">
            <div class="listing-row listing-row--head"><div class="poster-label">${x('colExt')}</div><div class="poster-label">${x('colDoes')}</div><div class="poster-label">${x('colUsedBy')}</div><div class="poster-label"></div></div>
            ${shown.map((e) => extRow(ctx, e))}
          </div>`}
        <div class="more-line">
          ${shown.length < rows.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setExtShown(ctx.extShown + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>
        <${Hint}>${F.who === 'others' ? x('othersHint') : x('extHint')}<//>`}
    <//>`;
}

/* ── Cortexes ─────────────────────────────────────────────────────────────────────────────────── */

function secCortexes(ctx, myCx, otherCx, platformCx, num) {
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
  const doors = html`<${CopyButton} text=${ctx.cortexPrompt} className="poster-action poster-action--small poster-action--lower" label=${x('copyCortexPrompt')} copiedLabel=${x('copied')} disabled=${!ctx.cortexPrompt} onCopied=${() => ctx.showToast?.(x('promptCopiedToast'))} />`;
  return html`
    <${PageSection} id="ex-cortex" num=${num} title=${x('secCortex')} count=${ctx.cortexes ? (myCx.length ? myCx.length : x('cortexCountEmpty', { n: platformCx.length })) : null} doors=${doors}>
      ${!ctx.cortexes ? html`<p class="poster-quiet ex-empty loading-mark">${t('common.loading')}</p>` : html`
        <div class="ex-facets">
          ${facet(F.who === 'mine', x('facetMine'), myCx.length, () => ctx.setCxFilter({ who: 'mine' }), 'mine')}
          ${facet(F.who === 'platform', x('facetPlatform'), platformCx.length, () => ctx.setCxFilter({ who: 'platform' }), 'platform')}
          ${facet(F.who === 'others', x('facetOthersPublic'), publicOthers.length, () => ctx.setCxFilter({ who: 'others' }), 'others')}
          ${facet(!!F.pub, x('facetPublic'), pool.filter((c) => c.visibility === 'public').length, () => ctx.setCxFilter({ pub: !F.pub }), 'pub')}
          ${parts.map((p) => facet(F.part === p, x('part.' + p), partCount(p), () => ctx.setCxFilter({ part: F.part === p ? '' : p }), 'p' + p))}
        </div>
        <div class="search-line"><input class="og-input" type="search" value=${ctx.cxQuery} placeholder=${x('searchCortex')} aria-label=${x('searchCortex')} onInput=${(e) => ctx.setCxQuery(e.target.value)} /><small>${x('searchOrder', { n: PAGE })}</small></div>
        ${!rows.length ? html`<p class="poster-quiet ex-empty">${F.who === 'mine' && !myCx.length ? x('cortexEmpty') : x('noMatch')}</p>` : html`
          <div class="listing listing--name-desc-use-doors">
            <div class="listing-row listing-row--head"><div class="poster-label">${x('colCortex')}</div><div class="poster-label">${x('colGives')}</div><div class="poster-label">${x('colUsedBy')}</div><div class="poster-label"></div></div>
            ${shown.map((c) => cortexRow(ctx, c))}
          </div>`}
        <div class="more-line">
          ${shown.length < rows.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setCxShown(ctx.cxShown + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>
        <${Hint}>${x('cortexHint')}<//>`}
    <//>`;
}

/* ── A new extension or cortex ────────────────────────────────────────────────────────────────── */

function secNew(ctx, num, first) {
  const f = ctx.form;
  return html`
    <${PageSection} id="ex-new" num=${num} title=${x('secNew')} count=${null} first=${first}>
      <div class="facts facts--wide ex-kv--wide">
        <div class="facts-k poster-label">${x('newAi')}</div><div class="facts-v">${x('newAiBody')}<small>${x('newAiSub', { ext: fmtNum((ctx.extPrompt || '').length), cx: fmtNum((ctx.cortexPrompt || '').length) })} · <${CopyButton} text=${ctx.extPrompt} className="og-crumb-link" label=${x('copyExtPrompt')} copiedLabel=${x('copied')} disabled=${!ctx.extPrompt} /> · <${CopyButton} text=${ctx.cortexPrompt} className="og-crumb-link" label=${x('copyCortexPrompt')} copiedLabel=${x('copied')} disabled=${!ctx.cortexPrompt} /> · <button type="button" class="poster-action poster-action--more" onClick=${() => ctx.toggleShow('ext')}>${ctx.shown === 'ext' ? x('hide') : x('showExtPrompt')}</button> · <button type="button" class="poster-action poster-action--more" onClick=${() => ctx.toggleShow('cortex')}>${ctx.shown === 'cortex' ? x('hide') : x('showCortexPrompt')}</button></small></div>
        ${ctx.shown ? html`<div class="facts-k poster-label"></div><div class="facts-v"><pre class="code-block ex-out ex-out--tall">${ctx.shown === 'ext' ? ctx.extPrompt : ctx.cortexPrompt}</pre></div>` : null}
        <div class="facts-k poster-label">${x('newFiles')}</div><div class="facts-v">${x('newFilesBody')}</div>
      </div>
      <button type="button" class="og-fold og-fold--toggle ex-fold" aria-expanded=${f.open ? 'true' : 'false'} onClick=${() => ctx.setFormOpen(!f.open)}><span>${x('addFromFiles')}</span><span class="og-fold-r">${x('addFromFilesSub')}</span><span class="og-fold-arrow">${f.open ? '↓' : '→'}</span></button>
      ${f.open ? html`
        <div class="ex-form">
          <div class="ex-choice">
            <button type="button" class=${`poster-tab ${f.kind === 'extension' ? 'is-on' : ''}`} onClick=${() => ctx.setForm({ kind: 'extension' })}>${x('formExt')}</button>
            <button type="button" class=${`poster-tab ${f.kind === 'cortex' ? 'is-on' : ''}`} onClick=${() => ctx.setForm({ kind: 'cortex' })}>${x('formCortex')}</button>
          </div>
          <label class="ex-field ex-field--wide"><span class="poster-label">${x('manifest')}</span><textarea class="og-textarea" rows="10" value=${f.manifest} placeholder=${f.kind === 'cortex' ? 'apiVersion: cortex.aimeat.org/v1\nkind: Extension\nmetadata:\n  name: my-cortex\n…' : 'metadata:\n  name: my-extension\n  version: 1.0.0\nactions:\n  - id: hello\n    script: actions/hello.js\n…'} onInput=${(e) => ctx.setForm({ manifest: e.target.value })}></textarea></label>
          ${f.files.map((file, i) => html`
            <label class="ex-field" key=${'n' + i}><span class="poster-label">${x('fileName')}</span><input class="og-input" value=${file.name} placeholder=${f.kind === 'cortex' ? 'my-cortex.js' : 'actions/hello.js'} onInput=${(e) => ctx.setFormFile(i, { name: e.target.value })} /></label>
            <label class="ex-field" key=${'c' + i}><span class="poster-label">${x('fileCode')}</span><textarea class="og-textarea" rows="6" value=${file.code} placeholder=${f.kind === 'cortex' ? '(function (A) { … })(window.AIMEAT = window.AIMEAT || {});' : 'export default async function(ctx, input) { … }'} onInput=${(e) => ctx.setFormFile(i, { code: e.target.value })}></textarea></label>`)}
          <div class="ex-field--wide ex-form-doors">
            <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.addFormFile()}>${x('addFile')}</button>
            <button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'install'} onClick=${() => ctx.installFromForm()}>${x('installActivate')}</button>
          </div>
        </div>` : null}
    <//>`;
}
