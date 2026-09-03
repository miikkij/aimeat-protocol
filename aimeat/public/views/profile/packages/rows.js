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
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { x, partWord, partTab, partCounts, categoryWord, listingWord, dateWord, versionDate, agentTextFor, openTab } from './frame.js';

const dot = (on) => html`<i class=${`pk-dot ${on ? 'is-on' : ''}`} aria-hidden="true"></i>`;
const partChips = (list) => html`<span class="pk-parts">${partCounts(list).map(([type, n]) => html`<span key=${type} class="pk-part">${partWord(type)}${n > 1 ? ` ×${n}` : ''}</span>`)}</span>`;

/* ── An installed package ─────────────────────────────────────────────────────────────────────── */

export function instanceRow(ctx, inst) {
  const open = ctx.expanded === 'i:' + inst.id;
  const comps = inst.installedComponents || [];
  const app = comps.find((c) => c.type === 'app');
  const source = ctx.offerByGroup[inst.packageGroupId] || ctx.ownByGroup[inst.packageGroupId] || null;
  const running = inst.status === 'installed';
  return html`
    <div class=${`pk-p ${open ? 'is-open' : ''}`} key=${inst.id}>
      <div class="pk-nm">${dot(running)}${inst.label || inst.packageGroupId.split('::')[0]}<span class="pk-tag">${versionDate(inst.packageVersion)}</span><small>${[running ? x('running') : x('status.' + inst.status), x('partsN', { n: comps.length }), x('installedOn', { date: dateWord(inst.installedAt) })].join(' · ')}</small></div>
      <div class="pk-ds"><span class="pk-desc">${source?.description || x('instanceDesc')}</span>${partChips(comps)}</div>
      <div class="pk-me">${x('fromPackage')} <button type="button" class="og-crumb-link pk-linkbtn" onClick=${() => ctx.jumpTo(inst.packageGroupId)}>${source?.title || inst.packageGroupId.split('::')[0]}</button><small>${source ? (ctx.ownByGroup[inst.packageGroupId] ? x('ownPublication') : source.system ? x('bySystem') : x('byAuthor', { author: source.author })) : x('packageGone')}${source?.version && source.version !== inst.packageVersion ? ` · ${x('newerVersion')}` : ''}</small></div>
      <div class="pk-go">
        <button type="button" class="og-door" onClick=${() => ctx.toggle('i:' + inst.id, inst)}>${open ? x('close') : x('open')}</button>
        ${app ? html`<a class="og-door og-door--quiet" href=${`/v1/apps/${encodeURIComponent(ctx.ownerName)}/${encodeURIComponent(app.registeredAs)}?mode=inline`} target="_blank" rel="noopener">${x('openApp')}</a>` : null}
      </div>
      ${open ? instanceOpen(ctx, inst, comps, app, source) : null}
    </div>`;
}

