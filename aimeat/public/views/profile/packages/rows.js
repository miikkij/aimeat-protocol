/**
 * @file public/views/profile/packages/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three kinds of row on the Packages page and what opens under each. An installed
 *   package (an instance): its label, version and state, what it brought, where it came from; opened,
 *   every part with its registered name and the door to its own page, the update check in words,
 *   and the doors. A package on offer: what it does for a person, its parts, who made it; opened,
 *   the parts with their labels, the maker, the gallery's counts when there are any, and the install
 *   field. One of the owner's own publications: the same plus visibility, the listing's state and the
 *   doors an author has.
 * @structure instanceRow · offerRow · ownRow · loadingRow
 * @usage import { instanceRow, offerRow, ownRow } from './rows.js';
 * @version-history
 *   v1.20.0 — 2026-09-30 — The Check button asks the source; an ended update service is said in words.
 *   v1.19.0 — 2026-09-30 — The opened install shows its automatic update, on or off, with the switch.
 *   v1.18.0 — 2026-09-26 — On the component kit (page group G7): the rows, their cells and the opened
 *     panel are List (Row, Name with its dot and version tag, Desc keeping four lines with the part
 *     tags under them, Who, Doors, Panel), the part tables dense Lists, the facts Facts, the install
 *     field TextField box, private or public Tabs, "needs from this node" the Box's edge tone; the
 *     doors are Action. Put back from main: the jump to a package and "apply the update" are the
 *     coral word inside the line (main's og-crumb-link), not the more tone. The row's open door says
 *     whether the row is open (aria-expanded). The rows write no class.
 *   v1.17.0 -- 2026-09-26 -- A dashed field box is on the page's ground: Packages' install row is the Field row, the decision rule editor loses its grey (a unification: Jouni's decision "Dashed field box").
 *   v1.16.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- What a package deliberately did not carry is the Panel (.poster-panel, a sun bar at the left), a unification: the library part that carries it.
 *   v1.12.0 -- 2026-09-25 -- A package's parts (app, extension, cortex) are the Tag (.poster-chip, plain: it names a kind), a unification: Jouni's decision "Tag".
 *   v1.11.0 -- 2026-09-25 -- Private or public is a choice: the Tab (.poster-tab, the chosen one .is-on), a unification: Jouni's decision "Choice".
 *   v1.10.0 -- 2026-09-25 -- The dot before a package's name is the Status dot (.status-dot, active or inactive), a unification.
 *   v1.9.0 -- 2026-09-25 -- The facts under an opened package are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- The three kinds of row and the part tables are the Listing (listing-row and its name, words, who and doors cells, the open panel), a unification: the look most tabs use.
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.2.0 -- 2026-09-13 -- Compose detail frames from poster.css.
 *   v1.1.0 — 2026-09-05 — An offer says what it did NOT carry, so an extension that has to be
 *     installed separately is known before install rather than after. An installed row says how many
 *     parts the owner has edited before the update button rather than after it. A draft of the
 *     owner's own leads with the door that publishes it, since a draft is installable by nobody.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Action } from '/components/Action.js';
import { Code, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Tabs } from '/components/Tabs.js';
import { TextField } from '/components/TextField.js';
import { List, Row, Name, Desc, Who, Cell, Doors, Panel } from '/components/List.js';
import { x, partWord, partTab, partCounts, categoryWord, listingWord, dateWord, versionDate, agentTextFor, openTab } from './frame.js';

/** The kinds of part a package carries, as tags under its description ("app", "extension ×2"). */
const partTags = (list) => partCounts(list).map(([type, n]) => `${partWord(type)}${n > 1 ? ` ×${n}` : ''}`);
const appHref = (ctx, registeredAs) => `/v1/apps/${encodeURIComponent(ctx.ownerName)}/${encodeURIComponent(registeredAs)}?mode=inline`;

