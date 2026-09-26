/**
 * @file public/views/profile/apps/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Apps page in the poster face (design canvas "AIMEAT Sovellukset-sivu",
 *   direction A): the mast and the strip; what waits for the owner (drafts to publish or discard,
 *   with the lines they change, and the apps acting in the owner's name, with their permissions);
 *   the condition rows, each a number that opens the launcher on exactly those apps; the six apps
 *   that changed last; then the agents-and-skills and build-new sections from build.js; and the
 *   rail. A person with no apps yet gets the same page with the first step on top. Pure render
 *   over the ctx bag.
 * @structure renderPage · secWaiting · secKunto · secNewest · secFirst
 * @usage import { renderPage } from './apps/page.js';
 * @version-history
 *   v1.16.0 -- 2026-09-26 -- A version's added and removed lines are the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- An app's rights in your name are the Tag (.poster-chip, plain, in .poster-chips), a unification: Jouni's decision "Tag".
 *   v1.12.0 -- 2026-09-25 -- The apps that changed last are the Listing (listing, listing-row with its head row, and its name, words and doors cells), a unification: the look most tabs use. The initials box, the note and the open count sit in plain cells.
 *   v1.11.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.10.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.9.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.6.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.5.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.4.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.3.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-02 — Initial.
 *   v1.2.0 — 2026-09-08 — The builders section: who else may build these apps.
 *   v1.1.0 — 2026-09-03 — A newest row says what the app needs (requiresLine): the cortexes it loads and the extensions it calls, with a pinned version after the at sign.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { num as fmtNum } from '/js/format.js';
import { CopyButton } from '/components/CopyButton.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { a, day, rel, kb, nameOf, appRef, appUrl, catalogUrl, noteFor, initials, crumb, pageLinks, goTab } from './frame.js';
import { secAgents, secBuild } from './build.js';
import { CollaborationSection, PublishDialog } from './collaboration.js';
import { secBuilders } from './builders.js';
import { Hint } from '/components/Hint.js';

export function renderPage(ctx) {
  const apps = ctx.apps || [];
  const loading = ctx.apps === null;
  const none = !loading && apps.length === 0;
  const drafts = apps.filter((x) => x.has_draft);
  const grants = ctx.grants || [];
  const waiting = drafts.length + grants.length;
  const listed = apps.filter((x) => !x.parked && !x.operator_hidden).length;
  const opens = apps.reduce((s, x) => s + (x.downloads || 0), 0);
  const top = [...apps].sort((p, q) => (q.downloads || 0) - (p.downloads || 0)).slice(0, 2);
  const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;
  const fmt = (n) => fmtNum(n);

  const strip = none ? html`
    <div class="og-strip">
      <div><b>0</b><span>${a('stripApps')}</span><small>${a('stripNone')}</small></div>
      <div><b>0</b><span>${a('stripDrafts')}</span><small>${a('stripNone')}</small></div>
      <div><b>0</b><span>${a('stripOpens')}</span><small>${a('stripNone')}</small></div>
      <div><b>${ctx.community}</b><span>${a('stripCommunity')}</span><small>${a('stripCommunitySub', { n: ctx.communityOwners })}</small></div>
    </div>` : html`
    <div class="og-strip">
      <div><b>${apps.length}</b><span>${a('stripApps')}</span><small>${a('stripAppsSub', { listed, unlisted: apps.length - listed })}</small></div>
      <div><b class=${drafts.length ? 'og-strip-coral' : ''}>${drafts.length}</b><span>${a('stripDrafts')}</span><small>${drafts.length ? drafts.map(nameOf).slice(0, 2).join(' · ') : a('stripDraftsNone')}</small></div>
      <div><b>${fmt(opens)}</b><span>${a('stripOpens')}</span><small>${top.length ? top.map((x) => `${nameOf(x)} ${fmt(x.downloads || 0)}`).join(' · ') : a('stripNone')}</small></div>
      <div><b>${grants.length}</b><span>${a('stripGrants')}</span><small>${grants.length ? grants.map((g) => g.app_name || g.app).slice(0, 2).join(' · ') : a('stripGrantsNone')}</small></div>
    </div>`;

  const railItems = none
    ? [['01', 'ap-first', a('secFirst'), ''], ['02', 'ap-waiting', a('secWaiting'), 0], ['03', 'ap-kunto', a('secKunto'), ''], ['04', 'ap-build', a('uploadLabel'), '']]
    : [['01', 'ap-waiting', a('secWaiting'), waiting], ['02', 'ap-kunto', a('secKunto'), ''], ['03', 'ap-newest', a('secNewest'), Math.min(apps.length, 6)], ['04', 'ap-agents', a('secAgents'), ''], ['05', 'ap-build', a('secBuild'), ''], ['06', 'ap-builders', a('secBuilders'), '']];

  return html`
    <div class="og og-apps">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('profile.tabs.apps')}<small>${a('titleSub')}</small></h1>
          <div class="poster-chips">
            ${none ? chip(a('chipNone'), 'poster-chip--coral') : chip(a('chipCount', { n: apps.length }))}
            ${none ? chip(a('chipFirst')) : drafts.length ? chip(a('chipDrafts', { n: drafts.length }), 'poster-chip--coral') : null}
            ${none ? null : chip(a('chipOpens', { n: fmt(opens) }))}
          </div>
          <p class="og-desc">${none ? a('descEmpty') : a('desc')}</p>
        </div>
        <div class="og-mast-actions">
          ${none
            ? html`<${CopyButton} text=${ctx.buildPrompt} className="poster-slab poster-slab--control" label=${a('promptDoor')} copiedLabel=${a('promptCopied')} disabled=${!ctx.buildPrompt} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))} />
              <div class="og-doors">
                <button type="button" class="poster-action poster-action--small" onClick=${() => scrollTo('ap-build')}>${a('uploadDoor')}</button>
                <a class="poster-action poster-action--small poster-action--lower" href=${catalogUrl()} target="_blank" rel="noopener">${a('catalogDoor')}</a>
              </div>`
            : html`<a class="poster-slab" href=${catalogUrl()} target="_blank" rel="noopener">${a('catalogDoor')}</a>
              <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => scrollTo('ap-build')}>${a('uploadDoor')}</button></div>`}
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${none ? html`${secFirst(ctx)}${secWaiting(ctx, drafts, grants, '02')}${secKunto(ctx, '03')}${secBuild(ctx, { formOnly: true, num: '04' })}`
            : loading ? html`<p class="poster-quiet loading-mark">${t('common.loading')}</p>`
            : html`${secWaiting(ctx, drafts, grants, '01')}${secKunto(ctx, '02')}${secNewest(ctx, apps)}${secAgents(ctx)}${secBuild(ctx, { formOnly: false, num: '05' })}${secBuilders(ctx)}`}
          ${!loading ? html`<${CollaborationSection} ctx=${ctx} />` : null}
        </div>
        <nav class="og-rail" aria-label=${a('railTitle')}>
          <span class="og-rail-label">${a('railTitle')}</span>
          ${railItems.map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${a('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
      ${ctx.publishApp ? html`<${PublishDialog} key=${appRef(ctx.publishApp)} app=${ctx.publishApp} busy=${!!ctx.busy} onPublish=${ctx.submitPublish} onClose=${ctx.closePublish} />` : null}
    </div>`;
}

/* ── 01 · What waits for you ─────────────────────────────────────────────────────────────────── */

