/**
 * @file public/views/profile/data-wallet/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Data Wallet page in the poster face: the mast says what the wallet is and
 *   opens the grant form; the strip says what you own, how many permissions stand, what was refused
 *   this window and what you revoked; 01 who reaches what (one row per target, turnable by people,
 *   the revoked ones); 02 what happened (the trail grouped: who tried what, how many times, with the
 *   grants and revocations read off the permissions' own timestamps); 03 the grant form as a fold;
 *   04 everything you own as one file, with what is inside; 05 classification (classification.js);
 *   06 how your AI uses the wallet. A wallet that lives on another server shows one box. Pure render
 *   over the ctx bag; the rows are rows.js.
 * @structure renderPage · federated · head · strip · secTargets · secTrail · secGrant · secExport ·
 *   secRoads
 * @usage import { renderPage } from './data-wallet/page.js';
 * @version-history
 *   v1.22.0 — 2026-09-29 — Section 05 is classification (TARGET-082 V5, data-wallet/classification.js),
 *     and how your AI uses the wallet moves to 06.
 *   v1.21.0 — 2026-09-26 — On the component kit (page group G7): the frame, crumb, head, rail and
 *     strip are SettingsPage and FigureStrip; the sections are Section (a fold for 03); the filters
 *     are Tabs in the filter tone with the one at the end a Filter; the lists are List; the grant
 *     form is Field, Choice, Select and TextField with FormActions; the boxes are Box and SettingBox;
 *     what the export holds is CardGrid; the two roads are Roads; the tags keep main's dim tone
 *     (Mark tone="dim", og-chip--dim on main). The page writes no class.
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
import { ContactPicker } from '/components/ContactPicker.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { scrollToSection } from '/components/Rail.js';
import { Tabs } from '/components/Tabs.js';
import { List, Filter, More } from '/components/List.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box, SettingBox } from '/components/Box.js';
import { Card, CardGrid } from '/components/Card.js';
import { Roads, Road } from '/components/Roads.js';
import { Row as Line } from '/components/Layout.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { x, n, crumb, pageLinks, whoOf } from './frame.js';
import { targetRow, personRow, revokedRow, groupRow, eventRow, groupId } from './rows.js';
import { secClassification, classificationCount } from './classification.js';

const msg = (m) => (m ? html`<${Note} kind="message" error=${!!m.error}>${m.text}<//>` : null);

export function renderPage(ctx) {
  if (ctx.federated) return federated(ctx);
  const ov = ctx.ov;
  const sections = [
    { id: 'dw-targets', num: '01', label: x('secTargets'), count: ov ? String(ctx.active.length) : '' },
    { id: 'dw-trail', num: '02', label: x('secTrail'), count: ov ? n(ctx.deniedCount) : '' },
    { id: 'dw-grant', num: '03', label: x('secGrant'), count: ov ? `${ctx.active.length} / ${ctx.quota}` : '' },
    { id: 'dw-export', num: '04', label: x('secExport'), count: ov ? n(ov.permSummary.total_memory_keys) : '' },
    { id: 'dw-class', num: '05', label: x('cls.title'), count: classificationCount(ctx.cls) },
    { id: 'dw-roads', num: '06', label: x('secRoads'), count: '' },
  ];
  return html`
    <${SettingsPage} name="dw" crumb=${crumb()} ...${head(ctx)} strip=${strip(ctx)}
      railTitle=${x('railTitle')} sections=${sections} pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${!ov ? (ctx.failed ? html`<${Note} kind="quiet">${x('loadFailed')}<//>` : html`<${Note} kind="loading">${x('loading')}<//>`) : html`
        ${secTargets(ctx)}
        ${secTrail(ctx)}
        ${secGrant(ctx)}
        ${secExport(ctx)}
        ${secClassification(ctx, '05')}
        ${secRoads()}`}
    <//>`;
}

function federated(ctx) {
  return html`
    <${SettingsPage} name="dw" crumb=${crumb()} title=${t('profile.tabs.dataWallet')} sub=${x('titleSub')} desc=${x('desc')}>
      <${SettingBox} label=${x('federatedLabel')} irreversible>${x('federatedBody', { node: ctx.session?.homeNode || '?' })}<//>
    <//>`;
}

/** The mast as SettingsPage's head props: title, the tags, the words, the grant slab and its doors. */
function head(ctx) {
  const ov = ctx.ov;
  const ps = ov?.permSummary;
  const marks = !ov ? [] : [
    { label: x('chipOwn', { keys: n(ps.total_memory_keys), files: n(ps.total_storage_files) }), tone: 'sun' },
    { label: x('chipGrants', { active: ctx.active.length, revoked: ctx.revokedList.length }) },
    ctx.deniedCount ? { label: x('chipDenied', { n: n(ctx.deniedCount), days: ctx.days }), tone: 'coral' } : { label: x('chipQuiet', { days: ctx.days }), tone: 'dim' },
    ctx.expiring ? { label: x('chipExpiring', { n: ctx.expiring }), tone: 'dim' } : { label: x('chipNoExpiry'), tone: 'dim' },
  ];
  const actions = html`
    <${Loud} onClick=${() => ctx.toggleForm(true)}>${x('grantSlab')}<//>
    <${Note} kind="hint" slab inline>${x('grantSlabHint')}<//>
    <${Actions}>
      <${Action} small disabled=${ctx.exporting} onClick=${() => ctx.exportAll()}>${ctx.exporting ? x('exporting') : x('exportDoor')}<//>
      <${Action} small soft onClick=${() => scrollToSection('dw-roads')}>${x('toAi')}<//>
    <//>`;
  return { title: t('profile.tabs.dataWallet'), sub: x('titleSub'), marks, desc: x('desc'), actions };
}