/** The field an install is named in, with its door, on the dashed field box. */
function installField(ctx, key, label, onInstall) {
  return html`<${TextField} box value=${label} placeholder=${x('labelPlaceholder')} ariaLabel=${x('installK')}
    onInput=${(v) => ctx.setInstallLabel(key, v)}
    actions=${html`<${Action} small disabled=${ctx.busy} onClick=${onInstall}>${ctx.busy === key ? x('installing') : x('install')}<//>`} />`;
}

/** The parts of an offered or own package, as a table in its opened panel. */
function partList(components) {
  return html`
    <${Label} block>${x('partsCount', { n: components.length })}<//>
    <${List} cols="kind-name-desc" dense apart>
      ${components.map((c) => html`
        <${Row} key=${c.id}>
          <${Cell}><${Code}>${partWord(c.type)}<//><//>
          <${Name} meta=${c.id}>${c.label || c.id}<//>
          <${Desc}>${(c.dependencies || []).length ? x('needs', { list: c.dependencies.join(', ') }) : ''}<//>
        <//>`)}
    <//>`;
}

/* ── An installed package ─────────────────────────────────────────────────────────────────────── */

export function instanceRow(ctx, inst) {
  const open = ctx.expanded === 'i:' + inst.id;
  const comps = inst.installedComponents || [];
  const app = comps.find((c) => c.type === 'app');
  const source = ctx.offerByGroup[inst.packageGroupId] || ctx.ownByGroup[inst.packageGroupId] || null;
  const running = inst.status === 'installed';
  const jump = () => ctx.jumpTo(inst.packageGroupId);
  const toggle = () => ctx.toggle('i:' + inst.id, inst);
  return html`
    <${Row} key=${inst.id} open=${open}>
      <${Name} dot=${running ? 'active' : 'inactive'} tag=${versionDate(inst.packageVersion)}
        meta=${[running ? x('running') : x('status.' + inst.status), x('partsN', { n: comps.length }), x('installedOn', { date: dateWord(inst.installedAt) })].join(' · ')}>${inst.label || inst.packageGroupId.split('::')[0]}<//>
      <${Desc} lines=${4} marks=${partTags(comps)}>${source?.description || x('instanceDesc')}<//>
      <${Who} sub=${`${source ? (ctx.ownByGroup[inst.packageGroupId] ? x('ownPublication') : source.system ? x('bySystem') : x('byAuthor', { author: source.author })) : x('packageGone')}${source?.version && source.version !== inst.packageVersion ? ` · ${x('newerVersion')}` : ''}`}>
        ${x('fromPackage')} <${Action} tone="link" onClick=${jump}>${source?.title || inst.packageGroupId.split('::')[0]}<//>
      <//>
      <${Doors}>
        <${Action} small row expanded=${open} onClick=${toggle}>${open ? x('close') : x('open')}<//>
        ${app ? html`<${Action} small row soft href=${appHref(ctx, app.registeredAs)} newTab>${x('openApp')}<//>` : null}
      <//>
      ${open ? instanceOpen(ctx, inst, comps, app, source) : null}
    <//>`;
}

