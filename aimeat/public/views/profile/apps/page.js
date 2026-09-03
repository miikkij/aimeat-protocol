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
 *   v1.0.0 — 2026-09-02 — Initial.
 *   v1.1.0 — 2026-09-03 — A newest row says what the app needs (requiresLine): the cortexes it loads and the extensions it calls, with a pinned version after the at sign.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { a, day, rel, kb, locale, nameOf, appRef, appUrl, catalogUrl, noteFor, initials, crumb, pageLinks, goTab } from './frame.js';
import { secAgents, secBuild } from './build.js';

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
  const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
  const fmt = (n) => n.toLocaleString(locale());

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
    : [['01', 'ap-waiting', a('secWaiting'), waiting], ['02', 'ap-kunto', a('secKunto'), ''], ['03', 'ap-newest', a('secNewest'), Math.min(apps.length, 6)], ['04', 'ap-agents', a('secAgents'), ''], ['05', 'ap-build', a('secBuild'), '']];

  return html`
    <div class="og og-apps">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${t('profile.tabs.apps')}<small>${a('titleSub')}</small></h1>
          <div class="og-chips">
            ${none ? chip(a('chipNone'), 'og-chip--coral') : chip(a('chipCount', { n: apps.length }))}
            ${none ? chip(a('chipFirst'), 'og-chip--dim') : drafts.length ? chip(a('chipDrafts', { n: drafts.length }), 'og-chip--coral') : null}
            ${none ? null : chip(a('chipOpens', { n: fmt(opens) }), 'og-chip--dim')}
          </div>
          <p class="og-desc">${none ? a('descEmpty') : a('desc')}</p>
        </div>
        <div class="og-mast-actions">
          ${none
            ? html`<${CopyButton} text=${ctx.buildPrompt} className="og-slab" label=${a('promptDoor')} copiedLabel=${a('promptCopied')} disabled=${!ctx.buildPrompt} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))} />
              <div class="og-doors">
                <button type="button" class="og-door" onClick=${() => scrollTo('ap-build')}>${a('uploadDoor')}</button>
                <a class="og-door og-door--quiet" href=${catalogUrl()} target="_blank" rel="noopener">${a('catalogDoor')}</a>
              </div>`
            : html`<a class="og-slab" href=${catalogUrl()} target="_blank" rel="noopener">${a('catalogDoor')}</a>
              <div class="og-doors"><button type="button" class="og-door" onClick=${() => scrollTo('ap-build')}>${a('uploadDoor')}</button></div>`}
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${none ? html`${secFirst(ctx)}${secWaiting(ctx, drafts, grants, '02')}${secKunto(ctx, '03')}${secBuild(ctx, { formOnly: true, num: '04' })}`
            : loading ? html`<p class="og-empty">${t('common.loading')}</p>`
            : html`${secWaiting(ctx, drafts, grants, '01')}${secKunto(ctx, '02')}${secNewest(ctx, apps)}${secAgents(ctx)}${secBuild(ctx, { formOnly: false, num: '05' })}`}
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
    </div>`;
}

/* ── 01 · What waits for you ─────────────────────────────────────────────────────────────────── */

function secWaiting(ctx, drafts, grants, num) {
  const waiting = drafts.length + grants.length;
  return html`
    <${Section} id="ap-waiting" num=${num} title=${a('secWaiting')} count=${waiting} first=${num === '01'}>
      ${!waiting ? html`<p class="ap-empty">${ctx.apps && ctx.apps.length ? a('waitingEmpty') : a('waitingEmptyNew')}</p>` : html`
        <div class="ap-rows">
          ${drafts.map((app) => draftRow(ctx, app))}
          ${grants.map((g) => grantRow(ctx, g))}
        </div>`}
      <p class="ap-hint">${a('waitingHint')}</p>
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
        <span class="og-chip og-chip--coral">${a('draftChip')}</span>
        <button type="button" class="og-door" disabled=${busy} onClick=${() => ctx.publishDraft(app)}>${a('publishDraft')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleDiff(app)}>${open ? a('hideChanges') : a('viewChanges')}</button>
        <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.discardDraft(app)}>${a('discardDraft')}</button>
      </div>
      ${open ? diffPanel(ctx.diff) : null}
    </div>`;
}

