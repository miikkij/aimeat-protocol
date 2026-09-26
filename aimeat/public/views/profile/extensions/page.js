/**
 * @file public/views/profile/extensions/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Extensions page in the poster face: the builder's catalogue of building blocks.
 *   The mast and the strip; the server extensions as rows (yours first, the others' behind a
 *   filter; what each does, who uses it, its actions) with a filter row and a search; the cortexes
 *   the same way; and how a new one starts (the two prompts from the node, the install form). What
 *   opens under a row is rows.js. Pure render over the ctx bag, made of the component kit: the page
 *   passes data and never a class.
 * @structure renderPage · secExtensions · secCortexes · secNew
 * @usage import { renderPage } from './extensions/page.js';
 * @version-history
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): the frame
 *     is SettingsPage (crumb, head, marks, strip, rail as data), the strip FigureStrip, the filters
 *     Filters and Filter, the searches SearchLine, the lists the List, "show more" the More line,
 *     a new one's facts the Facts (the copies are Action links with `copy`, the prompt the Code
 *     block), the row that opens the install form the folded row (FoldRow toggle), the form Fields
 *     with a Choice, TextArea and TextField, its foot FormActions. The others' count is the dim Tag
 *     again (main's og-chip--dim, which the previous branch lost).
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
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Filters, Filter, SearchLine, More } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Fields, FormActions } from '/components/Field.js';
import { Choice } from '/components/Choice.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Space } from '/components/Layout.js';
import { scrollToSection } from '/components/Rail.js';
import { x, kindOf, crumb, pageLinks } from './frame.js';
import { extRow, cortexRow } from './rows.js';
// Aliased: `num` is already the name of this page's section-number parameter.
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

  const strip = html`<${FigureStrip} items=${[
    { key: 'ext', n: exts ? mine.length : '…', label: x('stripExt'), sub: exts ? (mine.length ? x('stripExtSub', { actions, active: mine.filter((e) => e.status === 'active').length }) : x('stripNone')) : '' },
    { key: 'cx', n: cxs ? myCx.length : '…', label: x('stripCortex'), sub: cxs ? (myCx.length ? x('stripCortexSub', { pub: myCx.filter((c) => c.visibility === 'public').length }) : x('stripNone')) : '' },
    { key: 'oext', n: exts ? others.length : '…', label: x('stripOthersExt'), sub: x('stripOthersExtSub') },
    { key: 'ocx', n: cxs ? otherCx.length : '…', label: x('stripOthersCortex'), sub: cxs ? x('stripOthersCortexSub', { platform: platformCx.length, pub: otherCx.length - platformCx.length }) : '' },
  ]} />`;

  const marks = [
    none ? { label: x('chipNone'), tone: 'coral' } : exts ? { label: x('chipExt', { n: mine.length }) } : null,
    !none && cxs ? { label: x('chipCortex', { n: myCx.length }) } : null,
    exts ? { label: x('chipOthers', { n: others.length }), tone: 'dim' } : null,
  ];

  const mast = html`
    <${Loud} control copy=${ctx.extPrompt} copiedLabel=${x('copied')} disabled=${!ctx.extPrompt} onCopied=${() => ctx.showToast?.(x('promptCopiedToast'))}>${x('createSlab')}<//>
    <${Actions}><${Action} small onClick=${() => { ctx.setFormOpen(true); scrollToSection('ex-new'); }}>${x('addFromFiles')}<//><//>`;

  const sections = none
    ? [{ id: 'ex-new', num: '01', label: x('secNew'), count: '' }, { id: 'ex-ext', num: '02', label: x('secExt'), count: 0 }, { id: 'ex-cortex', num: '03', label: x('secCortex'), count: platformCx.length }]
    : [{ id: 'ex-ext', num: '01', label: x('secExt'), count: exts ? mine.length : '' }, { id: 'ex-cortex', num: '02', label: x('secCortex'), count: cxs ? myCx.length : '' }, { id: 'ex-new', num: '03', label: x('secNew'), count: '' }];

  return html`
    <${SettingsPage} name="ext" crumb=${crumb()} title=${t('profile.tabs.extensions')} sub=${x('titleSub')} marks=${marks}
      desc=${none ? x('descEmpty') : x('desc')} actions=${mast} strip=${strip}
      railTitle=${x('railTitle')} sections=${sections} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${none ? html`${secNew(ctx, '01', true)}${secExtensions(ctx, mine, others, '02')}${secCortexes(ctx, myCx, otherCx, platformCx, '03')}`
        : html`${secExtensions(ctx, mine, others, '01')}${secCortexes(ctx, myCx, otherCx, platformCx, '02')}${secNew(ctx, '03', false)}`}
    <//>`;
}

const facet = (on, label, n, onClick, key) => html`<${Filter} key=${key} on=${on} count=${n} onClick=${onClick}>${label}<//>`;
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
      ${!ctx.extensions ? html`<${List} loading=${t('common.loading')} />` : !mine.length && F.who !== 'others' ? html`
        <${List} rows=${[]} empty=${html`<${Note} kind="quiet"><b>${x('extEmptyHead')}</b> ${x('extEmptyBody', { n: others.length })}<//>`} />
        <${Filters}>${facet(false, x('facetOthers'), others.length, () => ctx.setExtFilter({ who: 'others' }), 'others')}<//>` : html`
        <${Filters}>
          ${facet(F.who !== 'others', x('facetMine'), mine.length, () => ctx.setExtFilter({ who: 'mine' }), 'mine')}
          ${facet(F.who === 'others', x('facetOthers'), others.length, () => ctx.setExtFilter({ who: 'others' }), 'others')}
          ${facet(F.state === 'active', x('facetActive'), count((e) => e.status === 'active'), () => ctx.setExtFilter({ state: F.state === 'active' ? '' : 'active' }), 'active')}
          ${facet(F.state === 'off', x('facetOff'), count((e) => e.status !== 'active'), () => ctx.setExtFilter({ state: F.state === 'off' ? '' : 'off' }), 'off')}
          ${facet(F.kind === 'apps', x('facetApps'), count((e) => kindOf(e) === 'apps'), () => ctx.setExtFilter({ kind: F.kind === 'apps' ? '' : 'apps' }), 'apps')}
          ${facet(F.kind === 'background', x('facetBackground'), count((e) => kindOf(e) === 'background'), () => ctx.setExtFilter({ kind: F.kind === 'background' ? '' : 'background' }), 'bg')}
          ${facet(F.kind === 'unseen', x('facetUnseen'), count((e) => kindOf(e) === 'unseen'), () => ctx.setExtFilter({ kind: F.kind === 'unseen' ? '' : 'unseen' }), 'unseen')}
          ${facet(!!F.instances, x('facetInstances'), count((e) => e.instances?.supported), () => ctx.setExtFilter({ instances: !F.instances }), 'inst')}
        <//>
        <${SearchLine} value=${ctx.extQuery} placeholder=${x('searchExt')} onInput=${(e) => ctx.setExtQuery(e.target.value)} note=${x('searchOrder', { n: PAGE })} />
        <${List} cols="name-desc-use-doors" empty=${x('noMatch')} head=${[x('colExt'), x('colDoes'), x('colUsedBy'), '']}>
          ${shown.map((e) => extRow(ctx, e))}
        <//>
        <${More} label=${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })} onMore=${shown.length < rows.length ? () => ctx.setExtShown(ctx.extShown + PAGE) : null}
          note=${x('shownOf', { shown: shown.length, total: rows.length })} />
        <${Note}>${F.who === 'others' ? x('othersHint') : x('extHint')}<//>`}
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
  const doors = html`<${Action} small soft copy=${ctx.cortexPrompt} copiedLabel=${x('copied')} disabled=${!ctx.cortexPrompt} onCopied=${() => ctx.showToast?.(x('promptCopiedToast'))}>${x('copyCortexPrompt')}<//>`;
  return html`
    <${Section} id="ex-cortex" num=${num} title=${x('secCortex')} count=${ctx.cortexes ? (myCx.length ? myCx.length : x('cortexCountEmpty', { n: platformCx.length })) : null} doors=${doors}>
      ${!ctx.cortexes ? html`<${List} loading=${t('common.loading')} />` : html`
        <${Filters}>
          ${facet(F.who === 'mine', x('facetMine'), myCx.length, () => ctx.setCxFilter({ who: 'mine' }), 'mine')}
          ${facet(F.who === 'platform', x('facetPlatform'), platformCx.length, () => ctx.setCxFilter({ who: 'platform' }), 'platform')}
          ${facet(F.who === 'others', x('facetOthersPublic'), publicOthers.length, () => ctx.setCxFilter({ who: 'others' }), 'others')}
          ${facet(!!F.pub, x('facetPublic'), pool.filter((c) => c.visibility === 'public').length, () => ctx.setCxFilter({ pub: !F.pub }), 'pub')}
          ${parts.map((p) => facet(F.part === p, x('part.' + p), partCount(p), () => ctx.setCxFilter({ part: F.part === p ? '' : p }), 'p' + p))}
        <//>
        <${SearchLine} value=${ctx.cxQuery} placeholder=${x('searchCortex')} onInput=${(e) => ctx.setCxQuery(e.target.value)} note=${x('searchOrder', { n: PAGE })} />
        <${List} cols="name-desc-use-doors" empty=${F.who === 'mine' && !myCx.length ? x('cortexEmpty') : x('noMatch')} head=${[x('colCortex'), x('colGives'), x('colUsedBy'), '']}>
          ${shown.map((c) => cortexRow(ctx, c))}
        <//>
        <${More} label=${x('showMore', { n: Math.min(PAGE, rows.length - shown.length) })} onMore=${shown.length < rows.length ? () => ctx.setCxShown(ctx.cxShown + PAGE) : null}
          note=${x('shownOf', { shown: shown.length, total: rows.length })} />
        <${Note}>${x('cortexHint')}<//>`}
    <//>`;
}

/* ── A new extension or cortex ────────────────────────────────────────────────────────────────── */

