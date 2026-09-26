/**
 * @file public/views/profile/data-wallet/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Data Wallet page in the poster face: the mast says what the wallet is and
 *   opens the grant form; the strip says what you own, how many permissions stand, what was refused
 *   this window and what you revoked; 01 who reaches what (one row per target, turnable by people,
 *   the revoked ones); 02 what happened (the trail grouped: who tried what, how many times, with the
 *   grants and revocations read off the permissions' own timestamps); 03 the grant form as a fold;
 *   04 everything you own as one file, with what is inside; 05 how your AI uses the wallet. A
 *   wallet that lives on another server shows one box. Pure render over the ctx bag; the rows are
 *   rows.js.
 * @structure renderPage · federated · mast · strip · secTargets · secTrail · secGrant · secExport ·
 *   secRoads
 * @usage import { renderPage } from './data-wallet/page.js';
 * @version-history
 *   v1.20.0 -- 2026-09-26 -- The ready-made request is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.19.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.18.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.17.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.16.0 -- 2026-09-25 -- The grant form's options (who, what, may, where, until) are a choice: the Tab (.poster-tab, the chosen one .is-on), a unification: Jouni's decision "Choice".
 *   v1.15.0 -- 2026-09-25 -- What the export holds is the Item grid (.item-grid, css/components/item-grid.css), a library part by a move.
 *   v1.14.0 -- 2026-09-25 -- Who reaches what (by target, by person, the revoked) and the trail are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.11.0 -- 2026-09-25 -- The paragraph that opens a section is the og-lead, as in most tabs, not the Hint (UI consolidation phase 5, a unification).
 *   v1.10.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.9.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
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
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: select shared ink frames for explanations and the export row.
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Tietolompakko-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, n, crumb, pageLinks, whoOf } from './frame.js';
import { targetRow, personRow, revokedRow, groupRow, eventRow, groupId } from './rows.js';
import { Hint } from '/components/Hint.js';

const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;
const msg = (m) => (m ? html`<small class=${`form-message ${m.error ? 'form-message--error' : ''}`}>${m.text}</small>` : null);

export function renderPage(ctx) {
  if (ctx.federated) return federated(ctx);
  const ov = ctx.ov;
  const rail = [
    ['01', 'dw-targets', x('secTargets'), ov ? String(ctx.active.length) : ''],
    ['02', 'dw-trail', x('secTrail'), ov ? n(ctx.deniedCount) : ''],
    ['03', 'dw-grant', x('secGrant'), ov ? `${ctx.active.length} / ${ctx.quota}` : ''],
    ['04', 'dw-export', x('secExport'), ov ? n(ov.permSummary.total_memory_keys) : ''],
    ['05', 'dw-roads', x('secRoads'), ''],
  ];
  return html`
    <div class="og og-dw">
      ${crumb()}
      ${mast(ctx)}
      ${strip(ctx)}
      <div class="og-grid">
        <div class="og-main">
          ${!ov ? html`<p class=${`poster-quiet dw-empty${ctx.failed ? '' : ' loading-mark'}`}>${ctx.failed ? x('loadFailed') : x('loading')}</p>` : html`
            ${secTargets(ctx)}
            ${secTrail(ctx)}
            ${secGrant(ctx)}
            ${secExport(ctx)}
            ${secRoads()}`}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${rail.map(([num, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${num}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function federated(ctx) {
  return html`
    <div class="og og-dw">
      ${crumb()}
      <div class="og-mast"><div class="og-mast-words"><h1 class="og-title poster-page-title">${t('profile.tabs.dataWallet')}<small>${x('titleSub')}</small></h1><p class="og-desc">${x('desc')}</p></div></div>
      <div class="og-box og-box--solid dw-box poster-aside poster-aside--small poster-aside--irreversible"><span class="poster-label">${x('federatedLabel')}</span>${x('federatedBody', { node: ctx.session?.homeNode || '?' })}</div>
    </div>`;
}

function mast(ctx) {
  const ov = ctx.ov;
  const ps = ov?.permSummary;
  const chips = !ov ? [] : [
    chip(x('chipOwn', { keys: n(ps.total_memory_keys), files: n(ps.total_storage_files) }), 'poster-chip--sun'),
    chip(x('chipGrants', { active: ctx.active.length, revoked: ctx.revokedList.length })),
    ctx.deniedCount ? chip(x('chipDenied', { n: n(ctx.deniedCount), days: ctx.days }), 'poster-chip--coral') : chip(x('chipQuiet', { days: ctx.days })),
    ctx.expiring ? chip(x('chipExpiring', { n: ctx.expiring })) : chip(x('chipNoExpiry')),
  ];
  return html`
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title poster-page-title">${t('profile.tabs.dataWallet')}<small>${x('titleSub')}</small></h1>
        <div class="poster-chips">${chips}</div>
        <p class="og-desc">${x('desc')}</p>
      </div>
      <div class="og-mast-actions">
        <button type="button" class="poster-slab" onClick=${() => ctx.toggleForm(true)}>${x('grantSlab')}</button>
        <small class="poster-hint poster-hint--slab">${x('grantSlabHint')}</small>
        <div class="og-doors">
          <button type="button" class="poster-action poster-action--small" disabled=${ctx.exporting} onClick=${() => ctx.exportAll()}>${ctx.exporting ? x('exporting') : x('exportDoor')}</button>
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => scrollTo('dw-roads')}>${x('toAi')}</button>
        </div>
      </div>
    </div>`;
}

function strip(ctx) {
  const ov = ctx.ov;
  if (!ov) return html`<div class="og-strip"><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div></div>`;
  const ps = ov.permSummary;
  const kinds = ctx.kinds;
  const kindWords = ['person', 'orgMembers', 'company', 'node', 'domain', 'agent', 'all'].filter((k) => kinds[k]).map((k) => x('kindN.' + k, { n: kinds[k] })).join(' · ');
  return html`
    <div class="og-strip">
      <div><b>${n(ps.total_memory_keys)}</b><span>${x('stripKeys')}</span><small>${x('stripKeysSub', { files: n(ps.total_storage_files) })}</small></div>
      <div><b>${ctx.active.length}</b><span>${x('stripGrants')}</span><small>${kindWords || x('stripNoGrants')}</small></div>
      <div>${ctx.deniedCount ? html`<b class="is-low">${n(ctx.deniedCount)}</b><span>${x('stripDenied', { days: ctx.days })}</span><small>${x('stripDeniedSub', { groups: ctx.deniedGroups })}</small>` : html`<b class="is-dim">·</b><span>${x('stripDenied', { days: ctx.days })}</span><small>${x('stripQuietSub')}</small>`}</div>
      <div><b>${ctx.revokedList.length}</b><span>${x('stripRevoked')}</span><small>${ctx.revokedList.length ? x('stripRevokedSub', { swapped: ctx.swapped, removed: ctx.revokedList.length - ctx.swapped }) : x('stripRevokedNone')}</small></div>
    </div>`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTargets(ctx) {
  const f = ctx.filter;
  const filters = [['all', ctx.targets.length], ['orgs', ctx.targets.filter((r) => r.kind === 'org').length], ['keys', ctx.targets.filter((r) => r.kind === 'key').length], ['revoked', ctx.revokedList.length]];
  const list = f === 'orgs' ? ctx.targets.filter((r) => r.kind === 'org') : f === 'keys' ? ctx.targets.filter((r) => r.kind === 'key') : ctx.targets;
  const shown = ctx.personFocus && f === 'people' ? ctx.people.filter((p) => p.name === ctx.personFocus).concat(ctx.people.filter((p) => p.name !== ctx.personFocus)) : ctx.people;
  return html`
    <${PageSection} id="dw-targets" num="01" title=${x('secTargets')} count=${x('secTargetsSub', { n: ctx.active.length, targets: ctx.targets.length })} first=${true}>
      <p class="og-lead">${x('targetsIntro')}</p>
      ${ctx.active.length || ctx.revokedList.length ? html`
        <div class="dw-filters">
          ${filters.map(([id, k]) => html`<button type="button" key=${id} class=${`poster-tab poster-tab--filter ${f === id ? 'is-on' : ''}`} onClick=${() => ctx.setFilter(id)}>${x('filter.' + id)} · ${k}</button>`)}
          <button type="button" class=${`poster-tab poster-tab--filter dw-filters-r ${f === 'people' ? 'is-on' : ''}`} onClick=${() => ctx.setFilter('people')}>${x('filter.people')} · ${ctx.people.length}</button>
        </div>` : null}
      ${f === 'revoked' ? html`
        ${ctx.revokedList.length ? html`<div class="listing listing--cols listing--name-desc-span-doors">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('col.target')}</div><div class="poster-label">${x('col.whoWhat')}</div><div class="poster-label">${x('col.span')}</div><div class="poster-label"></div></div>
          ${ctx.revokedList.map((c) => revokedRow(ctx, c))}
        </div>` : html`<p class="poster-quiet dw-empty">${x('noRevoked')}</p>`}`
      : f === 'people' ? html`
        ${ctx.people.length ? html`<div class="listing listing--cols listing--name-desc-since-doors">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('col.who')}</div><div class="poster-label">${x('col.reaches')}</div><div class="poster-label">${x('col.since')}</div><div class="poster-label"></div></div>
          ${shown.map((p) => personRow(ctx, p))}
        </div>` : html`<p class="poster-quiet dw-empty">${x('noGrants')}</p>`}`
      : html`
        ${list.length ? html`<div class="listing listing--cols listing--name-desc-since-doors">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('col.target')}</div><div class="poster-label">${x('col.whoWhat')}</div><div class="poster-label">${x('col.since')}</div><div class="poster-label"></div></div>
          ${list.map((r) => targetRow(ctx, r))}
        </div>` : html`<p class="poster-quiet dw-empty"><b>${x('noGrantsTitle')}</b> ${x('noGrantsBody')}</p>`}`}
      <div class="dw-why poster-box"><b>${x('howTitle')}</b> ${x('howBody')}</div>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTrail(ctx) {
  const ov = ctx.ov;
  const items = ctx.trail;
  const shown = items.slice(0, ctx.shownTrail);
  return html`
    <${PageSection} id="dw-trail" num="02" title=${x('secTrail')} count=${x('secTrailSub', { days: ctx.days, denied: n(ctx.deniedCount), events: ctx.events.length })}>
      <p class="og-lead">${x('trailIntro')}</p>
      <div class="dw-filters">
        ${[7, 30, 90].map((d) => html`<button type="button" key=${d} class=${`poster-tab poster-tab--filter ${ctx.days === d ? 'is-on' : ''}`} disabled=${ctx.reloading} onClick=${() => ctx.setDays(d)}>${x('daysN', { n: d })}${ctx.days === d ? ` · ${n(ov.audit.total)}` : ''}</button>`)}
        <button type="button" class=${`poster-tab poster-tab--filter dw-filters-r ${ctx.trailFilter === 'events' ? 'is-on' : ''}`} onClick=${() => ctx.setTrailFilter(ctx.trailFilter === 'events' ? 'all' : 'events')}>${x('filter.eventsOnly')} · ${ctx.events.length}</button>
      </div>
      ${items.length ? html`
        <div class="listing listing--cols listing--name-desc-count-when-doors">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('col.who')}</div><div class="poster-label">${x('col.what')}</div><div class="dw-n poster-label">${x('col.times')}</div><div class="poster-label">${x('col.when')}</div><div class="poster-label"></div></div>
          ${shown.map((it) => (it.kind === 'group' ? groupRow(ctx, it.group) : eventRow(ctx, it.event)))}
        </div>
        ${items.length > shown.length ? html`<div class="dw-more"><button type="button" class="poster-action poster-action--more" onClick=${() => ctx.showMoreTrail()}>${x('moreRows', { n: items.length - shown.length })}</button></div>` : null}`
      : html`<p class="poster-quiet dw-empty"><b>${x('trailEmptyTitle')}</b> ${x('trailEmptyBody')}</p>`}
      ${ctx.manifestShare >= 0.5 && ctx.deniedCount >= 20 ? html`<div class="dw-why poster-box"><b>${x('meaningTitle')}</b> ${x('meaningManifest', { n: n(ctx.manifestDenied), total: n(ctx.deniedCount) })}</div>` : null}
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

function opt(ctx, field, value, label) {
  return html`<button type="button" class=${`poster-tab ${ctx.form[field] === value ? 'is-on' : ''}`} onClick=${() => ctx.setForm({ [field]: value })}>${label}</button>`;
}

function secGrant(ctx) {
  const f = ctx.form;
  const org = ctx.orgs.find((o) => o.id === f.orgId);
  const wsList = org?.workspaces || [];
  const canWrite = f.what === 'ws';
  const whoIsPicker = f.whoKind === 'contact';
  const ready = (whoIsPicker ? !!f.who.trim() : true) && (f.what === 'key' ? !!f.key.trim() : !!f.orgId && (f.what !== 'ws' || !!f.wsId)) && !!f.why.trim();
  return html`
    <${FoldSection} id="dw-grant" num="03" title=${x('secGrant')} sub=${`${ctx.active.length} / ${ctx.quota}`} open=${f.open} onToggle=${() => ctx.toggleForm()}>
      <p class="og-lead">${x('grantIntro')}</p>
      <div class="dw-form">
        <span class="poster-label">${x('form.who')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'whoKind', 'contact', x('form.whoContact'))}${opt(ctx, 'whoKind', 'orgMembers', x('form.whoOrgMembers'))}${opt(ctx, 'whoKind', 'nodeUsers', x('form.whoNodeUsers'))}${opt(ctx, 'whoKind', 'all', x('form.whoAll'))}</div>
          ${whoIsPicker ? html`<${ContactPicker} value=${f.who} onChange=${(v) => ctx.setForm({ who: v })} valueMode="full" placeholder=${x('form.whoPlaceholder')} />` : null}
          <${Hint}>${f.whoKind === 'all' ? x('form.whoAllHint') : f.whoKind === 'orgMembers' ? x('form.whoOrgMembersHint') : f.whoKind === 'nodeUsers' ? x('form.whoNodeUsersHint') : x('form.whoHint')}<//>
        </div>
        <span class="poster-label">${x('form.what')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'what', 'ws', x('form.whatWs'))}${opt(ctx, 'what', 'org', x('form.whatOrg'))}${opt(ctx, 'what', 'key', x('form.whatKey'))}</div>
          ${f.what === 'key' ? html`<input class="og-input" type="text" value=${f.key} placeholder="portfolio/contact*" onInput=${(e) => ctx.setForm({ key: e.target.value })} /><${Hint}>${x('form.keyHint')}<//>` : html`
            <select class="select-field" value=${f.orgId} onChange=${(e) => ctx.setForm({ orgId: e.target.value, wsId: '' })}>
              <option value="">${ctx.orgs.length ? x('form.pickOrg') : x('form.noOrgs')}</option>
              ${ctx.orgs.map((o) => html`<option key=${o.id} value=${o.id}>${o.name}</option>`)}
            </select>
            ${f.what === 'ws' ? html`<select class="select-field dw-workspace-select" value=${f.wsId} disabled=${!f.orgId} onChange=${(e) => ctx.setForm({ wsId: e.target.value })}>
              <option value="">${!f.orgId ? x('form.pickOrgFirst') : wsList.length ? x('form.pickWs') : x('form.noWs')}</option>
              ${wsList.map((w) => html`<option key=${w.id} value=${w.id}>${w.name}</option>`)}
            </select>` : null}
            <${Hint}>${f.what === 'ws' ? x('form.wsHint') : x('form.orgHint')}<//>`}
        </div>
        <span class="poster-label">${x('form.may')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'may', 'read', x('form.mayRead'))}${canWrite ? opt(ctx, 'may', 'write', x('form.mayWrite')) : null}</div>
          <${Hint}>${x('form.mayHint')}<//>
        </div>
        <span class="poster-label">${x('form.why')}</span>
        <div><input class="og-input" type="text" value=${f.why} placeholder=${x('form.whyPlaceholder')} onInput=${(e) => ctx.setForm({ why: e.target.value })} /></div>
        <span class="poster-label">${x('form.scope')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'scope', 'private', x('form.scopePrivate'))}${opt(ctx, 'scope', 'federation', x('form.scopeFederation'))}</div>
          <${Hint}>${x('form.scopeHint')}<//>
        </div>
        <span class="poster-label">${x('form.until')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'untilKind', 'never', x('form.untilNever'))}${opt(ctx, 'untilKind', 'date', x('form.untilDate'))}</div>
          ${f.untilKind === 'date' ? html`<input class="og-input" type="date" value=${f.until} onInput=${(e) => ctx.setForm({ until: e.target.value })} />` : null}
        </div>
        <span></span>
        <div class="dw-submit">
          <button type="button" class="poster-slab poster-slab--control" disabled=${!ready || ctx.busy === 'grant'} onClick=${() => ctx.submitGrant()}>${ctx.busy === 'grant' ? x('granting') : x('grantSlab')}</button>
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggleForm(false)}>${x('cancel')}</button>
          ${msg(ctx.formMsg)}
        </div>
      </div>
    <//>`;
}

/* ── 04 ───────────────────────────────────────────────────────────────────────────────────────── */

