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
 * @structure renderPage · federated · identity · mastActions · strip · secTargets · secTrail ·
 *   secGrant · secExport · secRoads
 * @usage import { renderPage } from './data-wallet/page.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: Page with a numbered index Rail, the
 *     strip a plain NumeralBand, the filters Toolbars, the rows ListRows, the grant form Fields and
 *     radio tabs in a Fold, the export's contents three Columns, the two roads two Surfaces; no own
 *     CSS (data-wallet-poster.css is gone).
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: select shared ink frames for explanations and the export row.
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Tietolompakko-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { Page, Rail, Section, Fold, Stack, Columns, Toolbar, NumeralBand, Chip, Action, CopyAction, Field, Surface, Text, scrollToId } from '/components/poster-parts.js';
import { x, n, crumb, pageLinks, whoOf } from './frame.js';
import { targetRow, personRow, revokedRow, groupRow, eventRow, groupId, msgLine } from './rows.js';

export function renderPage(ctx) {
  if (ctx.federated) return federated(ctx);
  const ov = ctx.ov;
  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${[
    { href: '#dw-targets', label: x('secTargets'), count: ov ? String(ctx.active.length) : undefined },
    { href: '#dw-trail', label: x('secTrail'), count: ov ? n(ctx.deniedCount) : undefined },
    { href: '#dw-grant', label: x('secGrant'), count: ov ? `${ctx.active.length} / ${ctx.quota}` : undefined },
    { href: '#dw-export', label: x('secExport'), count: ov ? n(ov.permSummary.total_memory_keys) : undefined },
    { href: '#dw-roads', label: x('secRoads') },
  ]}>${pageLinks()}<//>`;
  return html`<${Page} width="wide" title=${t('profile.tabs.dataWallet')} crumbs=${crumb()} identity=${identity(ctx)} actions=${mastActions(ctx)} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${x('desc')}<//>
      ${strip(ctx)}
      ${!ov ? html`<${Text} tone="muted">${ctx.failed ? x('loadFailed') : x('loading')}<//>` : html`
        ${secTargets(ctx)}
        ${secTrail(ctx)}
        ${secGrant(ctx)}
        ${secExport(ctx)}
        ${secRoads()}`}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

function federated(ctx) {
  return html`<${Page} width="wide" title=${t('profile.tabs.dataWallet')} crumbs=${crumb()} identity=${html`<${Text} kind="label">${x('titleSub')}<//>`}>
    <${Stack}>
      <${Text} kind="lead">${x('desc')}<//>
      <${Surface} kind="aside" tone="danger"><${Stack} density="compact">
        <${Text} kind="label">${x('federatedLabel')}<//>
        <${Text}>${x('federatedBody', { node: ctx.session?.homeNode || '?' })}<//>
      <//><//>
    <//>
  <//>`;
}

/** Under the title: what the page is, and what you own, what stands and what was refused. */
function identity(ctx) {
  const ov = ctx.ov;
  const ps = ov?.permSummary;
  return html`<${Stack} density="compact">
    <${Text} kind="label">${x('titleSub')}<//>
    ${ov ? html`<${Stack} direction="wrap" density="compact">
      <${Chip} tone="sun">${x('chipOwn', { keys: n(ps.total_memory_keys), files: n(ps.total_storage_files) })}<//>
      <${Chip}>${x('chipGrants', { active: ctx.active.length, revoked: ctx.revokedList.length })}<//>
      ${ctx.deniedCount ? html`<${Chip} tone="coral">${x('chipDenied', { n: n(ctx.deniedCount), days: ctx.days })}<//>` : html`<${Chip} tone="muted">${x('chipQuiet', { days: ctx.days })}<//>`}
      ${ctx.expiring ? html`<${Chip} tone="muted">${x('chipExpiring', { n: ctx.expiring })}<//>` : html`<${Chip} tone="muted">${x('chipNoExpiry')}<//>`}
    <//>` : null}
  <//>`;
}

/** The one loud action (the grant form) and the doors. */
function mastActions(ctx) {
  return html`<${Stack} density="compact" align="end">
    <${Action} kind="primary" onClick=${() => ctx.toggleForm(true)}>${x('grantSlab')}<//>
    <${Text} kind="caption" tone="muted">${x('grantSlabHint')}<//>
    <${Stack} direction="wrap" density="compact">
      <${Action} disabled=${ctx.exporting} onClick=${() => ctx.exportAll()}>${ctx.exporting ? x('exporting') : x('exportDoor')}<//>
      <${Action} kind="text" onClick=${() => scrollToId('dw-roads')}>${x('toAi')}<//>
    <//>
  <//>`;
}

