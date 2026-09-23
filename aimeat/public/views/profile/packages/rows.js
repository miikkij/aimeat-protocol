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
 *   2026-09-22 -- Every row is the shared ListRow (the running light is its marker) and every opened
 *     package a shared record of part rows, key-value rows, fields and actions; no page classes.
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
import { ListRow, KeyValue, Stack, Surface, Field, Text, Chip, Action, CopyAction } from '/components/poster-parts.js';
import { x, partWord, partTab, partCounts, categoryWord, listingWord, dateWord, versionDate, agentTextFor, openTab } from './frame.js';

const partChips = (list) => html`<${Stack} direction="wrap" density="compact">${partCounts(list).map(([type, n]) => html`<${Chip} key=${type}>${partWord(type)}${n > 1 ? ` ×${n}` : ''}<//>`)}<//>`;
const appHref = (ctx, registeredAs) => `/v1/apps/${encodeURIComponent(ctx.ownerName)}/${encodeURIComponent(registeredAs)}?mode=inline`;
/** The row's body under the clamped description: the version and state line in mono, the part chips. */
const rowBody = (line, chips) => html`<${Stack} direction="wrap" align="between" density="compact">
  ${line ? html`<${Text} kind="mono" tone="muted">${line}<//>` : null}
  ${chips}
<//>`;
/** One part of a package: its kind and id, what it needs; `extra` is the part's own door. */
const partRows = (list, idOf, extra) => html`<div>${list.map((c) => html`<${ListRow} key=${idOf(c)} density="compact"
  name=${c.label || idOf(c)} detail=${`${partWord(c.type)} · ${idOf(c)}`}
  value=${(c.dependencies || []).length ? html`<${Text} kind="caption">${x('needs', { list: c.dependencies.join(', ') })}<//>` : undefined}
  actions=${extra ? extra(c) : undefined} />`)}</div>`;

/* ── An installed package ─────────────────────────────────────────────────────────────────────── */

export function instanceRow(ctx, inst) {
  const open = ctx.expanded === 'i:' + inst.id;
  const comps = inst.installedComponents || [];
  const app = comps.find((c) => c.type === 'app');
  const source = ctx.offerByGroup[inst.packageGroupId] || ctx.ownByGroup[inst.packageGroupId] || null;
  const running = inst.status === 'installed';
  return html`
    <${ListRow} key=${inst.id} marker=${running ? 'success' : 'muted'} name=${inst.label || inst.packageGroupId.split('::')[0]}
      preview=${true} detail=${source?.description || x('instanceDesc')}
      value=${html`<${Stack} density="compact">
        <${Text}>${x('fromPackage')} <${Action} kind="text" onClick=${() => ctx.jumpTo(inst.packageGroupId)}>${source?.title || inst.packageGroupId.split('::')[0]}<//><//>
        <${Text} kind="caption" tone="muted">${source ? (ctx.ownByGroup[inst.packageGroupId] ? x('ownPublication') : source.system ? x('bySystem') : x('byAuthor', { author: source.author })) : x('packageGone')}${source?.version && source.version !== inst.packageVersion ? ` · ${x('newerVersion')}` : ''}<//>
      <//>`}
      actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggle('i:' + inst.id, inst)}>${open ? x('close') : x('open')}<//>
        ${app ? html`<${Action} href=${appHref(ctx, app.registeredAs)} target="_blank">${x('openApp')}<//>` : null}`}>
      <${Stack}>
        ${rowBody([versionDate(inst.packageVersion), running ? x('running') : x('status.' + inst.status), x('partsN', { n: comps.length }), x('installedOn', { date: dateWord(inst.installedAt) })].join(' · '), partChips(comps))}
        ${open ? instanceOpen(ctx, inst, comps, app, source) : null}
      <//>
    <//>`;
}

