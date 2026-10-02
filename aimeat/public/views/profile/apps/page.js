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
 *   over the ctx bag, made of the component kit: the page passes data and never a class.
 * @structure renderPage · secWaiting · secKunto · secNewest · secFirst
 * @usage import { renderPage } from './apps/page.js';
 * @version-history
 *   v2.1.0 -- 2026-10-03 -- The page's start (components/PageStart.js: the first prompt asks the person's AI for an app, the build prompt's copy is its button) and the title's question mark, concept.app (guidance part B).
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): the frame
 *     is SettingsPage (crumb, head, marks, strip, rail as data), the strip FigureStrip; what waits
 *     is the List (a draft's Status, a grant's sun Tag, the doors; the diff and the permissions open
 *     in the List's Panel, the raised box most opened rows have, where they were the dashed aside),
 *     the diff's lines the Code block with its added or removed edge; the condition rows the List's
 *     n-name-doors cut with the poster Figure (coral when loud); the newest apps the List with the
 *     Avatar, the three-line Desc and its requires line, the note a typewriter Cell, the opens a
 *     strong Num. The first-step and the opens tags are the dim Tag again (main's og-chip--dim,
 *     which the previous branch lost).
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
import { SettingsPage } from '/components/SettingsPage.js';
import { PageStart } from '/components/PageStart.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { List, Row, Name, Desc, Cell, Num, Doors, Panel, Lead } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Marks, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Space } from '/components/Layout.js';
import { scrollToSection } from '/components/Rail.js';
import { a, day, rel, kb, nameOf, appRef, appUrl, catalogUrl, noteFor, initials, crumb, pageLinks, goTab } from './frame.js';
import { secAgents, secBuild } from './build.js';
import { CollaborationSection, PublishDialog } from './collaboration.js';
import { secBuilders } from './builders.js';

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
  const fmt = (n) => fmtNum(n);

  const strip = html`<${FigureStrip} items=${none ? [
    { key: 'apps', n: 0, label: a('stripApps'), sub: a('stripNone') },
    { key: 'drafts', n: 0, label: a('stripDrafts'), sub: a('stripNone') },
    { key: 'opens', n: 0, label: a('stripOpens'), sub: a('stripNone') },
    { key: 'community', n: ctx.community, label: a('stripCommunity'), sub: a('stripCommunitySub', { n: ctx.communityOwners }) },
  ] : [
    { key: 'apps', n: apps.length, label: a('stripApps'), sub: a('stripAppsSub', { listed, unlisted: apps.length - listed }) },
    { key: 'drafts', n: drafts.length, tone: drafts.length ? 'coral' : undefined, label: a('stripDrafts'), sub: drafts.length ? drafts.map(nameOf).slice(0, 2).join(' · ') : a('stripDraftsNone') },
    { key: 'opens', n: fmt(opens), label: a('stripOpens'), sub: top.length ? top.map((x) => `${nameOf(x)} ${fmt(x.downloads || 0)}`).join(' · ') : a('stripNone') },
    { key: 'grants', n: grants.length, label: a('stripGrants'), sub: grants.length ? grants.map((g) => g.app_name || g.app).slice(0, 2).join(' · ') : a('stripGrantsNone') },
  ]} />`;

  const marks = [
    none ? { label: a('chipNone'), tone: 'coral' } : { label: a('chipCount', { n: apps.length }) },
    none ? { label: a('chipFirst'), tone: 'dim' } : drafts.length ? { label: a('chipDrafts', { n: drafts.length }), tone: 'coral' } : null,
    none ? null : { label: a('chipOpens', { n: fmt(opens) }), tone: 'dim' },
  ];

  const actions = none
    ? html`<${Loud} control copy=${ctx.buildPrompt} copiedLabel=${a('promptCopied')} disabled=${!ctx.buildPrompt} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))}>${a('promptDoor')}<//>
      <${Actions}>
        <${Action} small onClick=${() => scrollToSection('ap-build')}>${a('uploadDoor')}<//>
        <${Action} small soft href=${catalogUrl()} newTab>${a('catalogDoor')}<//>
      <//>`
    : html`<${Loud} href=${catalogUrl()} newTab>${a('catalogDoor')}<//>
      <${Actions}><${Action} small onClick=${() => scrollToSection('ap-build')}>${a('uploadDoor')}<//><//>`;

  const sections = none
    ? [{ id: 'ap-first', num: '01', label: a('secFirst'), count: '' }, { id: 'ap-waiting', num: '02', label: a('secWaiting'), count: 0 }, { id: 'ap-kunto', num: '03', label: a('secKunto'), count: '' }, { id: 'ap-build', num: '04', label: a('uploadLabel'), count: '' }]
    : [{ id: 'ap-waiting', num: '01', label: a('secWaiting'), count: waiting }, { id: 'ap-kunto', num: '02', label: a('secKunto'), count: '' }, { id: 'ap-newest', num: '03', label: a('secNewest'), count: Math.min(apps.length, 6) }, { id: 'ap-agents', num: '04', label: a('secAgents'), count: '' }, { id: 'ap-build', num: '05', label: a('secBuild'), count: '' }, { id: 'ap-builders', num: '06', label: a('secBuilders'), count: '' }];

  return html`
    <${SettingsPage} name="apps" crumb=${crumb()} title=${t('profile.tabs.apps')} sub=${a('titleSub')} help="concept.app" marks=${marks}
      desc=${none ? a('descEmpty') : a('desc')} actions=${actions} strip=${strip}
      start=${html`<${PageStart} id="apps" done=${loading ? null : !none} action=${ctx.buildPrompt ? { copy: ctx.buildPrompt } : null} />`}
      railTitle=${a('railTitle')} sections=${sections} pagesLabel=${a('pages')} pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />
        ${ctx.publishApp ? html`<${PublishDialog} key=${appRef(ctx.publishApp)} app=${ctx.publishApp} busy=${!!ctx.busy} onPublish=${ctx.submitPublish} onClose=${ctx.closePublish} />` : null}`}>
      ${none ? html`${secFirst(ctx)}${secWaiting(ctx, drafts, grants, '02')}${secKunto(ctx, '03')}${secBuild(ctx, { formOnly: true, num: '04' })}`
        : loading ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : html`${secWaiting(ctx, drafts, grants, '01')}${secKunto(ctx, '02')}${secNewest(ctx, apps)}${secAgents(ctx)}${secBuild(ctx, { formOnly: false, num: '05' })}${secBuilders(ctx)}`}
      ${!loading ? html`<${CollaborationSection} ctx=${ctx} />` : null}
    <//>`;
}

