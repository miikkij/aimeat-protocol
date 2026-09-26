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
import { CopyButton } from '/components/CopyButton.js';
import { x, partWord, partTab, partCounts, categoryWord, listingWord, dateWord, versionDate, agentTextFor, openTab } from './frame.js';

const dot = (on) => html`<i class=${`status-dot ${on ? 'status-dot--active' : 'status-dot--inactive'}`} aria-hidden="true"></i>`;
const partChips = (list) => html`<span class="pk-parts">${partCounts(list).map(([type, n]) => html`<span key=${type} class="poster-chip">${partWord(type)}${n > 1 ? ` ×${n}` : ''}</span>`)}</span>`;

/* ── An installed package ─────────────────────────────────────────────────────────────────────── */

export function instanceRow(ctx, inst) {
  const open = ctx.expanded === 'i:' + inst.id;
  const comps = inst.installedComponents || [];
  const app = comps.find((c) => c.type === 'app');
  const source = ctx.offerByGroup[inst.packageGroupId] || ctx.ownByGroup[inst.packageGroupId] || null;
  const running = inst.status === 'installed';
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${inst.id}>
      <div class="listing-name">${dot(running)}${inst.label || inst.packageGroupId.split('::')[0]}<span class="poster-chip">${versionDate(inst.packageVersion)}</span><small>${[running ? x('running') : x('status.' + inst.status), x('partsN', { n: comps.length }), x('installedOn', { date: dateWord(inst.installedAt) })].join(' · ')}</small></div>
      <div class="listing-desc"><span class="pk-desc">${source?.description || x('instanceDesc')}</span>${partChips(comps)}</div>
      <div class="listing-who">${x('fromPackage')} <button type="button" class="poster-action poster-action--more" onClick=${() => ctx.jumpTo(inst.packageGroupId)}>${source?.title || inst.packageGroupId.split('::')[0]}</button><small>${source ? (ctx.ownByGroup[inst.packageGroupId] ? x('ownPublication') : source.system ? x('bySystem') : x('byAuthor', { author: source.author })) : x('packageGone')}${source?.version && source.version !== inst.packageVersion ? ` · ${x('newerVersion')}` : ''}</small></div>
      <div class="listing-doors">
        <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggle('i:' + inst.id, inst)}>${open ? x('close') : x('open')}</button>
        ${app ? html`<a class="poster-action poster-action--small poster-action--row poster-action--lower" href=${`/v1/apps/${encodeURIComponent(ctx.ownerName)}/${encodeURIComponent(app.registeredAs)}?mode=inline`} target="_blank" rel="noopener">${x('openApp')}</a>` : null}
      </div>
      ${open ? instanceOpen(ctx, inst, comps, app, source) : null}
    </div>`;
}

function instanceOpen(ctx, inst, comps, app, source) {
  const upd = ctx.updates[inst.id];
  const customized = comps.filter((c) => c.customized).length;
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${x('instanceLead', { date: dateWord(inst.installedAt), name: source?.title || inst.packageGroupId.split('::')[0], version: inst.packageVersion })} ${customized ? x('instanceCustomized', { n: customized }) : x('instanceUntouched', { n: comps.length })}</p>
      <span class="poster-label">${x('partsLabel')}</span>
      <div class="listing listing--kind-name-who-doors pk-comp">
        ${comps.map((c) => html`
          <div class="listing-row" key=${c.componentId}>
            <div><code>${partWord(c.type)}</code></div>
            <div class="listing-name">${c.componentId}<small>${c.registeredAs}</small></div>
            <div class="listing-who">${x('partOn.' + partTab(c.type))}${c.customized ? html`<small class="is-warn">${x('partCustomized', { date: dateWord(c.customizedAt) })}</small>` : html`<small>${x('partUntouched')}</small>`}</div>
            <div class="listing-doors">${c.type === 'app' ? html`<a class="poster-action poster-action--small poster-action--row poster-action--lower" href=${`/v1/apps/${encodeURIComponent(ctx.ownerName)}/${encodeURIComponent(c.registeredAs)}?mode=inline`} target="_blank" rel="noopener">${x('open')}</a>` : html`<button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => openTab(partTab(c.type))}>${partTab(c.type) === 'memory' ? x('inspect') : x('manage')}</button>`}</div>
          </div>`)}
      </div>
      <div class="facts">
        <div class="facts-k poster-label">${x('updateK')}</div><div class="facts-v">${!upd ? x('updateUnknown') : upd.checking ? x('updateChecking') : upd.error ? upd.error : upd.updateAvailable ? x('updateAvailable', { version: versionDate(upd.latestVersion) }) : x('updateNone')}<small>${
          // Said before the button rather than after: a part this owner has edited is NOT updated,
          // and knowing that beforehand is the difference between pressing a button and being
          // surprised by it.
          customized ? x('updateKeepsYours', { n: customized }) : x('updateSub')
        }${upd?.updateAvailable ? html` <button type="button" class="poster-action poster-action--more" disabled=${ctx.busy} onClick=${() => ctx.applyUpdate(inst, upd)}>${x('applyUpdate')}</button>` : null}</small></div>
        <div class="facts-k poster-label">${x('forAgentK')}</div><div class="facts-v">${x('forAgentInstance')}<small>${x('forAgentInstanceSub')}</small></div>
      </div>
      <div class="og-doors listing-open-doors">
        ${app ? html`<a class="poster-action poster-action--small" href=${`/v1/apps/${encodeURIComponent(ctx.ownerName)}/${encodeURIComponent(app.registeredAs)}?mode=inline`} target="_blank" rel="noopener">${x('openApp')}</a>` : null}
        <button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy} onClick=${() => ctx.checkUpdate(inst)}>${x('checkUpdate')}</button>
        <${CopyButton} text=${comps.map((c) => `${c.type} ${c.registeredAs}`).join('\n')} className="poster-action poster-action--small poster-action--lower" label=${x('copyNames')} copiedLabel=${x('copied')} />
        <button type="button" class="poster-action poster-action--small poster-action--danger poster-action--lower" onClick=${() => ctx.removeInstance(inst)}>${x('removeInstance')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggle('i:' + inst.id, inst)}>${x('close')}</button>
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
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${key} id=${'pk-row-' + (o.group || '').replace(/[^a-z0-9]/gi, '-')}>
      <div class="listing-name">${o.title}${o.version ? html`<span class="poster-chip">${versionDate(o.version)}</span>` : null}<small>${sub}</small></div>
      <div class="listing-desc"><span class="pk-desc">${o.description}</span>${o.components.length ? partChips(o.components) : null}</div>
      <div class="listing-who">${installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) : x('installYours')}<small>${[o.components.length ? x('partsN', { n: o.components.length }) : '', o.listing?.installCount ? (o.listing.installCount === 1 ? x('installOne') : x('installsN', { n: o.listing.installCount })) : '', o.listing?.featured ? x('featured') : ''].filter(Boolean).join(' · ') || x('noInstallsYet')}</small></div>
      <div class="listing-doors">
        ${o.group ? html`<button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggle(key, o)}>${open ? x('close') : x('install')}</button>` : null}
        <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.toggle(key, o)}>${open ? x('close') : x('open')}</button>
      </div>
      ${open ? offerOpen(ctx, o, key) : null}
    </div>`;
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
    <div class="poster-panel pk-expects">
      <span class="poster-label">${x('expectsLabel')}</span>
      ${lines.map((line, i) => html`<p key=${i} class="og-lead">${line}</p>`)}
    </div>`;
}

function offerOpen(ctx, o, key) {
  const inst = ctx.installForm && ctx.installForm.key === key ? ctx.installForm : { label: '' };
  const l = o.listing;
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${o.description}</p>
      ${o.components.length ? html`
        <span class="poster-label">${x('partsCount', { n: o.components.length })}</span>
        <div class="listing listing--kind-name-desc pk-comp">
          ${o.components.map((c) => html`
            <div class="listing-row" key=${c.id}>
              <div><code>${partWord(c.type)}</code></div>
              <div class="listing-name">${c.label || c.id}<small>${c.id}</small></div>
              <div class="listing-desc">${(c.dependencies || []).length ? x('needs', { list: c.dependencies.join(', ') }) : ''}</div>
            </div>`)}
        </div>` : null}
      ${expectsOf(o)}
      <div class="facts">
        <div class="facts-k poster-label">${x('makerK')}</div><div class="facts-v">${o.remote ? x('makerRemote', { node: o.sourceNode }) : o.system ? x('makerSystem') : x('makerAuthor', { author: o.author })}<small>${[o.version ? x('versionOf', { date: versionDate(o.version) }) : '', categoryWord(o.category) ? x('categoryOf', { c: categoryWord(o.category) }) : '', o.tags.length ? x('tagsOf', { tags: o.tags.join(', ') }) : ''].filter(Boolean).join(' · ')}</small></div>
        ${l && (l.installCount || l.reviewCount) ? html`<div class="facts-k poster-label">${x('galleryK')}</div><div class="facts-v">${[l.installCount ? x('installsN', { n: l.installCount }) : '', l.reviewCount ? x('reviewsN', { n: l.reviewCount, rating: Number(l.rating || 0).toFixed(1) }) : ''].filter(Boolean).join(' · ')}</div>` : null}
        ${o.group ? html`<div class="facts-k poster-label">${x('installK')}</div><div class="facts-v">
          <div class="field-row pk-inst"><input class="og-input" value=${inst.label} placeholder=${x('labelPlaceholder')} onInput=${(e) => ctx.setInstallLabel(key, e.target.value)} /><button type="button" class="poster-action poster-action--small" disabled=${ctx.busy} onClick=${() => ctx.install(o, inst.label)}>${ctx.busy === key ? x('installing') : x('install')}</button></div>
          <small>${x('installSub')}</small></div>` : null}
      </div>
      <div class="og-doors listing-open-doors">
        ${o.group ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.download(o.group, o.name)}>${x('downloadZip')}</button>` : null}
        <${CopyButton} text=${agentTextFor(o)} className="poster-action poster-action--small poster-action--lower" label=${x('copyAgent')} copiedLabel=${x('copied')} />
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggle(key, o)}>${x('close')}</button>
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
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${key} id=${'pk-row-' + p.packageGroupId.replace(/[^a-z0-9]/gi, '-')}>
      <div class="listing-name">${p.name}<span class="poster-chip">${versionDate(p.version)}</span><small>${[x('partsN', { n: (p.components || []).length }), categoryWord(p.category), dateWord(p.updatedAt || p.createdAt)].filter(Boolean).join(' · ')}</small></div>
      <div class="listing-desc"><span class="pk-desc">${p.description || ''}</span>${partChips(p.components)}</div>
      <div class="listing-who">${p.visibility === 'public' ? x('vis.public') : x('vis.private')}<small>${[
        p.status === 'published' ? '' : x('statusWord.' + p.status),
        state ? listingWord(state) : x('notInGallery'),
        installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) : '',
      ].filter(Boolean).join(' · ')}</small></div>
      <div class="listing-doors">
        ${p.status === 'published' ? null
          // A draft cannot be installed by anybody, including its author, so the door that changes
          // that leads the row and the usual open door steps back to quiet.
          : html`<button type="button" class="poster-action poster-action--small poster-action--row" disabled=${!!ctx.busy} onClick=${() => ctx.publishOwn(p)}>${x('publishIt')}</button>`}
        <button type="button" class=${`poster-action poster-action--small poster-action--row${p.status === 'published' ? '' : ' poster-action--lower'}`} onClick=${() => ctx.toggle(key, p)}>${open ? x('close') : x('open')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.download(p.packageGroupId, p.name)}>${x('downloadZip')}</button>
      </div>
      ${open ? ownOpen(ctx, p, key, listing, state, installed) : null}
    </div>`;
}

function ownOpen(ctx, p, key, listing, state, installed) {
  const inst = ctx.installForm && ctx.installForm.key === key ? ctx.installForm : { label: '' };
  const versions = ctx.versions[p.packageGroupId];
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${p.description || ''}</p>
      <span class="poster-label">${x('partsCount', { n: (p.components || []).length })}</span>
      <div class="listing listing--kind-name-desc pk-comp">
        ${(p.components || []).map((c) => html`
          <div class="listing-row" key=${c.id}>
            <div><code>${partWord(c.type)}</code></div>
            <div class="listing-name">${c.label || c.id}<small>${c.id}</small></div>
            <div class="listing-desc">${(c.dependencies || []).length ? x('needs', { list: c.dependencies.join(', ') }) : ''}</div>
          </div>`)}
      </div>
      <div class="facts">
        <div class="facts-k poster-label">${x('versionsK')}</div><div class="facts-v">${versions ? x('versionsLine', { n: versions.length, latest: versionDate(p.version) }) : x('versionsLoading')}<small>${x('versionsSub')}</small></div>
        <div class="facts-k poster-label">${x('vis.k')}</div><div class="facts-v">${p.visibility === 'public' ? x('vis.publicLong') : x('vis.privateLong')}<small>${state ? listingWord(state) : x('notInGalleryLong')}${p.rejectionReason || listing?.rejectionReason ? html` · ${x('rejectedBecause', { reason: p.rejectionReason || listing.rejectionReason })}` : null}</small>
          <div class="og-doors pk-vis">
            <button type="button" class=${`poster-tab ${p.visibility === 'private' ? 'is-on' : ''}`} disabled=${ctx.busy || p.visibility === 'private'} onClick=${() => ctx.setVisibility(p, 'private')}>${x('vis.private')}</button>
            <button type="button" class=${`poster-tab ${p.visibility === 'public' ? 'is-on' : ''}`} disabled=${ctx.busy || p.visibility === 'public'} onClick=${() => ctx.setVisibility(p, 'public')}>${x('vis.public')}</button>
            ${p.status === 'published' && !state ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy} onClick=${() => ctx.propose(p)}>${x('propose')}</button>` : null}
          </div>
        </div>
        <div class="facts-k poster-label">${x('installK')}</div><div class="facts-v">
          <div class="field-row pk-inst"><input class="og-input" value=${inst.label} placeholder=${x('labelPlaceholder')} onInput=${(e) => ctx.setInstallLabel(key, e.target.value)} /><button type="button" class="poster-action poster-action--small" disabled=${ctx.busy} onClick=${() => ctx.install({ group: p.packageGroupId, title: p.name }, inst.label)}>${ctx.busy === key ? x('installing') : x('install')}</button></div>
          <small>${installed ? (installed === 1 ? x('installedOnce') : x('installedN', { n: installed })) + ' · ' : ''}${x('installOwnSub')}</small></div>
      </div>
      <div class="og-doors listing-open-doors">
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.download(p.packageGroupId, p.name)}>${x('downloadZip')}</button>
        <${CopyButton} text=${agentTextFor({ title: p.name, group: p.packageGroupId, description: p.description || '', components: p.components || [] })} className="poster-action poster-action--small poster-action--lower" label=${x('copyAgent')} copiedLabel=${x('copied')} />
        <button type="button" class="poster-action poster-action--small poster-action--danger poster-action--lower" onClick=${() => ctx.archive(p)}>${x('archive')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggle(key, p)}>${x('close')}</button>
      </div>
    </div>`;
}

export const loadingRow = () => html`<p class="poster-quiet pk-empty loading-mark">${t('common.loading')}</p>`;
