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
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, kindOf, crumb, pageLinks } from './frame.js';
import { extRow, cortexRow } from './rows.js';

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
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;

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
          <h1 class="og-title">${t('profile.tabs.extensions')}<small>${x('titleSub')}</small></h1>
          <div class="og-chips">
            ${none ? chip(x('chipNone'), 'og-chip--coral') : exts ? chip(x('chipExt', { n: mine.length })) : null}
            ${!none && cxs ? chip(x('chipCortex', { n: myCx.length })) : null}
            ${exts ? chip(x('chipOthers', { n: others.length }), 'og-chip--dim') : null}
          </div>
          <p class="og-desc">${none ? x('descEmpty') : x('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <${CopyButton} text=${ctx.extPrompt} className="og-slab" label=${x('createSlab')} copiedLabel=${x('copied')} disabled=${!ctx.extPrompt} onCopied=${() => ctx.showToast?.(x('promptCopiedToast'))} />
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => { ctx.setFormOpen(true); scrollTo('ex-new'); }}>${x('addFromFiles')}</button></div>
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

const facet = (on, label, n, onClick, key) => html`<button type="button" key=${key} class=${`ex-facet ${on ? 'is-on' : ''}`} onClick=${onClick}>${label}<em>${n}</em></button>`;
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
    <${Section} id="ex-ext" num=${num} title=${x('secExt')} count=${ctx.extensions ? mine.length : null} first=${num === '01'}>
      ${!ctx.extensions ? html`<p class="ex-empty">${t('common.loading')}</p>` : !mine.length && F.who !== 'others' ? html`
        <p class="ex-empty"><b>${x('extEmptyHead')}</b> ${x('extEmptyBody', { n: others.length })}</p>
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
        <div class="ex-search"><input class="og-input" type="search" value=${ctx.extQuery} placeholder=${x('searchExt')} aria-label=${x('searchExt')} onInput=${(e) => ctx.setExtQuery(e.target.value)} /><small>${x('searchOrder', { n: PAGE })}</small></div>
        ${!rows.length ? html`<p class="ex-empty">${x('noMatch')}</p>` : html`
          <div class="ex-pl">
            <div class="ex-p ex-p--head"><div>${x('colExt')}</div><div>${x('colDoes')}</div><div>${x('colUsedBy')}</div><div></div></div>
            ${shown.map((e) => extRow(ctx, e))}
          </div>`}
        <div class="ex-more">
          ${shown.length < rows.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setExtShown(ctx.extShown + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>
        <p class="ex-hint">${F.who === 'others' ? x('othersHint') : x('extHint')}</p>`}
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
  const doors = html`<${CopyButton} text=${ctx.cortexPrompt} className="og-door og-door--quiet" label=${x('copyCortexPrompt')} copiedLabel=${x('copied')} disabled=${!ctx.cortexPrompt} onCopied=${() => ctx.showToast?.(x('promptCopiedToast'))} />`;
  return html`
    <${Section} id="ex-cortex" num=${num} title=${x('secCortex')} count=${ctx.cortexes ? (myCx.length ? myCx.length : x('cortexCountEmpty', { n: platformCx.length })) : null} doors=${doors}>
      ${!ctx.cortexes ? html`<p class="ex-empty">${t('common.loading')}</p>` : html`
        <div class="ex-facets">
          ${facet(F.who === 'mine', x('facetMine'), myCx.length, () => ctx.setCxFilter({ who: 'mine' }), 'mine')}
          ${facet(F.who === 'platform', x('facetPlatform'), platformCx.length, () => ctx.setCxFilter({ who: 'platform' }), 'platform')}
          ${facet(F.who === 'others', x('facetOthersPublic'), publicOthers.length, () => ctx.setCxFilter({ who: 'others' }), 'others')}
          ${facet(!!F.pub, x('facetPublic'), pool.filter((c) => c.visibility === 'public').length, () => ctx.setCxFilter({ pub: !F.pub }), 'pub')}
          ${parts.map((p) => facet(F.part === p, x('part.' + p), partCount(p), () => ctx.setCxFilter({ part: F.part === p ? '' : p }), 'p' + p))}
        </div>
        <div class="ex-search"><input class="og-input" type="search" value=${ctx.cxQuery} placeholder=${x('searchCortex')} aria-label=${x('searchCortex')} onInput=${(e) => ctx.setCxQuery(e.target.value)} /><small>${x('searchOrder', { n: PAGE })}</small></div>
        ${!rows.length ? html`<p class="ex-empty">${F.who === 'mine' && !myCx.length ? x('cortexEmpty') : x('noMatch')}</p>` : html`
          <div class="ex-pl">
            <div class="ex-p ex-p--head"><div>${x('colCortex')}</div><div>${x('colGives')}</div><div>${x('colUsedBy')}</div><div></div></div>
            ${shown.map((c) => cortexRow(ctx, c))}
          </div>`}
        <div class="ex-more">
          ${shown.length < rows.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setCxShown(ctx.cxShown + PAGE)}>${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })}</button>` : null}
          <small>${x('shownOf', { shown: shown.length, total: rows.length })}</small>
        </div>
        <p class="ex-hint">${x('cortexHint')}</p>`}
    <//>`;
}