function secWaiting(ctx, drafts, grants, num) {
  const waiting = drafts.length + grants.length;
  return html`
    <${PageSection} id="ap-waiting" num=${num} title=${a('secWaiting')} count=${waiting} first=${num === '01'}>
      ${!waiting ? html`<p class="poster-quiet ap-empty">${ctx.apps && ctx.apps.length ? a('waitingEmpty') : a('waitingEmptyNew')}</p>` : html`
        <div class="ap-rows">
          ${drafts.map((app) => draftRow(ctx, app))}
          ${grants.map((g) => grantRow(ctx, g))}
        </div>`}
      <${Hint}>${a('waitingHint')}<//>
    <//>`;
}

function draftRow(ctx, app) {
  const ref = appRef(app);
  const open = ctx.diff && ctx.diff.ref === ref;
  const busy = ctx.busy === ref;
  return html`
    <div class="ap-row" key=${'d' + ref}>
      <div class="ap-row-main">
        <b>${nameOf(app)}</b>
        <small>${a('draftMeta', { version: app.manifest?.version || '', date: day(app.created_at), opens: app.downloads || 0 })}</small>
      </div>
      <div class="ap-row-ctl">
        <span class="poster-status poster-status--attention">${a('draftChip')}</span>
        <button type="button" class="poster-action poster-action--small" disabled=${busy} onClick=${() => ctx.publishDraft(app)}>${a('publishDraft')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggleDiff(app)}>${open ? a('hideChanges') : a('viewChanges')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${busy} onClick=${() => ctx.discardDraft(app)}>${a('discardDraft')}</button>
      </div>
      ${open ? diffPanel(ctx.diff) : null}
    </div>`;
}