function instanceOpen(ctx, inst, comps, app, source) {
  const upd = ctx.updates[inst.id];
  const customized = comps.filter((c) => c.customized).length;
  const apply = () => ctx.applyUpdate(inst, upd);
  const close = () => ctx.toggle('i:' + inst.id, inst);
  const doors = html`
    ${app ? html`<${Action} small href=${appHref(ctx, app.registeredAs)} newTab>${x('openApp')}<//>` : null}
    <${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.checkUpdate(inst, true)}>${x('checkUpdate')}<//>
    <${Action} small soft copy=${comps.map((c) => `${c.type} ${c.registeredAs}`).join('\n')} copiedLabel=${x('copied')}>${x('copyNames')}<//>
    <${Action} small soft tone="danger" onClick=${() => ctx.removeInstance(inst)}>${x('removeInstance')}<//>
    <${Action} small soft onClick=${close}>${x('close')}<//>`;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${x('instanceLead', { date: dateWord(inst.installedAt), name: source?.title || inst.packageGroupId.split('::')[0], version: inst.packageVersion })} ${customized ? x('instanceCustomized', { n: customized }) : x('instanceUntouched', { n: comps.length })}<//>
      <${Label} block>${x('partsLabel')}<//>
      <${List} cols="kind-name-who-doors" dense apart>
        ${comps.map((c) => html`
          <${Row} key=${c.componentId}>
            <${Cell}><${Code}>${partWord(c.type)}<//><//>
            <${Name} meta=${c.registeredAs}>${c.componentId}<//>
            <${Who} warn=${!!c.customized} sub=${c.customized ? x('partCustomized', { date: dateWord(c.customizedAt) }) : x('partUntouched')}>${x('partOn.' + partTab(c.type))}<//>
            <${Doors}>${c.type === 'app'
              ? html`<${Action} small row soft href=${appHref(ctx, c.registeredAs)} newTab>${x('open')}<//>`
              : html`<${Action} small row soft onClick=${() => openTab(partTab(c.type))}>${partTab(c.type) === 'memory' ? x('inspect') : x('manage')}<//>`}<//>
          <//>`)}
      <//>
      <${Facts} rows=${[
        {
          k: x('updateK'),
          v: !upd ? x('updateUnknown') : upd.checking ? x('updateChecking') : upd.ended ? x('updatesEnded') : upd.error ? upd.error : upd.updateAvailable ? x('updateAvailable', { version: versionDate(upd.latestVersion) }) : x('updateNone'),
          // Said before the button rather than after: a part this owner has edited is NOT updated,
          // and knowing that beforehand is the difference between pressing a button and being
          // surprised by it.
          sub: html`${customized ? x('updateKeepsYours', { n: customized }) : x('updateSub')}${upd?.updateAvailable ? html` <${Action} tone="link" disabled=${ctx.busy} onClick=${apply}>${x('applyUpdate')}<//>` : null}`,
        },
        {
          // The update service's promise, in the owner's hands: updates arrive by themselves, or wait for them.
          k: x('autoUpdateK'),
          v: inst.autoUpdate ? x('autoUpdateOn') : x('autoUpdateOff'),
          sub: html`${x('autoUpdateSub')} <${Action} tone="link" disabled=${ctx.busy} onClick=${() => ctx.setAutoUpdate(inst, !inst.autoUpdate)}>${inst.autoUpdate ? x('autoUpdateTurnOff') : x('autoUpdateTurnOn')}<//>`,
        },
        { k: x('forAgentK'), v: x('forAgentInstance'), sub: x('forAgentInstanceSub') },
      ]} />
    <//>`;
}

/* ── A package on offer ───────────────────────────────────────────────────────────────────────── */

export function offerRow(ctx, o) {
  const key = 'o:' + (o.group || o.title);
  const open = ctx.expanded === key;
  const installed = ctx.instances.filter((i) => i.packageGroupId === o.group).length;
  const sub = [o.remote ? x('fromNode', { node: o.sourceNode }) : o.system ? x('bySystem') : x('byAuthor', { author: o.author }), categoryWord(o.category)].filter(Boolean).join(' · ');
  const toggle = () => ctx.toggle(key, o);
  return html`
    <${Row} key=${key} open=${open} id=${'pk-row-' + (o.group || '').replace(/[^a-z0-9]/gi, '-')}>
      <${Name} tag=${o.version ? versionDate(o.version) : null} meta=${sub}>${o.title}<//>
      <${Desc} lines=${4} marks=${o.components.length ? partTags(o.components) : null}>${o.description}<//>
      <${Who} sub=${[o.components.length ? x('partsN', { n: o.components.length }) : '', o.listing?.installCount ? (o.listing.installCount === 1 ? x('installOne') : x('installsN', { n: o.listing.installCount })) : '', o.listing?.featured ? x('featured') : ''].filter(Boolean).join(' · ') || x('noInstallsYet')}>
        ${installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) : x('installYours')}
      <//>
      <${Doors}>
        ${o.group ? html`<${Action} small row expanded=${open} onClick=${toggle}>${open ? x('close') : x('install')}<//>` : null}
        <${Action} small row soft expanded=${open} onClick=${toggle}>${open ? x('close') : x('open')}<//>
      <//>
      ${open ? offerOpen(ctx, o, key) : null}
    <//>`;
}

/**
 * What a composed package deliberately did not carry, and this node therefore has to have.
 *
 * Written on the offer rather than discovered at install time: a cortex this node ships is present
 * everywhere and costs the reader nothing, but an extension is a separate install, and finding that
 * out after pressing install is the worst moment to find it out.
 */
function expectsOf(o) {
  let expects;
  try { expects = JSON.parse(o.manifest || '{}').expects; }
  // eslint-disable-next-line aimeat/no-silent-catch -- a manifest that is not our JSON simply has no expectations to show
  catch { expects = null; }
  if (!expects) return null;

  const lines = [
    (expects.extensions ?? []).length ? x('expectsExt', { names: expects.extensions.join(', ') }) : '',
    (expects.cortex ?? []).length ? x('expectsCortex', { names: expects.cortex.join(', ') }) : '',
    (expects.packs ?? []).length ? x('expectsPacks', { names: expects.packs.join(', ') }) : '',
  ].filter(Boolean);
  if (lines.length === 0) return null;

  return html`
    <${Box} tone="edge">
      <${Label} block>${x('expectsLabel')}<//>
      ${lines.map((line, i) => html`<${Note} key=${i} kind="lead">${line}<//>`)}
    <//>`;
}

function offerOpen(ctx, o, key) {
  const inst = ctx.installForm && ctx.installForm.key === key ? ctx.installForm : { label: '' };
  const l = o.listing;
  const close = () => ctx.toggle(key, o);
  const doors = html`
    ${o.group ? html`<${Action} small soft onClick=${() => ctx.download(o.group, o.name)}>${x('downloadZip')}<//>` : null}
    <${Action} small soft copy=${agentTextFor(o)} copiedLabel=${x('copied')}>${x('copyAgent')}<//>
    <${Action} small soft onClick=${close}>${x('close')}<//>`;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${o.description}<//>
      ${o.components.length ? partList(o.components) : null}
      ${expectsOf(o)}
      <${Facts} rows=${[
        { k: x('makerK'), v: o.remote ? x('makerRemote', { node: o.sourceNode }) : o.system ? x('makerSystem') : x('makerAuthor', { author: o.author }), sub: [o.version ? x('versionOf', { date: versionDate(o.version) }) : '', categoryWord(o.category) ? x('categoryOf', { c: categoryWord(o.category) }) : '', o.tags.length ? x('tagsOf', { tags: o.tags.join(', ') }) : ''].filter(Boolean).join(' · ') },
        l && (l.installCount || l.reviewCount) && { k: x('galleryK'), v: [l.installCount ? x('installsN', { n: l.installCount }) : '', l.reviewCount ? x('reviewsN', { n: l.reviewCount, rating: Number(l.rating || 0).toFixed(1) }) : ''].filter(Boolean).join(' · ') },
        o.group && { k: x('installK'), v: installField(ctx, key, inst.label, () => ctx.install(o, inst.label)), sub: x('installSub') },
      ]} />
    <//>`;
}

/* ── One of the owner's own publications ──────────────────────────────────────────────────────── */

export function ownRow(ctx, p) {
  const key = 'p:' + p.packageGroupId;
  const open = ctx.expanded === key;
  const installed = ctx.instances.filter((i) => i.packageGroupId === p.packageGroupId).length;
  const listing = ctx.listingByGroup[p.packageGroupId];
  const state = p.templateStatus || listing?.status;
  const toggle = () => ctx.toggle(key, p);
  return html`
    <${Row} key=${key} open=${open} id=${'pk-row-' + p.packageGroupId.replace(/[^a-z0-9]/gi, '-')}>
      <${Name} tag=${versionDate(p.version)} meta=${[x('partsN', { n: (p.components || []).length }), categoryWord(p.category), dateWord(p.updatedAt || p.createdAt)].filter(Boolean).join(' · ')}>${p.name}<//>
      <${Desc} lines=${4} marks=${partTags(p.components)}>${p.description || ''}<//>
      <${Who} sub=${[
        p.status === 'published' ? '' : x('statusWord.' + p.status),
        state ? listingWord(state) : x('notInGallery'),
        installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) : '',
      ].filter(Boolean).join(' · ')}>${p.visibility === 'public' ? x('vis.public') : x('vis.private')}<//>
      <${Doors}>
        ${p.status === 'published' ? null
          // A draft cannot be installed by anybody, including its author, so the door that changes
          // that leads the row and the usual open door steps back to quiet.
          : html`<${Action} small row disabled=${!!ctx.busy} onClick=${() => ctx.publishOwn(p)}>${x('publishIt')}<//>`}
        <${Action} small row soft=${p.status !== 'published'} expanded=${open} onClick=${toggle}>${open ? x('close') : x('open')}<//>
        <${Action} small row soft onClick=${() => ctx.download(p.packageGroupId, p.name)}>${x('downloadZip')}<//>
      <//>
      ${open ? ownOpen(ctx, p, key, listing, state, installed) : null}
    <//>`;
}

function ownOpen(ctx, p, key, listing, state, installed) {
  const inst = ctx.installForm && ctx.installForm.key === key ? ctx.installForm : { label: '' };
  const versions = ctx.versions[p.packageGroupId];
  const busy = !!ctx.busy;
  const close = () => ctx.toggle(key, p);
  const doors = html`
    <${Action} small soft onClick=${() => ctx.download(p.packageGroupId, p.name)}>${x('downloadZip')}<//>
    <${Action} small soft copy=${agentTextFor({ title: p.name, group: p.packageGroupId, description: p.description || '', components: p.components || [] })} copiedLabel=${x('copied')}>${x('copyAgent')}<//>
    <${Action} small soft tone="danger" onClick=${() => ctx.archive(p)}>${x('archive')}<//>
    <${Action} small soft onClick=${close}>${x('close')}<//>`;
  // Private or public: the chosen one is on and cannot be pressed again, as main's doors were.
  const visibility = html`
    <${Tabs} label=${x('vis.k')} value=${p.visibility} onSelect=${(v) => ctx.setVisibility(p, v)}
      items=${[
        { value: 'private', label: x('vis.private'), disabled: busy || p.visibility === 'private' },
        { value: 'public', label: x('vis.public'), disabled: busy || p.visibility === 'public' },
      ]} />
    ${p.status === 'published' && !state ? html`<${Action} small soft disabled=${busy} onClick=${() => ctx.propose(p)}>${x('propose')}<//>` : null}`;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${p.description || ''}<//>
      ${partList(p.components || [])}
      <${Facts} rows=${[
        { k: x('versionsK'), v: versions ? x('versionsLine', { n: versions.length, latest: versionDate(p.version) }) : x('versionsLoading'), sub: x('versionsSub') },
        {
          k: x('vis.k'),
          v: p.visibility === 'public' ? x('vis.publicLong') : x('vis.privateLong'),
          sub: html`${state ? listingWord(state) : x('notInGalleryLong')}${p.rejectionReason || listing?.rejectionReason ? html` · ${x('rejectedBecause', { reason: p.rejectionReason || listing.rejectionReason })}` : null}`,
          actions: visibility,
        },
        { k: x('installK'), v: installField(ctx, key, inst.label, () => ctx.install({ group: p.packageGroupId, title: p.name }, inst.label)), sub: `${installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) + ' · ' : ''}${x('installOwnSub')}` },
      ]} />
    <//>`;
}

export const loadingRow = () => html`<${List} loading=${t('common.loading')} />`;