/* ── A new extension or cortex ────────────────────────────────────────────────────────────────── */

function secNew(ctx, num, first) {
  const f = ctx.form;
  return html`
    <${Section} id="ex-new" num=${num} title=${x('secNew')} count=${null} first=${first}>
      <div class="ex-kv ex-kv--wide">
        <div class="ex-k">${x('newAi')}</div><div class="ex-v">${x('newAiBody')}<small>${x('newAiSub', { ext: (ctx.extPrompt || '').length.toLocaleString(), cx: (ctx.cortexPrompt || '').length.toLocaleString() })} · <${CopyButton} text=${ctx.extPrompt} className="og-crumb-link" label=${x('copyExtPrompt')} copiedLabel=${x('copied')} disabled=${!ctx.extPrompt} /> · <${CopyButton} text=${ctx.cortexPrompt} className="og-crumb-link" label=${x('copyCortexPrompt')} copiedLabel=${x('copied')} disabled=${!ctx.cortexPrompt} /> · <button type="button" class="og-crumb-link ex-linkbtn" onClick=${() => ctx.toggleShow('ext')}>${ctx.shown === 'ext' ? x('hide') : x('showExtPrompt')}</button> · <button type="button" class="og-crumb-link ex-linkbtn" onClick=${() => ctx.toggleShow('cortex')}>${ctx.shown === 'cortex' ? x('hide') : x('showCortexPrompt')}</button></small></div>
        ${ctx.shown ? html`<div class="ex-k"></div><div class="ex-v"><pre class="ex-out ex-out--tall">${ctx.shown === 'ext' ? ctx.extPrompt : ctx.cortexPrompt}</pre></div>` : null}
        <div class="ex-k">${x('newFiles')}</div><div class="ex-v">${x('newFilesBody')}</div>
      </div>
      <button type="button" class="ex-fold" aria-expanded=${f.open ? 'true' : 'false'} onClick=${() => ctx.setFormOpen(!f.open)}><i>${f.open ? '↓' : '→'}</i>${x('addFromFiles')}<span class="ex-fold-r">${x('addFromFilesSub')}</span></button>
      ${f.open ? html`
        <div class="ex-form">
          <div class="ex-choice">
            <button type="button" class=${`og-choice-btn ${f.kind === 'extension' ? 'is-on' : ''}`} onClick=${() => ctx.setForm({ kind: 'extension' })}>${x('formExt')}</button>
            <button type="button" class=${`og-choice-btn ${f.kind === 'cortex' ? 'is-on' : ''}`} onClick=${() => ctx.setForm({ kind: 'cortex' })}>${x('formCortex')}</button>
          </div>
          <label class="ex-field ex-field--wide"><span class="og-label">${x('manifest')}</span><textarea class="og-textarea" rows="10" value=${f.manifest} placeholder=${f.kind === 'cortex' ? 'apiVersion: cortex.aimeat.org/v1\nkind: Extension\nmetadata:\n  name: my-cortex\n…' : 'metadata:\n  name: my-extension\n  version: 1.0.0\nactions:\n  - id: hello\n    script: actions/hello.js\n…'} onInput=${(e) => ctx.setForm({ manifest: e.target.value })}></textarea></label>
          ${f.files.map((file, i) => html`
            <label class="ex-field" key=${'n' + i}><span class="og-label">${x('fileName')}</span><input class="og-input" value=${file.name} placeholder=${f.kind === 'cortex' ? 'my-cortex.js' : 'actions/hello.js'} onInput=${(e) => ctx.setFormFile(i, { name: e.target.value })} /></label>
            <label class="ex-field" key=${'c' + i}><span class="og-label">${x('fileCode')}</span><textarea class="og-textarea" rows="6" value=${file.code} placeholder=${f.kind === 'cortex' ? '(function (A) { … })(window.AIMEAT = window.AIMEAT || {});' : 'export default async function(ctx, input) { … }'} onInput=${(e) => ctx.setFormFile(i, { code: e.target.value })}></textarea></label>`)}
          <div class="ex-field--wide ex-form-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.addFormFile()}>${x('addFile')}</button>
            <button type="button" class="og-door" disabled=${ctx.busy === 'install'} onClick=${() => ctx.installFromForm()}>${x('installActivate')}</button>
          </div>
        </div>` : null}
    <//>`;
}