/* ── 01 · What waits for you ─────────────────────────────────────────────────────────────────── */

function secWaiting(ctx, drafts, grants, num) {
  const waiting = drafts.length + grants.length;
  return html`
    <${Section} id="ap-waiting" num=${num} title=${a('secWaiting')} count=${waiting} first=${num === '01'}>
      <${List} cols="name-tag-doors" empty=${ctx.apps && ctx.apps.length ? a('waitingEmpty') : a('waitingEmptyNew')}>
        ${drafts.map((app) => draftRow(ctx, app))}
        ${grants.map((g) => grantRow(ctx, g))}
      <//>
      <${Note}>${a('waitingHint')}<//>
    <//>`;
}

function draftRow(ctx, app) {
  const ref = appRef(app);
  const open = ctx.diff && ctx.diff.ref === ref;
  const busy = ctx.busy === ref;
  return html`
    <${Row} key=${'d' + ref} open=${open}>
      <${Name} meta=${a('draftMeta', { version: app.manifest?.version || '', date: day(app.created_at), opens: app.downloads || 0 })}>${nameOf(app)}<//>
      <${Cell}><${Mark} kind="status" tone="attention">${a('draftChip')}<//><//>
      <${Doors}>
        <${Action} small disabled=${busy} onClick=${() => ctx.publishDraft(app)}>${a('publishDraft')}<//>
        <${Action} small soft onClick=${() => ctx.toggleDiff(app)}>${open ? a('hideChanges') : a('viewChanges')}<//>
        <${Action} small soft disabled=${busy} onClick=${() => ctx.discardDraft(app)}>${a('discardDraft')}<//>
      <//>
      ${open ? diffPanel(ctx.diff) : null}
    <//>`;
}

function diffPanel(diff) {
  if (diff.state === 'loading') return html`<${Panel}><${Note} kind="loading">${a('diffLoading')}<//><//>`;
  if (diff.state === 'failed') return html`<${Panel}><${Note} kind="quiet">${a('diffFailed')}<//><//>`;
  const d = diff.result;
  return html`
    <${Panel}>
      <${Note} kind="lead">${d.addedTotal || d.removedTotal ? a('diffTitle', { added: d.addedTotal, removed: d.removedTotal }) : a('diffNone')}<//>
      ${d.added.length ? html`<${Label} block>${a('diffAdded')}<//><${Code} block scroll change="added">${d.added.join('\n')}<//>` : null}
      ${d.removed.length ? html`<${Label} block>${a('diffRemoved')}<//><${Code} block scroll change="removed">${d.removed.join('\n')}<//>` : null}
    <//>`;
}