function instanceOpen(ctx, inst, comps, app, source) {
  const upd = ctx.updates[inst.id];
  const customized = comps.filter((c) => c.customized).length;
  return html`
    <div class="pk-open">
      <p class="pk-lead">${x('instanceLead', { date: dateWord(inst.installedAt), name: source?.title || inst.packageGroupId.split('::')[0], version: inst.packageVersion })} ${customized ? x('instanceCustomized', { n: customized }) : x('instanceUntouched', { n: comps.length })}</p>
      <span class="og-label">${x('partsLabel')}</span>
      <div class="pk-comp">
        ${comps.map((c) => html`
          <div key=${'t' + c.componentId}><code>${partWord(c.type)}</code></div>
          <div key=${'n' + c.componentId}>${c.componentId}<small>${c.registeredAs}</small></div>
          <div key=${'w' + c.componentId}>${x('partOn.' + partTab(c.type))}${c.customized ? html`<small class="is-warn">${x('partCustomized', { date: dateWord(c.customizedAt) })}</small>` : html`<small>${x('partUntouched')}</small>`}</div>
          <div key=${'d' + c.componentId}>${c.type === 'app' ? html`<a class="og-door og-door--quiet" href=${`/v1/apps/${encodeURIComponent(ctx.ownerName)}/${encodeURIComponent(c.registeredAs)}?mode=inline`} target="_blank" rel="noopener">${x('open')}</a>` : html`<button type="button" class="og-door og-door--quiet" onClick=${() => openTab(partTab(c.type))}>${partTab(c.type) === 'memory' ? x('inspect') : x('manage')}</button>`}</div>`)}
      </div>
      <div class="pk-kv">
        <div class="pk-k">${x('updateK')}</div><div class="pk-v">${!upd ? x('updateUnknown') : upd.checking ? x('updateChecking') : upd.error ? upd.error : upd.updateAvailable ? x('updateAvailable', { version: versionDate(upd.latestVersion) }) : x('updateNone')}<small>${x('updateSub')}${upd?.updateAvailable ? html` <button type="button" class="og-crumb-link pk-linkbtn" disabled=${ctx.busy} onClick=${() => ctx.applyUpdate(inst, upd)}>${x('applyUpdate')}</button>` : null}</small></div>
        <div class="pk-k">${x('forAgentK')}</div><div class="pk-v">${x('forAgentInstance')}<small>${x('forAgentInstanceSub')}</small></div>
      </div>
      <div class="og-doors pk-open-doors">
        ${app ? html`<a class="og-door" href=${`/v1/apps/${encodeURIComponent(ctx.ownerName)}/${encodeURIComponent(app.registeredAs)}?mode=inline`} target="_blank" rel="noopener">${x('openApp')}</a>` : null}
        <button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.checkUpdate(inst)}>${x('checkUpdate')}</button>
        <${CopyButton} text=${comps.map((c) => `${c.type} ${c.registeredAs}`).join('\n')} className="og-door og-door--quiet" label=${x('copyNames')} copiedLabel=${x('copied')} />
        <button type="button" class="og-door og-door--quiet pk-danger" onClick=${() => ctx.removeInstance(inst)}>${x('removeInstance')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggle('i:' + inst.id, inst)}>${x('close')}</button>
      </div>
    </div>`;
}

/* ── A package on offer ───────────────────────────────────────────────────────────────────────── */

export function offerRow(ctx, o) {
  const key = 'o:' + (o.group || o.title);
  const open = ctx.expanded === key;
  const installed = ctx.instances.filter((i) => i.packageGroupId === o.group).length;
  const sub = [o.remote ? x('fromNode', { node: o.sourceNode }) : o.system ? x('bySystem') : x('byAuthor', { author: o.author }), categoryWord(o.category)].filter(Boolean).join(' · ');
  return html`
    <div class=${`pk-p ${open ? 'is-open' : ''}`} key=${key} id=${'pk-row-' + (o.group || '').replace(/[^a-z0-9]/gi, '-')}>
      <div class="pk-nm">${o.title}${o.version ? html`<span class="pk-tag">${versionDate(o.version)}</span>` : null}<small>${sub}</small></div>
      <div class="pk-ds"><span class="pk-desc">${o.description}</span>${o.components.length ? partChips(o.components) : null}</div>
      <div class="pk-me">${installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) : x('installYours')}<small>${[o.components.length ? x('partsN', { n: o.components.length }) : '', o.listing?.installCount ? (o.listing.installCount === 1 ? x('installOne') : x('installsN', { n: o.listing.installCount })) : '', o.listing?.featured ? x('featured') : ''].filter(Boolean).join(' · ') || x('noInstallsYet')}</small></div>
      <div class="pk-go">
        ${o.group ? html`<button type="button" class="og-door" onClick=${() => ctx.toggle(key, o)}>${open ? x('close') : x('install')}</button>` : null}
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggle(key, o)}>${open ? x('close') : x('open')}</button>
      </div>
      ${open ? offerOpen(ctx, o, key) : null}
    </div>`;
}