function instanceOpen(ctx, inst, comps, app, source) {
  const upd = ctx.updates[inst.id];
  const customized = comps.filter((c) => c.customized).length;
  return html`
    <${Surface} kind="record"><${Stack}>
      <${Text} kind="lead">${x('instanceLead', { date: dateWord(inst.installedAt), name: source?.title || inst.packageGroupId.split('::')[0], version: inst.packageVersion })} ${customized ? x('instanceCustomized', { n: customized }) : x('instanceUntouched', { n: comps.length })}<//>
      <${Text} kind="label">${x('partsLabel')}<//>
      <div>
        ${comps.map((c) => html`<${ListRow} key=${c.componentId} density="compact" name=${c.componentId} detail=${`${partWord(c.type)} · ${c.registeredAs}`}
          value=${html`<${Stack} density="compact"><${Text}>${x('partOn.' + partTab(c.type))}<//>${c.customized
            ? html`<${Text} kind="caption" tone="coral">${x('partCustomized', { date: dateWord(c.customizedAt) })}<//>`
            : html`<${Text} kind="caption" tone="muted">${x('partUntouched')}<//>`}<//>`}
          actions=${c.type === 'app' ? html`<${Action} href=${appHref(ctx, c.registeredAs)} target="_blank">${x('open')}<//>`
            : html`<${Action} onClick=${() => openTab(partTab(c.type))}>${partTab(c.type) === 'memory' ? x('inspect') : x('manage')}<//>`} />`)}
      </div>
      <div>
        <${KeyValue} label=${x('updateK')}><${Stack} density="compact">
          <span>${!upd ? x('updateUnknown') : upd.checking ? x('updateChecking') : upd.error ? upd.error : upd.updateAvailable ? x('updateAvailable', { version: versionDate(upd.latestVersion) }) : x('updateNone')}</span>
          <${Text} kind="caption" tone="muted">${
            // Said before the button rather than after: a part this owner has edited is NOT updated,
            // and knowing that beforehand is the difference between pressing a button and being
            // surprised by it.
            customized ? x('updateKeepsYours', { n: customized }) : x('updateSub')
          }<//>
          ${upd?.updateAvailable ? html`<div><${Action} disabled=${ctx.busy} onClick=${() => ctx.applyUpdate(inst, upd)}>${x('applyUpdate')}<//></div>` : null}
        <//><//>
        <${KeyValue} label=${x('forAgentK')}><${Stack} density="compact"><span>${x('forAgentInstance')}</span><${Text} kind="caption" tone="muted">${x('forAgentInstanceSub')}<//><//><//>
      </div>
      <${Stack} direction="wrap" align="center">
        ${app ? html`<${Action} href=${appHref(ctx, app.registeredAs)} target="_blank">${x('openApp')}<//>` : null}
        <${Action} disabled=${ctx.busy} onClick=${() => ctx.checkUpdate(inst)}>${x('checkUpdate')}<//>
        <${CopyAction} text=${comps.map((c) => `${c.type} ${c.registeredAs}`).join('\n')} label=${x('copyNames')} copiedLabel=${x('copied')} />
        <${Action} tone="danger" onClick=${() => ctx.removeInstance(inst)}>${x('removeInstance')}<//>
        <${Action} onClick=${() => ctx.toggle('i:' + inst.id, inst)}>${x('close')}<//>
      <//>
    <//><//>`;
}

/* ── A package on offer ───────────────────────────────────────────────────────────────────────── */

export function offerRow(ctx, o) {
  const key = 'o:' + (o.group || o.title);
  const open = ctx.expanded === key;
  const installed = ctx.instances.filter((i) => i.packageGroupId === o.group).length;
  const sub = [o.remote ? x('fromNode', { node: o.sourceNode }) : o.system ? x('bySystem') : x('byAuthor', { author: o.author }), categoryWord(o.category)].filter(Boolean).join(' · ');
  return html`
    <${ListRow} key=${key} id=${'pk-row-' + (o.group || '').replace(/[^a-z0-9]/gi, '-')} name=${o.title}
      preview=${true} detail=${o.description || undefined}
      value=${html`<${Stack} density="compact">
        <${Text}>${installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) : x('installYours')}<//>
        <${Text} kind="caption" tone="muted">${[o.components.length ? x('partsN', { n: o.components.length }) : '', o.listing?.installCount ? (o.listing.installCount === 1 ? x('installOne') : x('installsN', { n: o.listing.installCount })) : '', o.listing?.featured ? x('featured') : ''].filter(Boolean).join(' · ') || x('noInstallsYet')}<//>
      <//>`}
      actions=${html`${o.group ? html`<${Action} onClick=${() => ctx.toggle(key, o)}>${open ? x('close') : x('install')}<//>` : null}
        <${Action} expanded=${open} onClick=${() => ctx.toggle(key, o)}>${open ? x('close') : x('open')}<//>`}>
      <${Stack}>
        ${rowBody([o.version ? versionDate(o.version) : '', sub].filter(Boolean).join(' · '), o.components.length ? partChips(o.components) : null)}
        ${open ? offerOpen(ctx, o, key) : null}
      <//>
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
    <${Surface} kind="aside"><${Stack} density="compact">
      <${Text} kind="label">${x('expectsLabel')}<//>
      ${lines.map((line, i) => html`<${Text} key=${i}>${line}<//>`)}
    <//><//>`;
}