function strip(ctx) {
  const ov = ctx.ov;
  if (!ov) return html`<${NumeralBand} tone="plain" items=${[1, 2, 3, 4].map((i) => ({ id: i, label: '', value: '…' }))} />`;
  const ps = ov.permSummary;
  const kinds = ctx.kinds;
  const kindWords = ['person', 'orgMembers', 'company', 'node', 'domain', 'agent', 'all'].filter((k) => kinds[k]).map((k) => x('kindN.' + k, { n: kinds[k] })).join(' · ');
  return html`<${NumeralBand} tone="plain" items=${[
    { id: 'keys', label: x('stripKeys'), value: n(ps.total_memory_keys), note: x('stripKeysSub', { files: n(ps.total_storage_files) }) },
    { id: 'grants', label: x('stripGrants'), value: ctx.active.length, note: kindWords || x('stripNoGrants') },
    ctx.deniedCount
      ? { id: 'denied', label: x('stripDenied', { days: ctx.days }), value: n(ctx.deniedCount), tone: 'coral', note: x('stripDeniedSub', { groups: ctx.deniedGroups }) }
      : { id: 'denied', label: x('stripDenied', { days: ctx.days }), value: '·', note: x('stripQuietSub') },
    { id: 'revoked', label: x('stripRevoked'), value: ctx.revokedList.length, note: ctx.revokedList.length ? x('stripRevokedSub', { swapped: ctx.swapped, removed: ctx.revokedList.length - ctx.swapped }) : x('stripRevokedNone') },
  ]} />`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTargets(ctx) {
  const f = ctx.filter;
  const filters = [['all', ctx.targets.length], ['orgs', ctx.targets.filter((r) => r.kind === 'org').length], ['keys', ctx.targets.filter((r) => r.kind === 'key').length], ['revoked', ctx.revokedList.length], ['people', ctx.people.length]];
  const list = f === 'orgs' ? ctx.targets.filter((r) => r.kind === 'org') : f === 'keys' ? ctx.targets.filter((r) => r.kind === 'key') : ctx.targets;
  const shown = ctx.personFocus && f === 'people' ? ctx.people.filter((p) => p.name === ctx.personFocus).concat(ctx.people.filter((p) => p.name !== ctx.personFocus)) : ctx.people;
  return html`
    <${Section} id="dw-targets" title=${x('secTargets')} count=${x('secTargetsSub', { n: ctx.active.length, targets: ctx.targets.length })}>
      <${Stack}>
        <${Text} tone="muted">${x('targetsIntro')}<//>
        ${ctx.active.length || ctx.revokedList.length ? html`
          <${Toolbar} label=${x('secTargets')} filters=${filters.map(([id, k]) => ({ id, label: `${x('filter.' + id)} · ${k}`, selected: f === id, onClick: () => ctx.setFilter(id) }))} />` : null}
        ${f === 'revoked' ? (ctx.revokedList.length ? html`<${Stack} density="compact">${ctx.revokedList.map((c) => revokedRow(ctx, c))}<//>` : html`<${Text} tone="muted">${x('noRevoked')}<//>`)
          : f === 'people' ? (ctx.people.length ? html`<${Stack} density="compact">${shown.map((p) => personRow(ctx, p))}<//>` : html`<${Text} tone="muted">${x('noGrants')}<//>`)
          : list.length ? html`<${Stack} density="compact">${list.map((r) => targetRow(ctx, r))}<//>`
            : html`<${Text}><strong>${x('noGrantsTitle')}</strong> ${x('noGrantsBody')}<//>`}
        <${Surface} kind="aside"><${Text}><strong>${x('howTitle')}</strong> ${x('howBody')}<//><//>
      <//>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTrail(ctx) {
  const ov = ctx.ov;
  const items = ctx.trail;
  const shown = items.slice(0, ctx.shownTrail);
  return html`
    <${Section} id="dw-trail" title=${x('secTrail')} count=${x('secTrailSub', { days: ctx.days, denied: n(ctx.deniedCount), events: ctx.events.length })}>
      <${Stack}>
        <${Text} tone="muted">${x('trailIntro')}<//>
        <${Toolbar} label=${x('secTrail')} filters=${[
          ...[7, 30, 90].map((d) => ({ id: 'd' + d, label: `${x('daysN', { n: d })}${ctx.days === d ? ` · ${n(ov.audit.total)}` : ''}`, selected: ctx.days === d, disabled: ctx.reloading, onClick: () => ctx.setDays(d) })),
          { id: 'events', label: `${x('filter.eventsOnly')} · ${ctx.events.length}`, selected: ctx.trailFilter === 'events', onClick: () => ctx.setTrailFilter(ctx.trailFilter === 'events' ? 'all' : 'events') },
        ]} />
        ${items.length ? html`
          <${Stack} density="compact">${shown.map((it) => (it.kind === 'group' ? groupRow(ctx, it.group) : eventRow(ctx, it.event)))}<//>
          ${items.length > shown.length ? html`<${Stack} direction="horizontal" align="start"><${Action} onClick=${() => ctx.showMoreTrail()}>${x('moreRows', { n: items.length - shown.length })}<//><//>` : null}`
          : html`<${Text}><strong>${x('trailEmptyTitle')}</strong> ${x('trailEmptyBody')}<//>`}
        ${ctx.manifestShare >= 0.5 && ctx.deniedCount >= 20 ? html`<${Surface} kind="aside"><${Text}><strong>${x('meaningTitle')}</strong> ${x('meaningManifest', { n: n(ctx.manifestDenied), total: n(ctx.deniedCount) })}<//><//>` : null}
      <//>
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

/** One choice of a form's row: a radio tab, on when the form holds that value. */
function opt(ctx, field, value, label) {
  return html`<${Action} kind="tab" semantics="radio" selected=${ctx.form[field] === value} onClick=${() => ctx.setForm({ [field]: value })}>${label}<//>`;
}

/** A labelled row of the grant form: the label, the controls, the hint under them. */
const formRow = (label, controls, hint) => html`<${Stack} density="compact">
  <${Text} kind="label">${label}<//>${controls}${hint ? html`<${Text} kind="caption" tone="muted">${hint}<//>` : null}
<//>`;

/** A row of radio tabs. */
const opts = (label, children) => html`<${Stack} direction="wrap" density="compact" role="radiogroup" label=${label}>${children}<//>`;

function secGrant(ctx) {
  const f = ctx.form;
  const org = ctx.orgs.find((o) => o.id === f.orgId);
  const wsList = org?.workspaces || [];
  const canWrite = f.what === 'ws';
  const whoIsPicker = f.whoKind === 'contact';
  const ready = (whoIsPicker ? !!f.who.trim() : true) && (f.what === 'key' ? !!f.key.trim() : !!f.orgId && (f.what !== 'ws' || !!f.wsId)) && !!f.why.trim();
  return html`
    <${Fold} id="dw-grant" number="03" title=${x('secGrant')} sub=${`${ctx.active.length} / ${ctx.quota}`} open=${f.open} onToggle=${() => ctx.toggleForm()}>
      <${Stack}>
        <${Text} tone="muted">${x('grantIntro')}<//>
        ${formRow(x('form.who'), html`
          ${opts(x('form.who'), html`${opt(ctx, 'whoKind', 'contact', x('form.whoContact'))}${opt(ctx, 'whoKind', 'orgMembers', x('form.whoOrgMembers'))}${opt(ctx, 'whoKind', 'nodeUsers', x('form.whoNodeUsers'))}${opt(ctx, 'whoKind', 'all', x('form.whoAll'))}`)}
          ${whoIsPicker ? html`<${ContactPicker} value=${f.who} onChange=${(v) => ctx.setForm({ who: v })} valueMode="full" placeholder=${x('form.whoPlaceholder')} />` : null}`,
          f.whoKind === 'all' ? x('form.whoAllHint') : f.whoKind === 'orgMembers' ? x('form.whoOrgMembersHint') : f.whoKind === 'nodeUsers' ? x('form.whoNodeUsersHint') : x('form.whoHint'))}
        ${formRow(x('form.what'), html`
          ${opts(x('form.what'), html`${opt(ctx, 'what', 'ws', x('form.whatWs'))}${opt(ctx, 'what', 'org', x('form.whatOrg'))}${opt(ctx, 'what', 'key', x('form.whatKey'))}`)}
          ${f.what === 'key' ? html`<${Field} ariaLabel=${x('form.whatKey')} value=${f.key} placeholder="portfolio/contact*" onInput=${(e) => ctx.setForm({ key: e.target.value })} />` : html`
            <${Field} type="select" ariaLabel=${x('form.whatOrg')} value=${f.orgId} onChange=${(e) => ctx.setForm({ orgId: e.target.value, wsId: '' })}
              options=${[{ value: '', label: ctx.orgs.length ? x('form.pickOrg') : x('form.noOrgs') }, ...ctx.orgs.map((o) => ({ value: o.id, label: o.name }))]} />
            ${f.what === 'ws' ? html`<${Field} type="select" ariaLabel=${x('form.whatWs')} value=${f.wsId} disabled=${!f.orgId} onChange=${(e) => ctx.setForm({ wsId: e.target.value })}
              options=${[{ value: '', label: !f.orgId ? x('form.pickOrgFirst') : wsList.length ? x('form.pickWs') : x('form.noWs') }, ...wsList.map((w) => ({ value: w.id, label: w.name }))]} />` : null}`}`,
          f.what === 'key' ? x('form.keyHint') : f.what === 'ws' ? x('form.wsHint') : x('form.orgHint'))}
        ${formRow(x('form.may'), opts(x('form.may'), html`${opt(ctx, 'may', 'read', x('form.mayRead'))}${canWrite ? opt(ctx, 'may', 'write', x('form.mayWrite')) : null}`), x('form.mayHint'))}
        ${formRow(x('form.why'), html`<${Field} ariaLabel=${x('form.why')} value=${f.why} placeholder=${x('form.whyPlaceholder')} onInput=${(e) => ctx.setForm({ why: e.target.value })} />`)}
        ${formRow(x('form.scope'), opts(x('form.scope'), html`${opt(ctx, 'scope', 'private', x('form.scopePrivate'))}${opt(ctx, 'scope', 'federation', x('form.scopeFederation'))}`), x('form.scopeHint'))}
        ${formRow(x('form.until'), html`
          ${opts(x('form.until'), html`${opt(ctx, 'untilKind', 'never', x('form.untilNever'))}${opt(ctx, 'untilKind', 'date', x('form.untilDate'))}`)}
          ${f.untilKind === 'date' ? html`<${Field} type="date" width="narrow" ariaLabel=${x('form.untilDate')} value=${f.until} onInput=${(e) => ctx.setForm({ until: e.target.value })} />` : null}`)}
        <${Stack} direction="wrap" density="compact" align="center">
          <${Action} disabled=${!ready || ctx.busy === 'grant'} onClick=${() => ctx.submitGrant()}>${ctx.busy === 'grant' ? x('granting') : x('grantSlab')}<//>
          <${Action} kind="text" onClick=${() => ctx.toggleForm(false)}>${x('cancel')}<//>
          ${msgLine(ctx.formMsg)}
        <//>
      <//>
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
    <${Section} id="dw-export" title=${x('secExport')} count=${x('secExportSub', { keys: n(ps.total_memory_keys), files: n(ps.total_storage_files) })}>
      <${Stack}>
        <${Text} tone="muted">${x('exportIntro', { mb })}<//>
        <${Columns} layout="thirds" density="compact" collapse="640">
          ${items.map(([k, sub]) => html`<${Stack} key=${k} density="compact">
            <${Text}><strong>${x('export.' + k)}</strong><//>
            <${Text} kind="mono" tone="muted">${sub}<//>
          <//>`)}
        <//>
        <${Surface} kind="box"><${Stack} direction="wrap" align="center">
          <${Action} disabled=${ctx.exporting} onClick=${() => ctx.exportAll()}>${ctx.exporting ? x('exporting') : x('exportDoor')}<//>
          <${Stack} density="compact">
            <${Text}>${x('exportBody', { file: ctx.exportName })}<//>
            ${msgLine(ctx.exportMsg)}
          <//>
        <//><//>
      <//>
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads() {
  const ask = x('roadAskPrompt');
  return html`
    <${Section} id="dw-roads" title=${x('secRoads')}>
      <${Columns} layout="leading" collapse="640">
        <${Surface} kind="record"><${Stack}>
          <${Text} kind="label">${x('roadAskTitle')}<//>
          <${Text}>${x('roadAskBody')}<//>
          <${Surface} kind="code">${ask}<//>
          <${Stack} direction="horizontal" align="start">
            <${CopyAction} text=${ask} label=${x('copyPrompt')} />
          <//>
        <//><//>
        <${Surface} kind="box"><${Stack}>
          <${Text} kind="label">${x('roadAgentTitle')}<//>
          <${Text}>${x('roadAgentBody')}<//>
          <${Text} kind="mono" tone="muted">aimeat_consent_list · aimeat_consent_grant · aimeat_consent_revoke · ${x('roadAgentScope')}<//>
        <//><//>
      <//>
    <//>`;
}

export { whoOf, groupId };