function diffPanel(diff) {
  if (diff.state === 'loading') return html`<div class="ap-panel"><p class="ap-empty">${a('diffLoading')}</p></div>`;
  if (diff.state === 'failed') return html`<div class="ap-panel"><p class="ap-empty">${a('diffFailed')}</p></div>`;
  const d = diff.result;
  return html`
    <div class="ap-panel">
      <p class="ap-panel-lead">${d.addedTotal || d.removedTotal ? a('diffTitle', { added: d.addedTotal, removed: d.removedTotal }) : a('diffNone')}</p>
      ${d.added.length ? html`<span class="og-label">${a('diffAdded')}</span><pre class="ap-code ap-code--add">${d.added.join('\n')}</pre>` : null}
      ${d.removed.length ? html`<span class="og-label">${a('diffRemoved')}</span><pre class="ap-code ap-code--del">${d.removed.join('\n')}</pre>` : null}
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
        <span class="og-chip og-chip--sun">${a('grantChip')}</span>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleScopes(g)}>${open ? a('hideScopes') : a('viewScopes')}</button>
        <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.revokeGrant(g)}>${a('revokeGrant')}</button>
      </div>
      ${open ? html`<div class="ap-panel"><p class="ap-panel-lead">${a('scopesLead', { origin: g.app_origin || g.app })}</p><div class="ap-scopes">${(g.scopes || []).map((s) => html`<span key=${s}>${s}</span>`)}</div></div>` : null}
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
    ? html`<${CopyButton} text=${managePrompt} className="og-door og-door--quiet" label=${a('manageDoor')} copiedLabel=${a('promptCopied')} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))} />`
    : null;
  return html`
    <${Section} id="ap-kunto" num=${num} title=${a('secKunto')} count=${ctx.apps && ctx.apps.length ? a('secKuntoSub', { n: ctx.apps.length }) : null} doors=${doors}>
      ${!ctx.apps || !ctx.apps.length ? html`<p class="ap-empty">${a('kuntoEmptyNew')}</p>`
        : !k.rows.length ? html`<p class="ap-empty"><b>${a('kuntoAllGood')}</b></p>` : html`
        <div class="ap-kn">
          ${k.rows.map((r) => html`
            <div class=${`ap-kn-n ${r.loud ? 'ap-kn-n--loud' : ''}`} key=${'n' + r.key}>${r.n}</div>
            <div class="ap-kn-w" key=${'w' + r.key}><b>${a('kunto.' + r.key + '.what')}</b><small>${sub(r.key)}</small></div>
            <div class="ap-kn-go" key=${'g' + r.key}><a class="og-door og-door--quiet" href=${catalogUrl({ filter: r.key })} target="_blank" rel="noopener">${a('kuntoShow', { n: r.n })}</a></div>`)}
        </div>`}
      <p class="ap-hint">${a('kuntoHint')}</p>
    <//>`;
}

/* ── 03 · Last changed ────────────────────────────────────────────────────────────────────────── */

function secNewest(ctx, apps) {
  const rows = [...apps].sort((p, q) => String(q.created_at || '').localeCompare(String(p.created_at || ''))).slice(0, 6);
  const grantRefs = new Set((ctx.grants || []).map((g) => g.app));
  const doors = html`<a class="og-door og-door--quiet" href=${catalogUrl()} target="_blank" rel="noopener">${a('allInCatalog', { n: apps.length })}</a>`;
  return html`
    <${Section} id="ap-newest" num="03" title=${a('secNewest')} count=${rows.length} doors=${doors}>
      <div class="ap-list">
        <div class="ap-head" aria-hidden="true"></div><div class="ap-head">${a('colApp')}</div><div class="ap-head">${a('colDesc')}</div><div class="ap-head">${a('colNote')}</div><div class="ap-head ap-head--r">${a('colOpens')}</div><div class="ap-head"></div>
        ${rows.map((app) => {
          const ref = appRef(app);
          const flags = ctx.kunto?.flags?.[ref] || {};
          const legal = app.manifest?.legal ? Object.keys(app.manifest.legal).length : 0;
          return html`
            <div class="ap-av" key=${'a' + ref} aria-hidden="true">${initials(nameOf(app))}</div>
            <div class="ap-nm" key=${'n' + ref}>${nameOf(app)}<small>${a('rowMeta', { version: app.manifest?.version || '', n: app.version_number || 1, date: day(app.created_at), size: kb(app.size) })}</small></div>
            <div class="ap-ds" key=${'d' + ref}>${app.manifest?.descriptions?.[getLocale()] || app.manifest?.description || ''}${requiresLine(app)}</div>
            <div class="ap-st" key=${'s' + ref}>${noteFor(app, flags, grantRefs, legal)}</div>
            <div class="ap-op" key=${'o' + ref}>${app.downloads || 0}</div>
            <div class="ap-go" key=${'g' + ref}>
              <a class="og-door" href=${appUrl(app)} target="_blank" rel="noopener" onClick=${() => ctx.recordOpen(app)}>${a('open')}</a>
              <a class="og-door og-door--quiet" href=${catalogUrl({ q: nameOf(app) })} target="_blank" rel="noopener">${a('inCatalog')}</a>
            </div>`;
        })}
      </div>
      <p class="ap-hint">${a('newestHint')}</p>
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
    <${Section} id="ap-first" num="01" title=${a('secFirst')} count=${null} first>
      <p class="ap-empty"><b>${a('firstHead')}</b> ${a('firstBody')}</p>
      <div class="og-doors ap-doors">
        <a class="og-door" href="/v1/aimeat-os" target="_blank" rel="noopener">${a('guideDoor')}</a>
        <a class="og-door og-door--quiet" href=${catalogUrl()} target="_blank" rel="noopener">${a('communityDoor', { n: ctx.community })}</a>
        <button type="button" class="og-door og-door--quiet" onClick=${() => goTab('appdev')}>${a('appdevDoor')}</button>
      </div>
    <//>`;
}