/** The install field and its door, on an offer and on an own publication. */
function installField(ctx, key, inst, onInstall) {
  return html`<${Stack} direction="wrap" align="end">
    <${Field} value=${inst.label} placeholder=${x('labelPlaceholder')} ariaLabel=${x('installK')} onInput=${(e) => ctx.setInstallLabel(key, e.target.value)} />
    <${Action} disabled=${ctx.busy} onClick=${onInstall}>${ctx.busy === key ? x('installing') : x('install')}<//>
  <//>`;
}

function offerOpen(ctx, o, key) {
  const inst = ctx.installForm && ctx.installForm.key === key ? ctx.installForm : { label: '' };
  const l = o.listing;
  return html`
    <${Surface} kind="record"><${Stack}>
      <${Text} kind="lead">${o.description}<//>
      ${o.components.length ? html`<${Text} kind="label">${x('partsCount', { n: o.components.length })}<//>${partRows(o.components, (c) => c.id)}` : null}
      ${expectsOf(o)}
      <div>
        <${KeyValue} label=${x('makerK')}><${Stack} density="compact">
          <span>${o.remote ? x('makerRemote', { node: o.sourceNode }) : o.system ? x('makerSystem') : x('makerAuthor', { author: o.author })}</span>
          <${Text} kind="caption" tone="muted">${[o.version ? x('versionOf', { date: versionDate(o.version) }) : '', categoryWord(o.category) ? x('categoryOf', { c: categoryWord(o.category) }) : '', o.tags.length ? x('tagsOf', { tags: o.tags.join(', ') }) : ''].filter(Boolean).join(' · ')}<//>
        <//><//>
        ${l && (l.installCount || l.reviewCount) ? html`<${KeyValue} label=${x('galleryK')} value=${[l.installCount ? x('installsN', { n: l.installCount }) : '', l.reviewCount ? x('reviewsN', { n: l.reviewCount, rating: Number(l.rating || 0).toFixed(1) }) : ''].filter(Boolean).join(' · ')} />` : null}
        ${o.group ? html`<${KeyValue} label=${x('installK')}><${Stack} density="compact">
          ${installField(ctx, key, inst, () => ctx.install(o, inst.label))}
          <${Text} kind="caption" tone="muted">${x('installSub')}<//>
        <//><//>` : null}
      </div>
      <${Stack} direction="wrap" align="center">
        ${o.group ? html`<${Action} onClick=${() => ctx.download(o.group, o.name)}>${x('downloadZip')}<//>` : null}
        <${CopyAction} text=${agentTextFor(o)} label=${x('copyAgent')} copiedLabel=${x('copied')} />
        <${Action} onClick=${() => ctx.toggle(key, o)}>${x('close')}<//>
      <//>
    <//><//>`;
}

/* ── One of the owner's own publications ──────────────────────────────────────────────────────── */