function secNew(ctx, num, first) {
  const f = ctx.form;
  const copyLink = (text, label) => html`<${Action} tone="link" copy=${text} copiedLabel=${x('copied')} disabled=${!text}>${label}<//>`;
  return html`
    <${Section} id="ex-new" num=${num} title=${x('secNew')} count=${null} first=${first}>
      <${Facts} wide flush rows=${[
        {
          k: x('newAi'),
          v: x('newAiBody'),
          sub: html`${x('newAiSub', { ext: fmtNum((ctx.extPrompt || '').length), cx: fmtNum((ctx.cortexPrompt || '').length) })} · ${copyLink(ctx.extPrompt, x('copyExtPrompt'))} · ${copyLink(ctx.cortexPrompt, x('copyCortexPrompt'))} · <${Action} tone="more" onClick=${() => ctx.toggleShow('ext')}>${ctx.shown === 'ext' ? x('hide') : x('showExtPrompt')}<//> · <${Action} tone="more" onClick=${() => ctx.toggleShow('cortex')}>${ctx.shown === 'cortex' ? x('hide') : x('showCortexPrompt')}<//>`,
        },
        ctx.shown && { key: 'shown', k: '', v: html`<${Code} block tall>${ctx.shown === 'ext' ? ctx.extPrompt : ctx.cortexPrompt}<//>` },
        { k: x('newFiles'), v: x('newFilesBody') },
      ]} />
      <${Space} above="large">
        <${Folds}>
          <${FoldRow} kind="toggle" name=${x('addFromFiles')} right=${x('addFromFilesSub')} open=${!!f.open} onClick=${() => ctx.setFormOpen(!f.open)} />
        <//>
      <//>
      ${f.open ? html`
        <${Space} above="medium">
          <${Fields} cols=${2}>
            <${Choice} wide value=${f.kind} onChange=${(v) => ctx.setForm({ kind: v })}
              options=${[['extension', x('formExt')], ['cortex', x('formCortex')]]} />
            <${TextArea} wide label=${x('manifest')} rows=${10} value=${f.manifest}
              placeholder=${f.kind === 'cortex' ? 'apiVersion: cortex.aimeat.org/v1\nkind: Extension\nmetadata:\n  name: my-cortex\n…' : 'metadata:\n  name: my-extension\n  version: 1.0.0\nactions:\n  - id: hello\n    script: actions/hello.js\n…'}
              onInput=${(v) => ctx.setForm({ manifest: v })} />
            ${f.files.map((file, i) => html`
              <${TextField} key=${'n' + i} label=${x('fileName')} value=${file.name} placeholder=${f.kind === 'cortex' ? 'my-cortex.js' : 'actions/hello.js'} onInput=${(v) => ctx.setFormFile(i, { name: v })} />
              <${TextArea} key=${'c' + i} label=${x('fileCode')} rows=${6} value=${file.code} placeholder=${f.kind === 'cortex' ? '(function (A) { … })(window.AIMEAT = window.AIMEAT || {});' : 'export default async function(ctx, input) { … }'} onInput=${(v) => ctx.setFormFile(i, { code: v })} />`)}
          <//>
          <${Space} above="large">
            <${FormActions} apart>
              <${Action} small soft onClick=${() => ctx.addFormFile()}>${x('addFile')}<//>
              <${Action} small disabled=${ctx.busy === 'install'} onClick=${() => ctx.installFromForm()}>${x('installActivate')}<//>
            <//>
          <//>
        <//>` : null}
    <//>`;
}
