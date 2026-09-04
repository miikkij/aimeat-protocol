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
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Tietolompakko-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, n, crumb, pageLinks, whoOf } from './frame.js';
import { targetRow, personRow, revokedRow, groupRow, eventRow, groupId } from './rows.js';

const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
const msg = (m) => (m ? html`<small class=${`dw-msg ${m.error ? 'is-err' : ''}`}>${m.text}</small>` : null);

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
          ${!ov ? html`<p class="dw-empty">${ctx.failed ? x('loadFailed') : x('loading')}</p>` : html`
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
      <div class="og-mast"><div class="og-mast-words"><h1 class="og-title">${t('profile.tabs.dataWallet')}<small>${x('titleSub')}</small></h1><p class="og-desc">${x('desc')}</p></div></div>
      <div class="og-box og-box--solid dw-box"><span class="og-box-label">${x('federatedLabel')}</span>${x('federatedBody', { node: ctx.session?.homeNode || '?' })}</div>
    </div>`;
}

function mast(ctx) {
  const ov = ctx.ov;
  const ps = ov?.permSummary;
  const chips = !ov ? [] : [
    chip(x('chipOwn', { keys: n(ps.total_memory_keys), files: n(ps.total_storage_files) }), 'og-chip--sun'),
    chip(x('chipGrants', { active: ctx.active.length, revoked: ctx.revokedList.length })),
    ctx.deniedCount ? chip(x('chipDenied', { n: n(ctx.deniedCount), days: ctx.days }), 'og-chip--coral') : chip(x('chipQuiet', { days: ctx.days }), 'og-chip--dim'),
    ctx.expiring ? chip(x('chipExpiring', { n: ctx.expiring }), 'og-chip--dim') : chip(x('chipNoExpiry'), 'og-chip--dim'),
  ];
  return html`
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title">${t('profile.tabs.dataWallet')}<small>${x('titleSub')}</small></h1>
        <div class="og-chips">${chips}</div>
        <p class="og-desc">${x('desc')}</p>
      </div>
      <div class="og-mast-actions">
        <button type="button" class="og-slab" onClick=${() => ctx.toggleForm(true)}>${x('grantSlab')}</button>
        <small class="dw-slab-hint">${x('grantSlabHint')}</small>
        <div class="og-doors">
          <button type="button" class="og-door" disabled=${ctx.exporting} onClick=${() => ctx.exportAll()}>${ctx.exporting ? x('exporting') : x('exportDoor')}</button>
          <button type="button" class="og-door og-door--quiet" onClick=${() => scrollTo('dw-roads')}>${x('toAi')}</button>
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
    <${Section} id="dw-targets" num="01" title=${x('secTargets')} count=${x('secTargetsSub', { n: ctx.active.length, targets: ctx.targets.length })} first=${true}>
      <p class="dw-para">${x('targetsIntro')}</p>
      ${ctx.active.length || ctx.revokedList.length ? html`
        <div class="dw-filters">
          ${filters.map(([id, k]) => html`<button type="button" key=${id} class=${`og-chip ${f === id ? 'og-chip--sun' : ''}`} onClick=${() => ctx.setFilter(id)}>${x('filter.' + id)} · ${k}</button>`)}
          <button type="button" class=${`og-chip dw-filters-r ${f === 'people' ? 'og-chip--sun' : 'og-chip--dim'}`} onClick=${() => ctx.setFilter('people')}>${x('filter.people')} · ${ctx.people.length}</button>
        </div>` : null}
      ${f === 'revoked' ? html`
        ${ctx.revokedList.length ? html`<div class="dw-rows dw-rows--plain">
          <div class="dw-row dw-row--head"><div>${x('col.target')}</div><div>${x('col.whoWhat')}</div><div>${x('col.span')}</div><div></div></div>
          ${ctx.revokedList.map((c) => revokedRow(ctx, c))}
        </div>` : html`<p class="dw-empty">${x('noRevoked')}</p>`}`
      : f === 'people' ? html`
        ${ctx.people.length ? html`<div class="dw-rows">
          <div class="dw-row dw-row--head"><div>${x('col.who')}</div><div>${x('col.reaches')}</div><div>${x('col.since')}</div><div></div></div>
          ${shown.map((p) => personRow(ctx, p))}
        </div>` : html`<p class="dw-empty">${x('noGrants')}</p>`}`
      : html`
        ${list.length ? html`<div class="dw-rows">
          <div class="dw-row dw-row--head"><div>${x('col.target')}</div><div>${x('col.whoWhat')}</div><div>${x('col.since')}</div><div></div></div>
          ${list.map((r) => targetRow(ctx, r))}
        </div>` : html`<p class="dw-empty"><b>${x('noGrantsTitle')}</b> ${x('noGrantsBody')}</p>`}`}
      <div class="dw-why"><b>${x('howTitle')}</b> ${x('howBody')}</div>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTrail(ctx) {
  const ov = ctx.ov;
  const items = ctx.trail;
  const shown = items.slice(0, ctx.shownTrail);
  return html`
    <${Section} id="dw-trail" num="02" title=${x('secTrail')} count=${x('secTrailSub', { days: ctx.days, denied: n(ctx.deniedCount), events: ctx.events.length })}>
      <p class="dw-para">${x('trailIntro')}</p>
      <div class="dw-filters">
        ${[7, 30, 90].map((d) => html`<button type="button" key=${d} class=${`og-chip ${ctx.days === d ? 'og-chip--sun' : ''}`} disabled=${ctx.reloading} onClick=${() => ctx.setDays(d)}>${x('daysN', { n: d })}${ctx.days === d ? ` · ${n(ov.audit.total)}` : ''}</button>`)}
        <button type="button" class=${`og-chip dw-filters-r ${ctx.trailFilter === 'events' ? 'og-chip--sun' : 'og-chip--dim'}`} onClick=${() => ctx.setTrailFilter(ctx.trailFilter === 'events' ? 'all' : 'events')}>${x('filter.eventsOnly')} · ${ctx.events.length}</button>
      </div>
      ${items.length ? html`
        <div class="dw-rows dw-rows--log">
          <div class="dw-row dw-row--head"><div>${x('col.who')}</div><div>${x('col.what')}</div><div class="dw-n">${x('col.times')}</div><div>${x('col.when')}</div><div></div></div>
          ${shown.map((it) => (it.kind === 'group' ? groupRow(ctx, it.group) : eventRow(ctx, it.event)))}
        </div>
        ${items.length > shown.length ? html`<div class="dw-more"><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.showMoreTrail()}>${x('moreRows', { n: items.length - shown.length })}</button></div>` : null}`
      : html`<p class="dw-empty"><b>${x('trailEmptyTitle')}</b> ${x('trailEmptyBody')}</p>`}
      ${ctx.manifestShare >= 0.5 && ctx.deniedCount >= 20 ? html`<div class="dw-why"><b>${x('meaningTitle')}</b> ${x('meaningManifest', { n: n(ctx.manifestDenied), total: n(ctx.deniedCount) })}</div>` : null}
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