export function ownRow(ctx, p) {
  const key = 'p:' + p.packageGroupId;
  const open = ctx.expanded === key;
  const installed = ctx.instances.filter((i) => i.packageGroupId === p.packageGroupId).length;
  const listing = ctx.listingByGroup[p.packageGroupId];
  const state = p.templateStatus || listing?.status;
  return html`
    <${ListRow} key=${key} id=${'pk-row-' + p.packageGroupId.replace(/[^a-z0-9]/gi, '-')} name=${p.name}
      preview=${true} detail=${p.description || undefined}
      value=${html`<${Stack} density="compact">
        <${Text}>${p.visibility === 'public' ? x('vis.public') : x('vis.private')}<//>
        <${Text} kind="caption" tone="muted">${[
          p.status === 'published' ? '' : x('statusWord.' + p.status),
          state ? listingWord(state) : x('notInGallery'),
          installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) : '',
        ].filter(Boolean).join(' · ')}<//>
      <//>`}
      actions=${html`${p.status === 'published' ? null
          // A draft cannot be installed by anybody, including its author, so the door that changes
          // that leads the row.
          : html`<${Action} disabled=${!!ctx.busy} onClick=${() => ctx.publishOwn(p)}>${x('publishIt')}<//>`}
        <${Action} expanded=${open} onClick=${() => ctx.toggle(key, p)}>${open ? x('close') : x('open')}<//>
        <${Action} onClick=${() => ctx.download(p.packageGroupId, p.name)}>${x('downloadZip')}<//>`}>
      <${Stack}>
        ${rowBody([versionDate(p.version), x('partsN', { n: (p.components || []).length }), categoryWord(p.category), dateWord(p.updatedAt || p.createdAt)].filter(Boolean).join(' · '), partChips(p.components))}
        ${open ? ownOpen(ctx, p, key, listing, state, installed) : null}
      <//>
    <//>`;
}

function ownOpen(ctx, p, key, listing, state, installed) {
  const inst = ctx.installForm && ctx.installForm.key === key ? ctx.installForm : { label: '' };
  const versions = ctx.versions[p.packageGroupId];
  return html`
    <${Surface} kind="record"><${Stack}>
      <${Text} kind="lead">${p.description || ''}<//>
      <${Text} kind="label">${x('partsCount', { n: (p.components || []).length })}<//>
      ${partRows(p.components || [], (c) => c.id)}
      <div>
        <${KeyValue} label=${x('versionsK')}><${Stack} density="compact">
          <span>${versions ? x('versionsLine', { n: versions.length, latest: versionDate(p.version) }) : x('versionsLoading')}</span>
          <${Text} kind="caption" tone="muted">${x('versionsSub')}<//>
        <//><//>
        <${KeyValue} label=${x('vis.k')}><${Stack} density="compact">
          <span>${p.visibility === 'public' ? x('vis.publicLong') : x('vis.privateLong')}</span>
          <${Text} kind="caption" tone="muted">${state ? listingWord(state) : x('notInGalleryLong')}${p.rejectionReason || listing?.rejectionReason ? html` · ${x('rejectedBecause', { reason: p.rejectionReason || listing.rejectionReason })}` : null}<//>
          <${Stack} direction="wrap" align="center">
            <${Action} kind="tab" selected=${p.visibility === 'private'} disabled=${ctx.busy || p.visibility === 'private'} onClick=${() => ctx.setVisibility(p, 'private')}>${x('vis.private')}<//>
            <${Action} kind="tab" selected=${p.visibility === 'public'} disabled=${ctx.busy || p.visibility === 'public'} onClick=${() => ctx.setVisibility(p, 'public')}>${x('vis.public')}<//>
            ${p.status === 'published' && !state ? html`<${Action} disabled=${ctx.busy} onClick=${() => ctx.propose(p)}>${x('propose')}<//>` : null}
          <//>
        <//><//>
        <${KeyValue} label=${x('installK')}><${Stack} density="compact">
          ${installField(ctx, key, inst, () => ctx.install({ group: p.packageGroupId, title: p.name }, inst.label))}
          <${Text} kind="caption" tone="muted">${installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) + ' · ' : ''}${x('installOwnSub')}<//>
        <//><//>
      </div>
      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${() => ctx.download(p.packageGroupId, p.name)}>${x('downloadZip')}<//>
        <${CopyAction} text=${agentTextFor({ title: p.name, group: p.packageGroupId, description: p.description || '', components: p.components || [] })} label=${x('copyAgent')} copiedLabel=${x('copied')} />
        <${Action} tone="danger" onClick=${() => ctx.archive(p)}>${x('archive')}<//>
        <${Action} onClick=${() => ctx.toggle(key, p)}>${x('close')}<//>
      <//>
    <//><//>`;
}

export const loadingRow = () => html`<${Text} tone="muted">${t('common.loading')}<//>`;