function strip(ctx) {
  const ov = ctx.ov;
  if (!ov) return html`<${FigureStrip} loading=${4} />`;
  const ps = ov.permSummary;
  const kinds = ctx.kinds;
  const kindWords = ['person', 'orgMembers', 'company', 'node', 'domain', 'agent', 'all'].filter((k) => kinds[k]).map((k) => x('kindN.' + k, { n: kinds[k] })).join(' · ');
  return html`<${FigureStrip} wrap items=${[
    { n: n(ps.total_memory_keys), label: x('stripKeys'), sub: x('stripKeysSub', { files: n(ps.total_storage_files) }) },
    { n: ctx.active.length, label: x('stripGrants'), sub: kindWords || x('stripNoGrants') },
    ctx.deniedCount
      ? { n: n(ctx.deniedCount), tone: 'notice', label: x('stripDenied', { days: ctx.days }), sub: x('stripDeniedSub', { groups: ctx.deniedGroups }) }
      : { n: '·', tone: 'dim', label: x('stripDenied', { days: ctx.days }), sub: x('stripQuietSub') },
    { n: ctx.revokedList.length, label: x('stripRevoked'), sub: ctx.revokedList.length ? x('stripRevokedSub', { swapped: ctx.swapped, removed: ctx.revokedList.length - ctx.swapped }) : x('stripRevokedNone') },
  ]} />`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTargets(ctx) {
  const f = ctx.filter;
  const filters = [['all', ctx.targets.length], ['orgs', ctx.targets.filter((r) => r.kind === 'org').length], ['keys', ctx.targets.filter((r) => r.kind === 'key').length], ['revoked', ctx.revokedList.length]];
  const list = f === 'orgs' ? ctx.targets.filter((r) => r.kind === 'org') : f === 'keys' ? ctx.targets.filter((r) => r.kind === 'key') : ctx.targets;
  const shown = ctx.personFocus && f === 'people' ? ctx.people.filter((p) => p.name === ctx.personFocus).concat(ctx.people.filter((p) => p.name !== ctx.personFocus)) : ctx.people;
  return html`
    <${Section} id="dw-targets" num="01" title=${x('secTargets')} count=${x('secTargetsSub', { n: ctx.active.length, targets: ctx.targets.length })} first=${true}>
      <${Note} kind="lead">${x('targetsIntro')}<//>
      ${ctx.active.length || ctx.revokedList.length ? html`
        <${Tabs} tone="filter" value=${f} onSelect=${(v) => ctx.setFilter(v)}
          items=${filters.map(([id, k]) => ({ value: id, label: x('filter.' + id), count: k }))}>
          <${Filter} end on=${f === 'people'} count=${ctx.people.length} onClick=${() => ctx.setFilter('people')}>${x('filter.people')}<//>
        <//>` : null}
      ${f === 'revoked' ? html`
        <${List} cols="name-desc-span-doors" keepCols head=${[x('col.target'), x('col.whoWhat'), x('col.span'), '']} empty=${x('noRevoked')}>
          ${ctx.revokedList.map((c) => revokedRow(ctx, c))}
        <//>`
      : f === 'people' ? html`
        <${List} cols="name-desc-since-doors" keepCols head=${[x('col.who'), x('col.reaches'), x('col.since'), '']} empty=${x('noGrants')}>
          ${shown.map((p) => personRow(ctx, p))}
        <//>`
      : html`
        <${List} cols="name-desc-since-doors" keepCols head=${[x('col.target'), x('col.whoWhat'), x('col.since'), '']}
          empty=${html`<${Note} kind="quiet"><b>${x('noGrantsTitle')}</b> ${x('noGrantsBody')}<//>`}>
          ${list.map((r) => targetRow(ctx, r))}
        <//>`}
      <${Box}><b>${x('howTitle')}</b> ${x('howBody')}<//>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTrail(ctx) {
  const ov = ctx.ov;
  const items = ctx.trail;
  const shown = items.slice(0, ctx.shownTrail);
  const events = ctx.trailFilter === 'events';
  return html`
    <${Section} id="dw-trail" num="02" title=${x('secTrail')} count=${x('secTrailSub', { days: ctx.days, denied: n(ctx.deniedCount), events: ctx.events.length })}>
      <${Note} kind="lead">${x('trailIntro')}<//>
      <${Tabs} tone="filter" value=${ctx.days} disabled=${ctx.reloading} onSelect=${(d) => ctx.setDays(d)}
        items=${[7, 30, 90].map((d) => ({ value: d, label: x('daysN', { n: d }), count: ctx.days === d ? n(ov.audit.total) : undefined }))}>
        <${Filter} end on=${events} count=${ctx.events.length} onClick=${() => ctx.setTrailFilter(events ? 'all' : 'events')}>${x('filter.eventsOnly')}<//>
      <//>
      <${List} cols="name-desc-count-when-doors" keepCols head=${[x('col.who'), x('col.what'), { label: x('col.times'), num: true }, x('col.when'), '']}
        empty=${html`<${Note} kind="quiet"><b>${x('trailEmptyTitle')}</b> ${x('trailEmptyBody')}<//>`}>
        ${shown.map((it) => (it.kind === 'group' ? groupRow(ctx, it.group) : eventRow(ctx, it.event)))}
      <//>
      ${items.length > shown.length ? html`<${More} label=${x('moreRows', { n: items.length - shown.length })} onMore=${() => ctx.showMoreTrail()} />` : null}
      ${ctx.manifestShare >= 0.5 && ctx.deniedCount >= 20 ? html`<${Box}><b>${x('meaningTitle')}</b> ${x('meaningManifest', { n: n(ctx.manifestDenied), total: n(ctx.deniedCount) })}<//>` : null}
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

/** One of the form's choices: a row of answers that sets one field of the form. */
function opt(ctx, field, label, options) {
  return html`<${Choice} ariaLabel=${label} value=${ctx.form[field]} options=${options} onChange=${(v) => ctx.setForm({ [field]: v })} />`;
}

function secGrant(ctx) {
  const f = ctx.form;
  const org = ctx.orgs.find((o) => o.id === f.orgId);
  const wsList = org?.workspaces || [];
  const canWrite = f.what === 'ws';
  const whoIsPicker = f.whoKind === 'contact';
  const ready = (whoIsPicker ? !!f.who.trim() : true) && (f.what === 'key' ? !!f.key.trim() : !!f.orgId && (f.what !== 'ws' || !!f.wsId)) && !!f.why.trim();
  const whoHint = f.whoKind === 'all' ? x('form.whoAllHint') : f.whoKind === 'orgMembers' ? x('form.whoOrgMembersHint') : f.whoKind === 'nodeUsers' ? x('form.whoNodeUsersHint') : x('form.whoHint');
  const whatHint = f.what === 'key' ? x('form.keyHint') : f.what === 'ws' ? x('form.wsHint') : x('form.orgHint');
  return html`
    <${Section} fold id="dw-grant" num="03" title=${x('secGrant')} sub=${`${ctx.active.length} / ${ctx.quota}`} open=${f.open} onToggle=${() => ctx.toggleForm()}>
      <${Note} kind="lead">${x('grantIntro')}<//>
      <${Fields}>
        <${Field} label=${x('form.who')} hint=${whoHint} group>
          ${opt(ctx, 'whoKind', x('form.who'), [['contact', x('form.whoContact')], ['orgMembers', x('form.whoOrgMembers')], ['nodeUsers', x('form.whoNodeUsers')], ['all', x('form.whoAll')]])}
          ${whoIsPicker ? html`<${ContactPicker} value=${f.who} onChange=${(v) => ctx.setForm({ who: v })} valueMode="full" placeholder=${x('form.whoPlaceholder')} />` : null}
        <//>
        <${Field} label=${x('form.what')} hint=${whatHint} group>
          ${opt(ctx, 'what', x('form.what'), [['ws', x('form.whatWs')], ['org', x('form.whatOrg')], ['key', x('form.whatKey')]])}
          ${f.what === 'key' ? html`<${TextField} ariaLabel=${x('form.whatKey')} value=${f.key} placeholder="portfolio/contact*" onInput=${(v) => ctx.setForm({ key: v })} />` : html`
            <${Select} ariaLabel=${x('form.whatOrg')} value=${f.orgId} placeholder=${ctx.orgs.length ? x('form.pickOrg') : x('form.noOrgs')}
              options=${ctx.orgs.map((o) => [o.id, o.name])} onChange=${(v) => ctx.setForm({ orgId: v, wsId: '' })} />
            ${f.what === 'ws' ? html`<${Select} ariaLabel=${x('form.whatWs')} value=${f.wsId} disabled=${!f.orgId}
              placeholder=${!f.orgId ? x('form.pickOrgFirst') : wsList.length ? x('form.pickWs') : x('form.noWs')}
              options=${wsList.map((w) => [w.id, w.name])} onChange=${(v) => ctx.setForm({ wsId: v })} />` : null}`}
        <//>
        <${Choice} label=${x('form.may')} hint=${x('form.mayHint')} value=${f.may} onChange=${(v) => ctx.setForm({ may: v })}
          options=${[['read', x('form.mayRead')], canWrite ? ['write', x('form.mayWrite')] : null].filter(Boolean)} />
        <${TextField} label=${x('form.why')} value=${f.why} placeholder=${x('form.whyPlaceholder')} onInput=${(v) => ctx.setForm({ why: v })} />
        <${Choice} label=${x('form.scope')} hint=${x('form.scopeHint')} value=${f.scope} onChange=${(v) => ctx.setForm({ scope: v })}
          options=${[['private', x('form.scopePrivate')], ['federation', x('form.scopeFederation')]]} />
        <${Field} label=${x('form.until')} group>
          ${opt(ctx, 'untilKind', x('form.until'), [['never', x('form.untilNever')], ['date', x('form.untilDate')]])}
          ${f.untilKind === 'date' ? html`<${TextField} type="date" ariaLabel=${x('form.untilDate')} value=${f.until} onInput=${(v) => ctx.setForm({ until: v })} />` : null}
        <//>
        <${FormActions}>
          <${Loud} control disabled=${!ready || ctx.busy === 'grant'} onClick=${() => ctx.submitGrant()}>${ctx.busy === 'grant' ? x('granting') : x('grantSlab')}<//>
          <${Action} small soft onClick=${() => ctx.toggleForm(false)}>${x('cancel')}<//>
          ${msg(ctx.formMsg)}
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
    <${Section} id="dw-export" num="04" title=${x('secExport')} count=${x('secExportSub', { keys: n(ps.total_memory_keys), files: n(ps.total_storage_files) })}>
      <${Note} kind="lead">${x('exportIntro', { mb })}<//>
      <${CardGrid}>${items.map(([k, sub]) => html`<${Card} key=${k} name=${x('export.' + k)} meta=${sub} />`)}<//>
      <${Box}>
        <${Line} gap="large" wrap>
          <${Loud} control disabled=${ctx.exporting} onClick=${() => ctx.exportAll()}>${ctx.exporting ? x('exporting') : x('exportDoor')}<//>
          <span>${x('exportBody', { file: ctx.exportName })} ${msg(ctx.exportMsg)}</span>
        <//>
      <//>
    <//>`;
}

/* ── 06 (05, the classification, is data-wallet/classification.js) ─────────────────────────────── */

function secRoads() {
  const ask = x('roadAskPrompt');
  return html`
    <${Section} id="dw-roads" num="06" title=${x('secRoads')}>
      <${Roads} wide>
        <${Road} lead name=${x('roadAskTitle')} text=${x('roadAskBody')} code=${ask}
          doors=${html`<${Action} small soft copy=${ask}>${x('copyPrompt')}<//>`} />
        <${Road} name=${x('roadAgentTitle')} text=${x('roadAgentBody')}
          meta=${`aimeat_consent_list · aimeat_consent_grant · aimeat_consent_revoke · ${x('roadAgentScope')}`} />
      <//>
    <//>`;
}

export { whoOf, groupId };