function diffPanel(diff) {
  if (diff.state === 'loading') return html`<div class="ap-panel poster-aside"><p class="poster-quiet ap-empty loading-mark">${a('diffLoading')}</p></div>`;
  if (diff.state === 'failed') return html`<div class="ap-panel poster-aside"><p class="poster-quiet ap-empty">${a('diffFailed')}</p></div>`;
  const d = diff.result;
  return html`
    <div class="ap-panel poster-aside">
      <p class="ap-panel-lead">${d.addedTotal || d.removedTotal ? a('diffTitle', { added: d.addedTotal, removed: d.removedTotal }) : a('diffNone')}</p>
      ${d.added.length ? html`<span class="poster-label">${a('diffAdded')}</span><pre class="code-block ap-code ap-code--add">${d.added.join('\n')}</pre>` : null}
      ${d.removed.length ? html`<span class="poster-label">${a('diffRemoved')}</span><pre class="code-block ap-code ap-code--del">${d.removed.join('\n')}</pre>` : null}
    </div>`;
}

function grantRow(ctx, g) {
  const open = ctx.openScopes === g.grant_id;
  const busy = ctx.busy === g.grant_id;
  return html`
    <div class="ap-row" key=${'g' + g.grant_id}>
      <div class="ap-row-main">
        <b>${g.app_name || g.app}</b>
        <small>${a('grantMeta', { n: (g.scopes || []).length, granted: day(g.granted_at), used: g.last_used_at ? rel(g.last_used_at) : a('grantNever') })}</small>
      </div>
      <div class="ap-row-ctl">
        <span class="poster-chip poster-chip--sun">${a('grantChip')}</span>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggleScopes(g)}>${open ? a('hideScopes') : a('viewScopes')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${busy} onClick=${() => ctx.revokeGrant(g)}>${a('revokeGrant')}</button>
      </div>
      ${open ? html`<div class="ap-panel poster-aside"><p class="og-lead">${a('scopesLead', { origin: g.app_origin || g.app })}</p><div class="poster-chips">${(g.scopes || []).map((s) => html`<span class="poster-chip" key=${s}>${s}</span>`)}</div></div>` : null}
    </div>`;
}

/* ── 02 · Condition ───────────────────────────────────────────────────────────────────────────── */

function secKunto(ctx, num) {
  const k = ctx.kunto;
  const facts = k?.facts || {};
  const sub = (key) => {
    if (key === 'noAi') return a('kunto.noAi.why', { uses: facts.usesAi || 0, discloses: facts.discloses || 0 });
    if (key === 'specOff') return a('kunto.specOff.why', { missing: facts.specMissing || 0, stale: facts.specStale || 0 });
    if (key === 'seoOff') return a('kunto.seoOff.why', { found: facts.seoOn || 0, unlisted: facts.unlisted || 0 });
    if (key === 'noSkill') return a('kunto.noSkill.why', { apps: facts.withSkill || 0, skills: facts.skills || 0 });
    return a('kunto.' + key + '.why');
  };
  const managePrompt = ctx.managePrompt();
  const doors = ctx.apps && ctx.apps.length
    ? html`<${CopyButton} text=${managePrompt} className="poster-action poster-action--small poster-action--lower" label=${a('manageDoor')} copiedLabel=${a('promptCopied')} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))} />`
    : null;
  return html`
    <${PageSection} id="ap-kunto" num=${num} title=${a('secKunto')} count=${ctx.apps && ctx.apps.length ? a('secKuntoSub', { n: ctx.apps.length }) : null} doors=${doors}>
      ${!ctx.apps || !ctx.apps.length ? html`<p class="poster-quiet ap-empty">${a('kuntoEmptyNew')}</p>`
        : !k.rows.length ? html`<p class="poster-quiet ap-empty"><b>${a('kuntoAllGood')}</b></p>` : html`
        <div class="ap-kn">
          ${k.rows.map((r) => html`
            <div class=${`ap-kn-n poster-stat-number poster-stat-number--small ${r.loud ? 'ap-kn-n--loud' : ''}`} key=${'n' + r.key}>${r.n}</div>
            <div class="ap-kn-w" key=${'w' + r.key}><b>${a('kunto.' + r.key + '.what')}</b><small>${sub(r.key)}</small></div>
            <div class="ap-kn-go" key=${'g' + r.key}><a class="poster-action poster-action--small poster-action--row poster-action--lower" href=${catalogUrl({ filter: r.key })} target="_blank" rel="noopener">${a('kuntoShow', { n: r.n })}</a></div>`)}
        </div>`}
      <${Hint}>${a('kuntoHint')}<//>
    <//>`;
}