function offerOpen(ctx, o, key) {
  const inst = ctx.installForm && ctx.installForm.key === key ? ctx.installForm : { label: '' };
  const l = o.listing;
  return html`
    <div class="pk-open">
      <p class="pk-lead">${o.description}</p>
      ${o.components.length ? html`
        <span class="og-label">${x('partsCount', { n: o.components.length })}</span>
        <div class="pk-comp pk-comp--offer">
          ${o.components.map((c) => html`
            <div key=${'t' + c.id}><code>${partWord(c.type)}</code></div>
            <div key=${'n' + c.id}>${c.label || c.id}<small>${c.id}</small></div>
            <div key=${'w' + c.id}>${(c.dependencies || []).length ? x('needs', { list: c.dependencies.join(', ') }) : ''}</div>`)}
        </div>` : null}
      <div class="pk-kv">
        <div class="pk-k">${x('makerK')}</div><div class="pk-v">${o.remote ? x('makerRemote', { node: o.sourceNode }) : o.system ? x('makerSystem') : x('makerAuthor', { author: o.author })}<small>${[o.version ? x('versionOf', { date: versionDate(o.version) }) : '', categoryWord(o.category) ? x('categoryOf', { c: categoryWord(o.category) }) : '', o.tags.length ? x('tagsOf', { tags: o.tags.join(', ') }) : ''].filter(Boolean).join(' · ')}</small></div>
        ${l && (l.installCount || l.reviewCount) ? html`<div class="pk-k">${x('galleryK')}</div><div class="pk-v">${[l.installCount ? x('installsN', { n: l.installCount }) : '', l.reviewCount ? x('reviewsN', { n: l.reviewCount, rating: Number(l.rating || 0).toFixed(1) }) : ''].filter(Boolean).join(' · ')}</div>` : null}
        ${o.group ? html`<div class="pk-k">${x('installK')}</div><div class="pk-v">
          <div class="pk-inst"><input class="og-input" value=${inst.label} placeholder=${x('labelPlaceholder')} onInput=${(e) => ctx.setInstallLabel(key, e.target.value)} /><button type="button" class="og-door" disabled=${ctx.busy} onClick=${() => ctx.install(o, inst.label)}>${ctx.busy === key ? x('installing') : x('install')}</button></div>
          <small>${x('installSub')}</small></div>` : null}
      </div>
      <div class="og-doors pk-open-doors">
        ${o.group ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.download(o.group, o.name)}>${x('downloadZip')}</button>` : null}
        <${CopyButton} text=${agentTextFor(o)} className="og-door og-door--quiet" label=${x('copyAgent')} copiedLabel=${x('copied')} />
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggle(key, o)}>${x('close')}</button>
      </div>
    </div>`;
}

/* ── One of the owner's own publications ──────────────────────────────────────────────────────── */

export function ownRow(ctx, p) {
  const key = 'p:' + p.packageGroupId;
  const open = ctx.expanded === key;
  const installed = ctx.instances.filter((i) => i.packageGroupId === p.packageGroupId).length;
  const listing = ctx.listingByGroup[p.packageGroupId];
  const state = p.templateStatus || listing?.status;
  return html`
    <div class=${`pk-p ${open ? 'is-open' : ''}`} key=${key} id=${'pk-row-' + p.packageGroupId.replace(/[^a-z0-9]/gi, '-')}>
      <div class="pk-nm">${p.name}<span class="pk-tag">${versionDate(p.version)}</span><small>${[x('partsN', { n: (p.components || []).length }), categoryWord(p.category), dateWord(p.updatedAt || p.createdAt)].filter(Boolean).join(' · ')}</small></div>
      <div class="pk-ds"><span class="pk-desc">${p.description || ''}</span>${partChips(p.components)}</div>
      <div class="pk-me">${p.visibility === 'public' ? x('vis.public') : x('vis.private')}<small>${[state ? listingWord(state) : x('notInGallery'), installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) : ''].filter(Boolean).join(' · ')}</small></div>
      <div class="pk-go">
        <button type="button" class="og-door" onClick=${() => ctx.toggle(key, p)}>${open ? x('close') : x('open')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.download(p.packageGroupId, p.name)}>${x('downloadZip')}</button>
      </div>
      ${open ? ownOpen(ctx, p, key, listing, state, installed) : null}
    </div>`;
}

function ownOpen(ctx, p, key, listing, state, installed) {
  const inst = ctx.installForm && ctx.installForm.key === key ? ctx.installForm : { label: '' };
  const versions = ctx.versions[p.packageGroupId];
  return html`
    <div class="pk-open">
      <p class="pk-lead">${p.description || ''}</p>
      <span class="og-label">${x('partsCount', { n: (p.components || []).length })}</span>
      <div class="pk-comp pk-comp--offer">
        ${(p.components || []).map((c) => html`
          <div key=${'t' + c.id}><code>${partWord(c.type)}</code></div>
          <div key=${'n' + c.id}>${c.label || c.id}<small>${c.id}</small></div>
          <div key=${'w' + c.id}>${(c.dependencies || []).length ? x('needs', { list: c.dependencies.join(', ') }) : ''}</div>`)}
      </div>
      <div class="pk-kv">
        <div class="pk-k">${x('versionsK')}</div><div class="pk-v">${versions ? x('versionsLine', { n: versions.length, latest: versionDate(p.version) }) : x('versionsLoading')}<small>${x('versionsSub')}</small></div>
        <div class="pk-k">${x('vis.k')}</div><div class="pk-v">${p.visibility === 'public' ? x('vis.publicLong') : x('vis.privateLong')}<small>${state ? listingWord(state) : x('notInGalleryLong')}${p.rejectionReason || listing?.rejectionReason ? html` · ${x('rejectedBecause', { reason: p.rejectionReason || listing.rejectionReason })}` : null}</small>
          <div class="og-doors pk-vis">
            <button type="button" class=${`og-door og-door--quiet ${p.visibility === 'private' ? 'is-on' : ''}`} disabled=${ctx.busy || p.visibility === 'private'} onClick=${() => ctx.setVisibility(p, 'private')}>${x('vis.private')}</button>
            <button type="button" class=${`og-door og-door--quiet ${p.visibility === 'public' ? 'is-on' : ''}`} disabled=${ctx.busy || p.visibility === 'public'} onClick=${() => ctx.setVisibility(p, 'public')}>${x('vis.public')}</button>
            ${p.status === 'published' && !state ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.propose(p)}>${x('propose')}</button>` : null}
          </div>
        </div>
        <div class="pk-k">${x('installK')}</div><div class="pk-v">
          <div class="pk-inst"><input class="og-input" value=${inst.label} placeholder=${x('labelPlaceholder')} onInput=${(e) => ctx.setInstallLabel(key, e.target.value)} /><button type="button" class="og-door" disabled=${ctx.busy} onClick=${() => ctx.install({ group: p.packageGroupId, title: p.name }, inst.label)}>${ctx.busy === key ? x('installing') : x('install')}</button></div>
          <small>${installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) + ' · ' : ''}${x('installOwnSub')}</small></div>
      </div>
      <div class="og-doors pk-open-doors">
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.download(p.packageGroupId, p.name)}>${x('downloadZip')}</button>
        <${CopyButton} text=${agentTextFor({ title: p.name, group: p.packageGroupId, description: p.description || '', components: p.components || [] })} className="og-door og-door--quiet" label=${x('copyAgent')} copiedLabel=${x('copied')} />
        <button type="button" class="og-door og-door--quiet pk-danger" onClick=${() => ctx.archive(p)}>${x('archive')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggle(key, p)}>${x('close')}</button>
      </div>
    </div>`;
}

export const loadingRow = () => html`<p class="pk-empty">${t('common.loading')}</p>`;
