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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set (Page, Rail, Section, Fold,
 *     NumeralBand, ListRow, KeyValue, Field, CheckItem, Action, Chip, Text): an entry is a list row
 *     that opens, a sharing switch is a check item (ticked on the sun when on; not clickable while
 *     it saves), the details are key-value rows. Handlers, ids and i18n
 *     keys unchanged; the arrow after an outside link is the allowed → and the ▾ on the visibility
 *     button is gone (its title still names the next visibility).
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, Stack, ListRow, NumeralBand, KeyValue, Field, CheckItem, Action, Chip, Text } from '/components/poster-parts.js';
import { c, day, rel, ctWord, maturityWord, synthWord, visWord, relWord, manifestOf, statsOf, pkgId, entryText, lines, renderPage } from './frame.js';

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
  const summary = [refs.length ? c('refsN', { n: refs.length }) : '', rels.length ? c('relsN', { n: rels.length }) : ''].filter(Boolean).join(' · ');
  return html`<${ListRow} key=${key} id=${'kp-e-' + i} density="compact" name=${label} onOpen=${() => ctx.toggleEntry(key)}
    detail=${!open && summary ? summary : undefined}
    actions=${html`
      ${ctx.readOnly ? html`<${Chip} tone=${vis === 'public' ? 'sun' : 'muted'}>${visWord(vis)}<//>`
        : html`<${Action} kind="tab" selected=${vis === 'public'} title=${`${visWord(vis)} → ${visWord(next)}`} onClick=${() => ctx.handleEntryVisibility(pkg, entry, next)}>${visWord(vis)}<//>`}
      <${Action} expanded=${open} onClick=${() => ctx.toggleEntry(key)}>${open ? c('close') : c('open')}<//>`}>
    ${open ? html`<${Stack} density="compact">
      ${ctx.loadingEntries && !text ? html`<${Text} tone="muted">${t('common.loading')}<//>` : text ? html`<${Text}>${lines(text)}<//>` : html`<${Text} tone="muted">${c('noContent')}<//>`}
      ${refs.length ? html`<${Stack} density="compact">${refs.map((r, j) => html`<${Stack} key=${j} direction="wrap" align="center" density="compact">
        <${Text} kind="mono" tone=${r.verified ? 'success' : 'coral'}>${r.verified ? c('verified') : c('unverified')}<//>
        ${r.url ? html`<${Action} kind="text" href=${r.url} target="_blank">${r.title || r.url} →<//>` : html`<${Text}>${r.title || c('untitled')}<//>`}
        ${r.type ? html`<${Text} kind="mono" tone="muted">${r.type}<//>` : null}
      <//>`)}<//>` : null}
      ${rels.length ? html`<${Stack} direction="wrap" density="compact">${rels.map((r, j) => { const tg = target(r.key); const idx = tg ? allEntries.indexOf(tg) : -1; return html`
        <${Action} key=${j} kind="text" onClick=${() => { if (idx >= 0) { ctx.openEntry(allEntries[idx].key || String(idx)); document.getElementById('kp-e-' + idx)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }}>${relWord(r.relation)} ${tg ? (tg.title || r.key) : r.key}<//>`; })}<//>` : null}
    <//>` : null}
  <//>`;
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

  const chips = html`<${Stack} direction="wrap" density="compact">
    <${Chip} tone=${m.maturity === 'published' || m.maturity === 'stable' ? 'sun' : 'plain'}>${maturityWord(m.maturity)}<//>
    <${Chip}>${ctWord(m.content_type || 'document')}<//>
    <${Chip}>${synthWord(m.synthesis?.level)}<//>
    ${m.language ? html`<${Chip} tone="muted">${String(m.language).toLowerCase()}<//>` : null}
    ${m.version ? html`<${Chip} tone="muted">v${m.version}<//>` : null}
    ${m.sharing?.license ? html`<${Chip} tone="muted">${m.sharing.license}<//>` : null}
    ${federated ? html`<${Chip} tone="sun">${t('knowledge.federated')}<//>` : null}
    ${tags.slice(0, 4).map(tag => html`<${Chip} tone="muted" key=${tag}>${tag}<//>`)}
    ${tags.length > 4 ? html`<${Chip} tone="muted">+${tags.length - 4}<//>` : null}
  <//>`;
  const doors = html`
    <${Action} kind="primary" onClick=${() => ctx.handleExport(pkg)}>${t('knowledge.myKnowledge.export')}<//>
    ${listed ? html`<${Action} onClick=${() => window.open('/v1/publicknowledgeviewer?id=' + encodeURIComponent(id), '_blank', 'noopener')}>${c('showInLibrary')} →<//>` : null}
    <${Action} disabled=${ctx.deleting === pkg.key} onClick=${() => ctx.handleDelete(pkg)}>${t('profile.delete')}<//>`;
  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    { label: c('stripEntries'), value: s.entries, note: c('stripEntriesSub', { n: s.publicN }) },
    { label: c('stripRefs'), value: `${s.verified}/${s.refs}`, note: s.refs - s.verified ? c('stripRefsSub', { n: s.refs - s.verified }) : (s.refs ? c('stripRefsAll') : c('noRefs')) },
    { label: c('stripSharing'), value: listed ? c('listedShort') : c('privateShort'), tone: 'coral', note: [m.sharing?.allow_clone ? c('clonable') : c('notClonable'), federated ? t('knowledge.federated') : ''].filter(Boolean).join(' · ') },
    { label: c('stripUpdated'), value: rel(m.updated || pkg.updated_at), note: `${m.created ? c('createdOn', { d: day(m.created) }) : ''}${m.author ? ` · ${m.author}` : ''}` },
  ]} />`;
  const rail = others.length ? html`<${Stack} density="compact">
    <${Text} kind="label">${c('otherPackages')}<//>
    ${others.map(p => html`<${Action} kind="text" key=${pkgId(p)} onClick=${() => ctx.pickView({ kind: 'package', id: pkgId(p) })}>→ ${manifestOf(p).name || c('untitled')}<//>`)}
  <//>` : null;
  const toggle = (field, on, label, hint) => html`<${KeyValue} label=${label}
    value=${html`<${CheckItem} done=${on} onClick=${ctx.savingSharing === pkg.key ? undefined : () => ctx.handleSharingChange(pkg, field, !on)}>${hint}<//>`} />`;

  return renderPage(ctx, {
    crumbs: [m.name || c('untitled')], title: m.name || c('untitled'), chips, doors, strip, rail,
    railTitle: c('inPackage'),
    entries: [
      { href: '#kp-about', label: c('secAbout') }, { href: '#kp-entries', label: c('secEntries'), count: entries.length },
      { href: '#kp-sharing', label: c('secSharing') }, { href: '#kp-details', label: c('secDetails') },
    ],
    children: html`
      <${Section} id="kp-about" density="compact" title=${c('secAbout')} count="01">
        ${m.synthesis?.description ? html`<${Text} kind="lead">${m.synthesis.description}<//>` : html`<${Text} tone="muted">${c('noAbout')}<//>`}
      <//>
      <${Section} id="kp-entries" density="compact" title=${c('secEntries')} count=${entries.length}
        actions=${html`<${Action} onClick=${() => ctx.setAllEntries(entries, !allOpen)}>${allOpen ? c('closeAll') : c('openAll')}<//>`}>
        ${entries.length ? html`<div>${entries.map((e, i) => entryBlock(ctx, pkg, e, i, entries))}</div>` : html`<${Text} tone="muted">${c('noEntries')}<//>`}
      <//>
      <${Section} id="kp-sharing" density="compact" title=${c('secSharing')} count="03">
        ${toggle('catalog_listed', listed, c('kLibrary'), listed ? c('listedHint') : c('notListedHint'))}
        ${toggle('allow_clone', !!m.sharing?.allow_clone, c('kClone'), m.sharing?.allow_clone ? c('cloneOn') : c('cloneOff'))}
        <${KeyValue} label=${c('kFederation')} value=${html`<${CheckItem} done=${federated}
          onClick=${ctx.togglingFed === pkg.key ? undefined : () => ctx.toggleFederation(pkg)}>${federated ? c('fedOn') : c('fedOff')}<//>`} />
        ${ctx.organisms.length ? html`<${KeyValue} label=${c('kOrganism')} value=${html`<${Stack} direction="horizontal" align="end">
          <${Field} type="select" value=${ctx.shareOrg} onChange=${(e) => ctx.setShareOrg(e.target.value)}
            options=${[{ value: '', label: c('pickOrganism') }, ...ctx.organisms.map(o => ({ value: o.id || o.organismId, label: o.name || o.id }))]} />
          <${Action} disabled=${!ctx.shareOrg} onClick=${() => ctx.contributeToOrganism(pkg)}>${t('knowledge.organisms.contribute')}<//>
        <//>`} />` : null}
      <//>
      <${Fold} id="kp-details" number="04" title=${c('secDetails')} sub=${`${id}${m.author ? ` · ${m.author}` : ''}`} open=${ctx.detailsOpen} onToggle=${() => ctx.setDetailsOpen(v => !v)}>
        <div>
          <${KeyValue} label="ID" value=${id} mono=${true} />
          ${m.author ? html`<${KeyValue} label=${t('pkv.author')} value=${m.author} />` : null}
          ${m.synthesis?.model ? html`<${KeyValue} label=${c('kModel')} value=${m.synthesis.model} />` : null}
          ${m.sharing?.license ? html`<${KeyValue} label=${t('pkv.license')} value=${m.sharing.license} />` : null}
          ${m.created ? html`<${KeyValue} label=${t('pkv.created')} value=${day(m.created)} />` : null}
          ${m.updated ? html`<${KeyValue} label=${t('pkv.updated')} value=${day(m.updated)} />` : null}
          ${tags.length ? html`<${KeyValue} label=${c('kTags')} value=${tags.join(', ')} />` : null}
        </div>
      <//>`,
  });
}
