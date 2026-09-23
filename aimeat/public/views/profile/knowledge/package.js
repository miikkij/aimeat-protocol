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
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold } from '/views/profile/organisms/poster-parts.js';
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
          ${ctx.readOnly ? html`<span class=${`og-chip ${vis === 'public' ? 'og-chip--sun' : 'og-chip--dim'}`}>${visWord(vis)}</span>`
            : html`<button type="button" class=${`og-chip kp-chip--btn ${vis === 'public' ? 'og-chip--sun' : ''}`} title=${`${visWord(vis)} → ${visWord(next)}`} onClick=${() => ctx.handleEntryVisibility(pkg, entry, next)}>${visWord(vis)} ▾</button>`}
          ${!open ? html`<span class="kp-hint kp-inline">${[refs.length ? c('refsN', { n: refs.length }) : '', rels.length ? c('relsN', { n: rels.length }) : ''].filter(Boolean).join(' · ')}</span>` : null}
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleEntry(key)}>${open ? c('close') : c('open')}</button>
        </div>
      </div>
      ${open ? html`
        ${ctx.loadingEntries && !text ? html`<p class="og-empty kp-loading">${t('common.loading')}</p>` : text ? html`<p class="kp-entry-text">${text}</p>` : html`<p class="og-empty">${c('noContent')}</p>`}
        ${refs.length ? html`<div class="kp-refs">${refs.map((r, j) => html`
          <div class="kp-ref" key=${j}><i class=${r.verified ? '' : 'kp-ref--no'}>${r.verified ? c('verified') : c('unverified')}</i>
            ${r.url ? html`<a href=${r.url} target="_blank" rel="noopener">${r.title || r.url} ↗</a>` : html`<span>${r.title || c('untitled')}</span>`}
            ${r.type ? html`<span class="kp-mono">${r.type}</span>` : null}</div>`)}</div>` : null}
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
    <span class=${`og-chip ${m.maturity === 'published' || m.maturity === 'stable' ? 'og-chip--sun' : ''}`}>${maturityWord(m.maturity)}</span>
    <span class="og-chip">${ctWord(m.content_type || 'document')}</span>
    <span class="og-chip">${synthWord(m.synthesis?.level)}</span>
    ${m.language ? html`<span class="og-chip og-chip--dim">${String(m.language).toLowerCase()}</span>` : null}
    ${m.version ? html`<span class="og-chip og-chip--dim">v${m.version}</span>` : null}
    ${m.sharing?.license ? html`<span class="og-chip og-chip--dim kp-chip--case">${m.sharing.license}</span>` : null}
    ${federated ? html`<span class="og-chip og-chip--coral">${t('knowledge.federated')}</span>` : null}
    ${tags.slice(0, 4).map(tag => html`<span class="og-chip og-chip--dim kp-chip--case" key=${tag}>${tag}</span>`)}
    ${tags.length > 4 ? html`<span class="og-chip og-chip--dim">+${tags.length - 4}</span>` : null}`;
  const doors = html`
    <button type="button" class="og-slab" onClick=${() => ctx.handleExport(pkg)}>${t('knowledge.myKnowledge.export')}</button>
    ${listed ? html`<button type="button" class="og-door" onClick=${() => window.open('/v1/publicknowledgeviewer?id=' + encodeURIComponent(id), '_blank', 'noopener')}>${c('showInLibrary')} ↗</button>` : null}
    <button type="button" class="og-door og-door--danger" disabled=${ctx.deleting === pkg.key} onClick=${() => ctx.handleDelete(pkg)}>${t('profile.delete')}</button>`;
  const strip = html`
    <div class="og-strip">
      <div><b>${s.entries}</b><span>${c('stripEntries')}</span><small>${c('stripEntriesSub', { n: s.publicN })}</small></div>
      <div><b>${s.verified}<span class="kp-of">/${s.refs}</span></b><span>${c('stripRefs')}</span><small>${s.refs - s.verified ? c('stripRefsSub', { n: s.refs - s.verified }) : (s.refs ? c('stripRefsAll') : c('noRefs'))}</small></div>
      <div><b class="og-strip-coral">${listed ? c('listedShort') : c('privateShort')}</b><span>${c('stripSharing')}</span><small>${[m.sharing?.allow_clone ? c('clonable') : c('notClonable'), federated ? t('knowledge.federated') : ''].filter(Boolean).join(' · ')}</small></div>
      <div><b>${rel(m.updated || pkg.updated_at)}</b><span>${c('stripUpdated')}</span><small>${m.created ? c('createdOn', { d: day(m.created) }) : ''}${m.author ? ` · ${m.author}` : ''}</small></div>
    </div>`;
  const rail = html`
    <hr /><span class="og-rail-label">${c('inPackage')}</span>
    ${[['01', 'kp-about', c('secAbout')], ['02', 'kp-entries', c('secEntries')], ['03', 'kp-sharing', c('secSharing')], ['04', 'kp-details', c('secDetails')]].map(([n, sid, label]) => html`<button type="button" class="og-rail-link" key=${sid} onClick=${() => document.getElementById(sid)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><i>${n}</i>${label}${sid === 'kp-entries' ? html`<em>${entries.length}</em>` : null}</button>`)}
    ${others.length ? html`<hr /><span class="og-rail-label">${c('otherPackages')}</span>
      ${others.map(p => html`<button type="button" class="og-rail-link" key=${pkgId(p)} onClick=${() => ctx.pickView({ kind: 'package', id: pkgId(p) })}><i>→</i>${manifestOf(p).name || c('untitled')}</button>`)}` : null}`;
  const toggle = (field, on, label, hint) => html`
    <div class="k">${label}</div>
    <div><button type="button" class=${`kp-toggle ${on ? 'on' : ''}`} disabled=${ctx.savingSharing === pkg.key} onClick=${() => ctx.handleSharingChange(pkg, field, !on)}><i></i>${hint}</button></div>`;

  return renderPage(ctx, {
    crumbs: [m.name || c('untitled')], title: m.name || c('untitled'), chips, doors, strip, rail,
    children: html`
      <${Section} id="kp-about" num="01" title=${c('secAbout')} first=${true}>
        ${m.synthesis?.description ? html`<p class="kp-about">${m.synthesis.description}</p>` : html`<p class="og-empty">${c('noAbout')}</p>`}
      <//>
      <${Section} id="kp-entries" num="02" title=${c('secEntries')} count=${entries.length} doors=${html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setAllEntries(entries, !allOpen)}>${allOpen ? c('closeAll') : c('openAll')}</button>`}>
        ${entries.length ? entries.map((e, i) => entryBlock(ctx, pkg, e, i, entries)) : html`<p class="og-empty">${c('noEntries')}</p>`}
      <//>
      <${Section} id="kp-sharing" num="03" title=${c('secSharing')}>
        <div class="kp-kv">
          ${toggle('catalog_listed', listed, c('kLibrary'), listed ? c('listedHint') : c('notListedHint'))}
          ${toggle('allow_clone', !!m.sharing?.allow_clone, c('kClone'), m.sharing?.allow_clone ? c('cloneOn') : c('cloneOff'))}
          <div class="k">${c('kFederation')}</div>
          <div><button type="button" class=${`kp-toggle ${federated ? 'on' : ''}`} disabled=${ctx.togglingFed === pkg.key} onClick=${() => ctx.toggleFederation(pkg)}><i></i>${federated ? c('fedOn') : c('fedOff')}</button></div>
          ${ctx.organisms.length ? html`<div class="k">${c('kOrganism')}</div>
            <div class="kp-orgshare"><select value=${ctx.shareOrg} onChange=${(e) => ctx.setShareOrg(e.target.value)}><option value="">${c('pickOrganism')}</option>${ctx.organisms.map(o => html`<option value=${o.id || o.organismId} key=${o.id || o.organismId}>${o.name || o.id}</option>`)}</select>
              <button type="button" class="og-door" disabled=${!ctx.shareOrg} onClick=${() => ctx.contributeToOrganism(pkg)}>${t('knowledge.organisms.contribute')}</button></div>` : null}
        </div>
      <//>
      <${Fold} id="kp-details" num="04" title=${c('secDetails')} sub=${`${id}${m.author ? ` · ${m.author}` : ''}`} open=${ctx.detailsOpen} onToggle=${() => ctx.setDetailsOpen(v => !v)}>
        <div class="kp-kv">
          <div class="k">ID</div><div class="kp-mono">${id}</div>
          ${m.author ? html`<div class="k">${t('pkv.author')}</div><div>${m.author}</div>` : null}
          ${m.synthesis?.model ? html`<div class="k">${c('kModel')}</div><div>${m.synthesis.model}</div>` : null}
          ${m.sharing?.license ? html`<div class="k">${t('pkv.license')}</div><div>${m.sharing.license}</div>` : null}
          ${m.created ? html`<div class="k">${t('pkv.created')}</div><div>${day(m.created)}</div>` : null}
          ${m.updated ? html`<div class="k">${t('pkv.updated')}</div><div>${day(m.updated)}</div>` : null}
          ${tags.length ? html`<div class="k">${c('kTags')}</div><div>${tags.join(', ')}</div>` : null}
        </div>
      <//>`,
  });
}