function opt(ctx, field, value, label) {
  return html`<button type="button" class=${`dw-opt ${ctx.form[field] === value ? 'is-on' : ''}`} onClick=${() => ctx.setForm({ [field]: value })}>${label}</button>`;
}

function secGrant(ctx) {
  const f = ctx.form;
  const org = ctx.orgs.find((o) => o.id === f.orgId);
  const wsList = org?.workspaces || [];
  const canWrite = f.what === 'ws';
  const whoIsPicker = f.whoKind === 'contact';
  const ready = (whoIsPicker ? !!f.who.trim() : true) && (f.what === 'key' ? !!f.key.trim() : !!f.orgId && (f.what !== 'ws' || !!f.wsId)) && !!f.why.trim();
  return html`
    <${Fold} id="dw-grant" num="03" title=${x('secGrant')} sub=${`${ctx.active.length} / ${ctx.quota}`} open=${f.open} onToggle=${() => ctx.toggleForm()}>
      <p class="dw-para">${x('grantIntro')}</p>
      <div class="dw-form">
        <span class="og-label">${x('form.who')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'whoKind', 'contact', x('form.whoContact'))}${opt(ctx, 'whoKind', 'orgMembers', x('form.whoOrgMembers'))}${opt(ctx, 'whoKind', 'nodeUsers', x('form.whoNodeUsers'))}${opt(ctx, 'whoKind', 'all', x('form.whoAll'))}</div>
          ${whoIsPicker ? html`<${ContactPicker} value=${f.who} onChange=${(v) => ctx.setForm({ who: v })} valueMode="full" placeholder=${x('form.whoPlaceholder')} />` : null}
          <p class="dw-hint">${f.whoKind === 'all' ? x('form.whoAllHint') : f.whoKind === 'orgMembers' ? x('form.whoOrgMembersHint') : f.whoKind === 'nodeUsers' ? x('form.whoNodeUsersHint') : x('form.whoHint')}</p>
        </div>
        <span class="og-label">${x('form.what')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'what', 'ws', x('form.whatWs'))}${opt(ctx, 'what', 'org', x('form.whatOrg'))}${opt(ctx, 'what', 'key', x('form.whatKey'))}</div>
          ${f.what === 'key' ? html`<input class="og-input" type="text" value=${f.key} placeholder="portfolio/contact*" onInput=${(e) => ctx.setForm({ key: e.target.value })} /><p class="dw-hint">${x('form.keyHint')}</p>` : html`
            <select class="og-input" value=${f.orgId} onChange=${(e) => ctx.setForm({ orgId: e.target.value, wsId: '' })}>
              <option value="">${ctx.orgs.length ? x('form.pickOrg') : x('form.noOrgs')}</option>
              ${ctx.orgs.map((o) => html`<option key=${o.id} value=${o.id}>${o.name}</option>`)}
            </select>
            ${f.what === 'ws' ? html`<select class="og-input" style="margin-top: .4rem;" value=${f.wsId} disabled=${!f.orgId} onChange=${(e) => ctx.setForm({ wsId: e.target.value })}>
              <option value="">${!f.orgId ? x('form.pickOrgFirst') : wsList.length ? x('form.pickWs') : x('form.noWs')}</option>
              ${wsList.map((w) => html`<option key=${w.id} value=${w.id}>${w.name}</option>`)}
            </select>` : null}
            <p class="dw-hint">${f.what === 'ws' ? x('form.wsHint') : x('form.orgHint')}</p>`}
        </div>
        <span class="og-label">${x('form.may')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'may', 'read', x('form.mayRead'))}${canWrite ? opt(ctx, 'may', 'write', x('form.mayWrite')) : null}</div>
          <p class="dw-hint">${x('form.mayHint')}</p>
        </div>
        <span class="og-label">${x('form.why')}</span>
        <div><input class="og-input" type="text" value=${f.why} placeholder=${x('form.whyPlaceholder')} onInput=${(e) => ctx.setForm({ why: e.target.value })} /></div>
        <span class="og-label">${x('form.scope')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'scope', 'private', x('form.scopePrivate'))}${opt(ctx, 'scope', 'federation', x('form.scopeFederation'))}</div>
          <p class="dw-hint">${x('form.scopeHint')}</p>
        </div>
        <span class="og-label">${x('form.until')}</span>
        <div>
          <div class="dw-opts">${opt(ctx, 'untilKind', 'never', x('form.untilNever'))}${opt(ctx, 'untilKind', 'date', x('form.untilDate'))}</div>
          ${f.untilKind === 'date' ? html`<input class="og-input" type="date" value=${f.until} onInput=${(e) => ctx.setForm({ until: e.target.value })} />` : null}
        </div>
        <span></span>
        <div class="dw-submit">
          <button type="button" class="og-slab" disabled=${!ready || ctx.busy === 'grant'} onClick=${() => ctx.submitGrant()}>${ctx.busy === 'grant' ? x('granting') : x('grantSlab')}</button>
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleForm(false)}>${x('cancel')}</button>
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
    <${Section} id="dw-export" num="04" title=${x('secExport')} count=${x('secExportSub', { keys: n(ps.total_memory_keys), files: n(ps.total_storage_files) })}>
      <p class="dw-para">${x('exportIntro', { mb })}</p>
      <div class="dw-contents">${items.map(([k, sub]) => html`<div key=${k}><b>${x('export.' + k)}</b><small>${sub}</small></div>`)}</div>
      <div class="dw-export">
        <button type="button" class="og-slab" disabled=${ctx.exporting} onClick=${() => ctx.exportAll()}>${ctx.exporting ? x('exporting') : x('exportDoor')}</button>
        <div>${x('exportBody', { file: ctx.exportName })} ${msg(ctx.exportMsg)}</div>
      </div>
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads() {
  const ask = x('roadAskPrompt');
  return html`
    <${Section} id="dw-roads" num="05" title=${x('secRoads')}>
      <div class="dw-roads">
        <div class="dw-road is-lead">
          <span class="og-box-label">${x('roadAskTitle')}</span>
          <p>${x('roadAskBody')}</p>
          <pre>${ask}</pre>
          <div class="og-doors"><${CopyButton} className="og-door og-door--quiet" text=${ask} label=${x('copyPrompt')} /></div>
        </div>
        <div class="dw-road">
          <span class="og-box-label">${x('roadAgentTitle')}</span>
          <p>${x('roadAgentBody')}</p>
          <small>aimeat_consent_list · aimeat_consent_grant · aimeat_consent_revoke · ${x('roadAgentScope')}</small>
        </div>
      </div>
    <//>`;
}

export { whoOf, groupId };