/* ── 03 · Last changed ────────────────────────────────────────────────────────────────────────── */

function secNewest(ctx, apps) {
  const rows = [...apps].sort((p, q) => String(q.created_at || '').localeCompare(String(p.created_at || ''))).slice(0, 6);
  const grantRefs = new Set((ctx.grants || []).map((g) => g.app));
  const doors = html`<a class="poster-action poster-action--small poster-action--lower" href=${catalogUrl()} target="_blank" rel="noopener">${a('allInCatalog', { n: apps.length })}</a>`;
  return html`
    <${PageSection} id="ap-newest" num="03" title=${a('secNewest')} count=${rows.length} doors=${doors}>
      <div class="listing listing--cols listing--mark-name-desc-state-n-doors">
        <div class="listing-row listing-row--head"><div class="poster-label" aria-hidden="true"></div><div class="poster-label">${a('colApp')}</div><div class="poster-label">${a('colDesc')}</div><div class="poster-label">${a('colNote')}</div><div class="poster-label ap-head--r">${a('colOpens')}</div><div class="poster-label"></div></div>
        ${rows.map((app) => {
          const ref = appRef(app);
          const flags = ctx.kunto?.flags?.[ref] || {};
          const legal = app.manifest?.legal ? Object.keys(app.manifest.legal).length : 0;
          return html`
            <div class="listing-row" key=${ref}>
              <div><div class="ap-av poster-box poster-box--avatar poster-box--small" aria-hidden="true">${initials(nameOf(app))}</div></div>
              <div class="listing-name">${nameOf(app)}<small>${a('rowMeta', { version: app.manifest?.version || '', n: app.version_number || 1, date: day(app.created_at), size: kb(app.size) })}</small></div>
              <div class="listing-desc"><span class="ap-ds">${app.manifest?.descriptions?.[getLocale()] || app.manifest?.description || ''}${requiresLine(app)}</span></div>
              <div><span class="ap-st">${noteFor(app, flags, grantRefs, legal)}</span></div>
              <div><span class="ap-op">${app.downloads || 0}</span></div>
              <div class="listing-doors">
                <a class="poster-action poster-action--small poster-action--row" href=${appUrl(app)} target="_blank" rel="noopener" onClick=${() => ctx.recordOpen(app)}>${a('open')}</a>
                <a class="poster-action poster-action--small poster-action--row poster-action--lower" href=${catalogUrl({ q: nameOf(app) })} target="_blank" rel="noopener">${a('inCatalog')}</a>
              </div>
            </div>`;
        })}
      </div>
      <${Hint}>${a('newestHint')}<//>
    <//>`;
}

/**
 * What the app loads and calls, from the dependency map the list carries: the cortexes and
 * extensions by name, with the version when the app pinned one.
 */
function requiresLine(app) {
  const r = app.requires;
  if (!r) return null;
  const names = [...(r.cortex || []), ...(r.extensions || [])].map((d) => d.pinned ? `${d.name}@${d.pinned}` : d.name);
  if (!names.length) return null;
  return html`<small class="ap-req">${a('requires', { list: names.join(' · ') })}</small>`;
}

/* ── The first step, when there is nothing yet ────────────────────────────────────────────────── */

function secFirst(ctx) {
  return html`
    <${PageSection} id="ap-first" num="01" title=${a('secFirst')} count=${null} first>
      <p class="poster-quiet ap-empty"><b>${a('firstHead')}</b> ${a('firstBody')}</p>
      <div class="og-doors ap-doors">
        <a class="poster-action poster-action--small" href="/v1/aimeat-os" target="_blank" rel="noopener">${a('guideDoor')}</a>
        <a class="poster-action poster-action--small poster-action--lower" href=${catalogUrl()} target="_blank" rel="noopener">${a('communityDoor', { n: ctx.community })}</a>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => goTab('appdev')}>${a('appdevDoor')}</button>
      </div>
    <//>`;
}