function secExport(ctx) {
  const ps = ctx.ov.permSummary;
  const mb = Math.max(1, Math.round((ps.total_memory_keys * 2) / 1000));
  const items = [
    ['account', x('export.accountSub')],
    ['memory', x('export.memorySub', { n: n(ps.total_memory_keys) })],
    ['files', x('export.filesSub', { n: n(ps.total_storage_files) })],
    ['agents', x('export.agentsSub')],
    ['consents', x('export.consentsSub', { n: ctx.ov.consents.total, active: ctx.active.length, revoked: ctx.revokedList.length })],
    ['trade', x('export.tradeSub')],
    ['organisms', x('export.organismsSub')],
    ['push', x('export.pushSub')],
    ['flags', x('export.flagsSub')],
  ];
  return html`
    <${PageSection} id="dw-export" num="04" title=${x('secExport')} count=${x('secExportSub', { keys: n(ps.total_memory_keys), files: n(ps.total_storage_files) })}>
      <p class="og-lead">${x('exportIntro', { mb })}</p>
      <div class="item-grid">${items.map(([k, sub]) => html`<div key=${k}><b>${x('export.' + k)}</b><small>${sub}</small></div>`)}</div>
      <div class="dw-export poster-box">
        <button type="button" class="poster-slab poster-slab--control" disabled=${ctx.exporting} onClick=${() => ctx.exportAll()}>${ctx.exporting ? x('exporting') : x('exportDoor')}</button>
        <div>${x('exportBody', { file: ctx.exportName })} ${msg(ctx.exportMsg)}</div>
      </div>
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads() {
  const ask = x('roadAskPrompt');
  return html`
    <${PageSection} id="dw-roads" num="05" title=${x('secRoads')}>
      <div class="dw-roads">
        <div class="dw-road poster-box poster-box--raised">
          <span class="poster-label">${x('roadAskTitle')}</span>
          <p>${x('roadAskBody')}</p>
          <pre class="code-block">${ask}</pre>
          <div class="og-doors"><${CopyButton} className="poster-action poster-action--small poster-action--lower" text=${ask} label=${x('copyPrompt')} /></div>
        </div>
        <div class="dw-road poster-box">
          <span class="poster-label">${x('roadAgentTitle')}</span>
          <p>${x('roadAgentBody')}</p>
          <small>aimeat_consent_list · aimeat_consent_grant · aimeat_consent_revoke · ${x('roadAgentScope')}</small>
        </div>
      </div>
    <//>`;
}

export { whoOf, groupId };
