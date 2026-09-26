/**
 * @file public/views/profile/knowledge/package.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One knowledge package as its own page under the Knowledge crumb: its state, kind,
 *   synthesis, language and tags as chips; export, the library link and delete as doors; a strip
 *   with the entries, the references and how many are verified, the sharing state and the dates;
 *   then what the package is about, the entries as text with their sources named verified or
 *   unchecked and their relations in words, the sharing switches, and the details as a fold. Every
 *   write goes through the handlers the old card called.
 * @structure renderPackage · entryBlock
 * @usage import { renderPackage } from './package.js';
 * @version-history
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- The figure's "of how many" is the Figure strip's own cut (.og-strip-of), moved unchanged from .kp-of (a move).
 *   v1.14.0 -- 2026-09-26 -- A package's id in its details is the inline code (.code-inline), a unification: the look most tabs use for an identifier.
 *   v1.13.0 -- 2026-09-26 -- A reference's type is the Tag (.poster-chip), a unification: Jouni's decision Tag.
 *   v1.12.0 -- 2026-09-25 -- An entry's public or private switch is the Tab's fold tone (.poster-tab--fold, is-on and aria-pressed while public), a unification: Jouni's decision "Tabs and filters".
 *   v1.11.0 — 2026-09-25 — A closed entry's grey count line is the Hint (.poster-hint), a unification: the look most tabs use.
 *   v1.10.0 — 2026-09-25 — The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.9.0 — 2026-09-25 — The sharing switches and the details are the Facts (facts facts--wide, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.8.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — A setting that is on or off is the library's Switch (components/Switch.js), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { Switch } from '/components/Switch.js';
import { c, day, rel, ctWord, maturityWord, synthWord, visWord, relWord, manifestOf, statsOf, pkgId, entryText, renderPage } from './frame.js';

const VIS_CYCLE = ['private', 'owner', 'group', 'public'];

function entryBlock(ctx, pkg, entry, i, allEntries) {
  const key = entry.key || String(i);
  const open = ctx.openEntries.has(key);
  const data = ctx.entryData[entry.key] ?? entry.value;
  const text = entryText(data);
  const vis = entry.visibility || 'private';
  const next = VIS_CYCLE[(VIS_CYCLE.indexOf(vis) + 1) % VIS_CYCLE.length];
  const refs = entry.references || [];
  const rels = entry.related_entries || [];
  const label = entry.title || entry.key || c('entryN', { n: i + 1 });
  const target = (k) => allEntries.find(e => e.key === k || String(e.key || '').endsWith('/' + k));
  return html`
    <div class=${`kp-entry ${open ? 'is-open' : ''}`} key=${key} id=${'kp-e-' + i}>
      <div class="kp-entry-h">
        <button type="button" class="kp-entry-title" onClick=${() => ctx.toggleEntry(key)}>${label}</button>
        <div class="kp-entry-r">
          ${ctx.readOnly ? html`<span class=${`poster-chip ${vis === 'public' ? 'poster-chip--sun' : ''}`}>${visWord(vis)}</span>`
            : html`<button type="button" class=${`poster-tab poster-tab--fold ${vis === 'public' ? 'is-on' : ''}`} aria-pressed=${vis === 'public' ? 'true' : 'false'} title=${`${visWord(vis)} → ${visWord(next)}`} onClick=${() => ctx.handleEntryVisibility(pkg, entry, next)}>${visWord(vis)} ▾</button>`}
          ${!open ? html`<span class="poster-hint kp-inline">${[refs.length ? c('refsN', { n: refs.length }) : '', rels.length ? c('relsN', { n: rels.length }) : ''].filter(Boolean).join(' · ')}</span>` : null}
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggleEntry(key)}>${open ? c('close') : c('open')}</button>
        </div>
      </div>
      ${open ? html`
        ${ctx.loadingEntries && !text ? html`<p class="poster-quiet loading-mark">${t('common.loading')}</p>` : text ? html`<p class="kp-entry-text">${text}</p>` : html`<p class="poster-quiet">${c('noContent')}</p>`}
        ${refs.length ? html`<div class="kp-refs">${refs.map((r, j) => html`
          <div class="kp-ref" key=${j}><i class=${r.verified ? '' : 'kp-ref--no'}>${r.verified ? c('verified') : c('unverified')}</i>
            ${r.url ? html`<a href=${r.url} target="_blank" rel="noopener">${r.title || r.url} ↗</a>` : html`<span>${r.title || c('untitled')}</span>`}
            ${r.type ? html`<span class="poster-chip">${r.type}</span>` : null}</div>`)}</div>` : null}
        ${rels.length ? html`<div class="kp-rels">${rels.map((r, j) => { const tg = target(r.key); const idx = tg ? allEntries.indexOf(tg) : -1; return html`
          <button type="button" class="kp-rel" key=${j} onClick=${() => { if (idx >= 0) { ctx.openEntry(allEntries[idx].key || String(idx)); document.getElementById('kp-e-' + idx)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }}><b>${relWord(r.relation)}</b>${tg ? (tg.title || r.key) : r.key}</button>`; })}</div>` : null}` : null}
    </div>`;
}

export function renderPackage(ctx, pkg) {
  const m = manifestOf(pkg);
  const id = pkgId(pkg);
  const s = statsOf(m);
  const entries = m.entries || [];
  const listed = !!m.sharing?.catalog_listed;
  const federated = !!ctx.fedConsents[id];
  const tags = m.tags || [];
  const others = ctx.packages.filter(p => pkgId(p) !== id).slice(0, 6);
  const allOpen = entries.length && entries.every((e, i) => ctx.openEntries.has(e.key || String(i)));

  const chips = html`
    <span class=${`poster-chip ${m.maturity === 'published' || m.maturity === 'stable' ? 'poster-chip--sun' : ''}`}>${maturityWord(m.maturity)}</span>
    <span class="poster-chip">${ctWord(m.content_type || 'document')}</span>
    <span class="poster-chip">${synthWord(m.synthesis?.level)}</span>
    ${m.language ? html`<span class="poster-chip">${String(m.language).toLowerCase()}</span>` : null}
    ${m.version ? html`<span class="poster-chip">v${m.version}</span>` : null}
    ${m.sharing?.license ? html`<span class="poster-chip">${m.sharing.license}</span>` : null}
    ${federated ? html`<span class="poster-chip poster-chip--coral">${t('knowledge.federated')}</span>` : null}
    ${tags.slice(0, 4).map(tag => html`<span class="poster-chip" key=${tag}>${tag}</span>`)}
    ${tags.length > 4 ? html`<span class="poster-chip">+${tags.length - 4}</span>` : null}`;
  const doors = html`
    <button type="button" class="poster-slab" onClick=${() => ctx.handleExport(pkg)}>${t('knowledge.myKnowledge.export')}</button>
    ${listed ? html`<button type="button" class="poster-action poster-action--small" onClick=${() => window.open('/v1/publicknowledgeviewer?id=' + encodeURIComponent(id), '_blank', 'noopener')}>${c('showInLibrary')} ↗</button>` : null}
    <button type="button" class="poster-action poster-action--small poster-action--danger" disabled=${ctx.deleting === pkg.key} onClick=${() => ctx.handleDelete(pkg)}>${t('profile.delete')}</button>`;
  const strip = html`
    <div class="og-strip">
      <div><b>${s.entries}</b><span>${c('stripEntries')}</span><small>${c('stripEntriesSub', { n: s.publicN })}</small></div>
      <div><b>${s.verified}<span class="og-strip-of">/${s.refs}</span></b><span>${c('stripRefs')}</span><small>${s.refs - s.verified ? c('stripRefsSub', { n: s.refs - s.verified }) : (s.refs ? c('stripRefsAll') : c('noRefs'))}</small></div>
      <div><b class="og-strip-coral">${listed ? c('listedShort') : c('privateShort')}</b><span>${c('stripSharing')}</span><small>${[m.sharing?.allow_clone ? c('clonable') : c('notClonable'), federated ? t('knowledge.federated') : ''].filter(Boolean).join(' · ')}</small></div>
      <div><b>${rel(m.updated || pkg.updated_at)}</b><span>${c('stripUpdated')}</span><small>${m.created ? c('createdOn', { d: day(m.created) }) : ''}${m.author ? ` · ${m.author}` : ''}</small></div>
    </div>`;
  const rail = html`
    <hr /><span class="og-rail-label">${c('inPackage')}</span>
    ${[['01', 'kp-about', c('secAbout')], ['02', 'kp-entries', c('secEntries')], ['03', 'kp-sharing', c('secSharing')], ['04', 'kp-details', c('secDetails')]].map(([n, sid, label]) => html`<button type="button" class="og-rail-link" key=${sid} onClick=${() => document.getElementById(sid)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><i>${n}</i>${label}${sid === 'kp-entries' ? html`<em>${entries.length}</em>` : null}</button>`)}
    ${others.length ? html`<hr /><span class="og-rail-label">${c('otherPackages')}</span>
      ${others.map(p => html`<button type="button" class="og-rail-link" key=${pkgId(p)} onClick=${() => ctx.pickView({ kind: 'package', id: pkgId(p) })}><i>→</i>${manifestOf(p).name || c('untitled')}</button>`)}` : null}`;
  const toggle = (field, on, label, hint) => html`
    <div class="facts-k poster-label">${label}</div>
    <div class="facts-v"><${Switch} on=${on} label=${hint} disabled=${ctx.savingSharing === pkg.key} onToggle=${() => ctx.handleSharingChange(pkg, field, !on)} /></div>`;

  return renderPage(ctx, {
    crumbs: [m.name || c('untitled')], title: m.name || c('untitled'), chips, doors, strip, rail,
    children: html`
      <${PageSection} id="kp-about" num="01" title=${c('secAbout')} first=${true}>
        ${m.synthesis?.description ? html`<p class="kp-about">${m.synthesis.description}</p>` : html`<p class="poster-quiet">${c('noAbout')}</p>`}
      <//>
      <${PageSection} id="kp-entries" num="02" title=${c('secEntries')} count=${entries.length} doors=${html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setAllEntries(entries, !allOpen)}>${allOpen ? c('closeAll') : c('openAll')}</button>`}>
        ${entries.length ? entries.map((e, i) => entryBlock(ctx, pkg, e, i, entries)) : html`<p class="poster-quiet">${c('noEntries')}</p>`}
      <//>
      <${PageSection} id="kp-sharing" num="03" title=${c('secSharing')}>
        <div class="facts facts--wide kp-kv">
          ${toggle('catalog_listed', listed, c('kLibrary'), listed ? c('listedHint') : c('notListedHint'))}
          ${toggle('allow_clone', !!m.sharing?.allow_clone, c('kClone'), m.sharing?.allow_clone ? c('cloneOn') : c('cloneOff'))}
          <div class="facts-k poster-label">${c('kFederation')}</div>
          <div class="facts-v"><${Switch} on=${federated} label=${federated ? c('fedOn') : c('fedOff')} disabled=${ctx.togglingFed === pkg.key} onToggle=${() => ctx.toggleFederation(pkg)} /></div>
          ${ctx.organisms.length ? html`<div class="facts-k poster-label">${c('kOrganism')}</div>
            <div class="facts-v kp-orgshare"><select class="select-field" value=${ctx.shareOrg} onChange=${(e) => ctx.setShareOrg(e.target.value)}><option value="">${c('pickOrganism')}</option>${ctx.organisms.map(o => html`<option value=${o.id || o.organismId} key=${o.id || o.organismId}>${o.name || o.id}</option>`)}</select>
              <button type="button" class="poster-action poster-action--small" disabled=${!ctx.shareOrg} onClick=${() => ctx.contributeToOrganism(pkg)}>${t('knowledge.organisms.contribute')}</button></div>` : null}
        </div>
      <//>
      <${FoldSection} id="kp-details" num="04" title=${c('secDetails')} sub=${`${id}${m.author ? ` · ${m.author}` : ''}`} open=${ctx.detailsOpen} onToggle=${() => ctx.setDetailsOpen(v => !v)}>
        <div class="facts facts--wide kp-kv">
          <div class="facts-k poster-label">ID</div><div class="facts-v"><code class="code-inline">${id}</code></div>
          ${m.author ? html`<div class="facts-k poster-label">${t('pkv.author')}</div><div class="facts-v">${m.author}</div>` : null}
          ${m.synthesis?.model ? html`<div class="facts-k poster-label">${c('kModel')}</div><div class="facts-v">${m.synthesis.model}</div>` : null}
          ${m.sharing?.license ? html`<div class="facts-k poster-label">${t('pkv.license')}</div><div class="facts-v">${m.sharing.license}</div>` : null}
          ${m.created ? html`<div class="facts-k poster-label">${t('pkv.created')}</div><div class="facts-v">${day(m.created)}</div>` : null}
          ${m.updated ? html`<div class="facts-k poster-label">${t('pkv.updated')}</div><div class="facts-v">${day(m.updated)}</div>` : null}
          ${tags.length ? html`<div class="facts-k poster-label">${c('kTags')}</div><div class="facts-v">${tags.join(', ')}</div>` : null}
        </div>
      <//>`,
  });
}