function grantRow(ctx, g) {
  const open = ctx.openScopes === g.grant_id;
  const busy = ctx.busy === g.grant_id;
  return html`
    <${Row} key=${'g' + g.grant_id} open=${open}>
      <${Name} meta=${a('grantMeta', { n: (g.scopes || []).length, granted: day(g.granted_at), used: g.last_used_at ? rel(g.last_used_at) : a('grantNever') })}>${g.app_name || g.app}<//>
      <${Cell}><${Mark} tone="sun">${a('grantChip')}<//><//>
      <${Doors}>
        <${Action} small soft onClick=${() => ctx.toggleScopes(g)}>${open ? a('hideScopes') : a('viewScopes')}<//>
        <${Action} small soft disabled=${busy} onClick=${() => ctx.revokeGrant(g)}>${a('revokeGrant')}<//>
      <//>
      ${open ? html`
        <${Panel}>
          <${Note} kind="lead">${a('scopesLead', { origin: g.app_origin || g.app })}<//>
          <${Marks}>${(g.scopes || []).map((s) => html`<${Mark} key=${s}>${s}<//>`)}<//>
        <//>` : null}
    <//>`;
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
    ? html`<${Action} small soft copy=${managePrompt} copiedLabel=${a('promptCopied')} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))}>${a('manageDoor')}<//>`
    : null;
  const hasApps = ctx.apps && ctx.apps.length;
  return html`
    <${Section} id="ap-kunto" num=${num} title=${a('secKunto')} count=${hasApps ? a('secKuntoSub', { n: ctx.apps.length }) : null} doors=${doors}>
      <${List} cols="n-name-doors" keepCols
        empty=${!hasApps ? a('kuntoEmptyNew') : html`<${Note} kind="quiet"><b>${a('kuntoAllGood')}</b><//>`}
        rows=${hasApps ? k.rows : []} render=${(r) => html`
          <${Row} key=${r.key}>
            <${Cell}><${Figure} small tone=${r.loud ? 'notice' : undefined} n=${r.n} /><//>
            <${Name} desc=${sub(r.key)}>${a('kunto.' + r.key + '.what')}<//>
            <${Doors}><${Action} small row soft href=${catalogUrl({ filter: r.key })} newTab>${a('kuntoShow', { n: r.n })}<//><//>
          <//>`} />
      <${Note}>${a('kuntoHint')}<//>
    <//>`;
}

/* ── 03 · Last changed ────────────────────────────────────────────────────────────────────────── */

function secNewest(ctx, apps) {
  const rows = [...apps].sort((p, q) => String(q.created_at || '').localeCompare(String(p.created_at || ''))).slice(0, 6);
  const grantRefs = new Set((ctx.grants || []).map((g) => g.app));
  const doors = html`<${Action} small soft href=${catalogUrl()} newTab>${a('allInCatalog', { n: apps.length })}<//>`;
  return html`
    <${Section} id="ap-newest" num="03" title=${a('secNewest')} count=${rows.length} doors=${doors}>
      <${List} cols="mark-name-desc-state-n-doors" keepCols
        head=${['', a('colApp'), a('colDesc'), a('colNote'), { label: a('colOpens'), num: true }, '']}
        rows=${rows} render=${(app) => {
          const ref = appRef(app);
          const flags = ctx.kunto?.flags?.[ref] || {};
          const legal = app.manifest?.legal ? Object.keys(app.manifest.legal).length : 0;
          return html`
            <${Row} key=${ref}>
              <${Lead} text=${initials(nameOf(app))} />
              <${Name} meta=${a('rowMeta', { version: app.manifest?.version || '', n: app.version_number || 1, date: day(app.created_at), size: kb(app.size) })}>${nameOf(app)}<//>
              <${Desc} lines=${3} sub=${requiresLine(app)}>${app.manifest?.descriptions?.[getLocale()] || app.manifest?.description || ''}<//>
              <${Cell} meta>${noteFor(app, flags, grantRefs, legal)}<//>
              <${Num} strong>${app.downloads || 0}<//>
              <${Doors}>
                <${Action} small row href=${appUrl(app)} newTab onClick=${() => ctx.recordOpen(app)}>${a('open')}<//>
                <${Action} small row soft href=${catalogUrl({ q: nameOf(app) })} newTab>${a('inCatalog')}<//>
              <//>
            <//>`;
        }} />
      <${Note}>${a('newestHint')}<//>
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
  return a('requires', { list: names.join(' · ') });
}

/* ── The first step, when there is nothing yet ────────────────────────────────────────────────── */

function secFirst(ctx) {
  return html`
    <${Section} id="ap-first" num="01" title=${a('secFirst')} count=${null} first>
      <${Note} kind="quiet"><b>${a('firstHead')}</b> ${a('firstBody')}<//>
      <${Space} above="medium">
        <${Actions}>
          <${Action} small href="/v1/aimeat-os" newTab>${a('guideDoor')}<//>
          <${Action} small soft href=${catalogUrl()} newTab>${a('communityDoor', { n: ctx.community })}<//>
          <${Action} small soft onClick=${() => goTab('appdev')}>${a('appdevDoor')}<//>
        <//>
      <//>
    <//>`;
}
