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
 * @structure renderPackage · entryRow · sourceRows · relationDoors
 * @usage import { renderPackage } from './package.js';
 * @version-history
 *   v1.17.0 -- 2026-09-26 -- On the component kit (page group G7): the page is the SettingsPage (via
 *     frame.js renderPage, marks and the rail as data), the strip the FigureStrip, the sections
 *     Section (the details a fold, as on main); an entry is a List row (the name opens it; the
 *     public/private Tab, the closed entry's counts and open/close in its doors; the text, the
 *     sources and the relations in its Panel); a source is a dense List row (verified in green,
 *     unchecked in coral, Tinted in the typewriter cell; the title a link that opens beside), a
 *     relation an Action; the sharing switches and the details are Facts (wide, flush; the organism
 *     picker a Select and its Action as the value's controls). main's dim tags come back (language,
 *     version, licence, tags, "+N", a private entry when it cannot be changed). No class is written here.
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
import { Section } from '/components/Section.js';
import { Switch } from '/components/Switch.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tinted } from '/components/Figure.js';
import { Facts } from '/components/Facts.js';
import { Select } from '/components/Select.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tab } from '/components/Tabs.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { List, Row, Name, Cell, Doors, Panel } from '/components/List.js';
import { c, day, rel, ctWord, maturityWord, synthWord, visWord, relWord, manifestOf, statsOf, pkgId, entryText, renderPage } from './frame.js';

const VIS_CYCLE = ['private', 'owner', 'group', 'public'];
const libraryUrl = (id) => '/v1/publicknowledgeviewer?id=' + encodeURIComponent(id);

/** An entry's sources: verified (green) or unchecked (coral), the title (a link that opens beside when it has an address), its type. */
function sourceRows(refs) {
  return html`<${List} cols="tag-name" keepCols dense>
    ${refs.map((r, j) => html`<${Row} key=${j}>
      <${Cell} meta><${Tinted} tone=${r.verified ? 'fine' : 'notice'}>${r.verified ? c('verified') : c('unverified')}<//><//>
      ${r.url ? html`<${Name} href=${r.url} newTab tag=${r.type || null}>${r.title || r.url} ↗<//>` : html`<${Name} tag=${r.type || null}>${r.title || c('untitled')}<//>`}
    <//>`)}
  <//>`;
}

/** An entry's relations: "relation: entry", each opening the entry it names and bringing it into view. */
function relationDoors(ctx, rels, allEntries) {
  const target = (k) => allEntries.find(e => e.key === k || String(e.key || '').endsWith('/' + k));
  return html`<${Actions}>${rels.map((r, j) => {
    const tg = target(r.key); const idx = tg ? allEntries.indexOf(tg) : -1;
    const go = () => { if (idx >= 0) { ctx.openEntry(allEntries[idx].key || String(idx)); document.getElementById('kp-e-' + idx)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
    return html`<${Action} key=${j} small soft onClick=${go}>${relWord(r.relation)}: ${tg ? (tg.title || r.key) : r.key}<//>`;
  })}<//>`;
}

/** One entry as a row of the entries list: its name opens it; its text, sources and relations stand in the opened panel. */
function entryRow(ctx, pkg, entry, i, allEntries) {
  const key = entry.key || String(i);
  const open = ctx.openEntries.has(key);
  const data = ctx.entryData[entry.key] ?? entry.value;
  const text = entryText(data);
  const vis = entry.visibility || 'private';
  const pub = vis === 'public';
  const next = VIS_CYCLE[(VIS_CYCLE.indexOf(vis) + 1) % VIS_CYCLE.length];
  const refs = entry.references || [];
  const rels = entry.related_entries || [];
  const label = entry.title || entry.key || c('entryN', { n: i + 1 });
  const toggle = () => ctx.toggleEntry(key);
  const flip = () => ctx.handleEntryVisibility(pkg, entry, next);
  const counts = [refs.length ? c('refsN', { n: refs.length }) : '', rels.length ? c('relsN', { n: rels.length }) : ''].filter(Boolean).join(' · ');
  return html`
    <${Row} key=${key} open=${open} id=${'kp-e-' + i}>
      <${Name} onOpen=${toggle}>${label}<//>
      <${Doors}>
        ${ctx.readOnly ? html`<${Mark} tone=${pub ? 'sun' : 'dim'}>${visWord(vis)}<//>`
          : html`<${Tab} tone="fold" on=${pub} pressed=${pub} title=${`${visWord(vis)} → ${visWord(next)}`} onClick=${flip}>${visWord(vis)} ▾<//>`}
        ${!open ? html`<${Note} inline>${counts}<//>` : null}
        <${Action} small soft onClick=${toggle}>${open ? c('close') : c('open')}<//>
      <//>
      ${open ? html`<${Panel} text=${text}>
        ${text ? null : ctx.loadingEntries ? html`<${Note} kind="loading">${t('common.loading')}<//>` : html`<${Note} kind="quiet">${c('noContent')}<//>`}
        ${refs.length ? sourceRows(refs) : null}
        ${rels.length ? relationDoors(ctx, rels, allEntries) : null}
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
  const saving = ctx.savingSharing === pkg.key;

  // The tags under the title; the ones that only describe (language, version, licence, the person's
  // own tags) are dim, as main drew them.
  const marks = [
    { label: maturityWord(m.maturity), tone: m.maturity === 'published' || m.maturity === 'stable' ? 'sun' : undefined },
    { label: ctWord(m.content_type || 'document') },
    { label: synthWord(m.synthesis?.level) },
    m.language ? { label: String(m.language).toLowerCase(), tone: 'dim' } : null,
    m.version ? { label: `v${m.version}`, tone: 'dim' } : null,
    m.sharing?.license ? { label: m.sharing.license, tone: 'dim' } : null,
    federated ? { label: t('knowledge.federated'), tone: 'coral' } : null,
    ...tags.slice(0, 4).map(tag => ({ label: tag, tone: 'dim' })),
    tags.length > 4 ? { label: `+${tags.length - 4}`, tone: 'dim' } : null,
  ];
  const exportIt = () => ctx.handleExport(pkg);
  const showInLibrary = () => window.open(libraryUrl(id), '_blank', 'noopener');
  const remove = () => ctx.handleDelete(pkg);
  const doors = html`
    <${Loud} onClick=${exportIt}>${t('knowledge.myKnowledge.export')}<//>
    ${listed ? html`<${Action} small onClick=${showInLibrary}>${c('showInLibrary')} ↗<//>` : null}
    <${Action} small tone="danger" disabled=${ctx.deleting === pkg.key} onClick=${remove}>${t('profile.delete')}<//>`;
  const strip = html`<${FigureStrip} items=${[
    { n: s.entries, label: c('stripEntries'), sub: c('stripEntriesSub', { n: s.publicN }) },
    { n: s.verified, of: '/' + s.refs, label: c('stripRefs'), sub: s.refs - s.verified ? c('stripRefsSub', { n: s.refs - s.verified }) : (s.refs ? c('stripRefsAll') : c('noRefs')) },
    { n: listed ? c('listedShort') : c('privateShort'), tone: 'coral', label: c('stripSharing'), sub: [m.sharing?.allow_clone ? c('clonable') : c('notClonable'), federated ? t('knowledge.federated') : ''].filter(Boolean).join(' · ') },
    { n: rel(m.updated || pkg.updated_at), label: c('stripUpdated'), sub: `${m.created ? c('createdOn', { d: day(m.created) }) : ''}${m.author ? ` · ${m.author}` : ''}` },
  ]} />`;
  const railGroups = [
    { label: c('inPackage'), items: [['01', 'kp-about', c('secAbout')], ['02', 'kp-entries', c('secEntries')], ['03', 'kp-sharing', c('secSharing')], ['04', 'kp-details', c('secDetails')]]
      .map(([n, sid, label]) => ({ key: sid, section: sid, mark: n, label, count: sid === 'kp-entries' ? entries.length : undefined })) },
    others.length ? { label: c('otherPackages'), items: others.map(p => ({ key: pkgId(p), mark: '→', label: manifestOf(p).name || c('untitled'), onClick: () => ctx.pickView({ kind: 'package', id: pkgId(p) }) })) } : null,
  ];
  const toggle = (field, on, label, hint) => ({ k: label, v: html`<${Switch} on=${on} label=${hint} disabled=${saving} onToggle=${() => ctx.handleSharingChange(pkg, field, !on)} />` });
  const contribute = () => ctx.contributeToOrganism(pkg);
  const sharing = [
    toggle('catalog_listed', listed, c('kLibrary'), listed ? c('listedHint') : c('notListedHint')),
    toggle('allow_clone', !!m.sharing?.allow_clone, c('kClone'), m.sharing?.allow_clone ? c('cloneOn') : c('cloneOff')),
    { k: c('kFederation'), v: html`<${Switch} on=${federated} label=${federated ? c('fedOn') : c('fedOff')} disabled=${ctx.togglingFed === pkg.key} onToggle=${() => ctx.toggleFederation(pkg)} />` },
    ctx.organisms.length ? { k: c('kOrganism'), controls: true, v: html`
      <${Select} ariaLabel=${c('kOrganism')} placeholder=${c('pickOrganism')} value=${ctx.shareOrg} onChange=${(v) => ctx.setShareOrg(v)}
        options=${ctx.organisms.map(o => ({ value: o.id || o.organismId, label: o.name || o.id }))} />
      <${Action} small disabled=${!ctx.shareOrg} onClick=${contribute}>${t('knowledge.organisms.contribute')}<//>` } : null,
  ];
  const details = [
    { k: 'ID', v: id, mono: true },
    m.author ? { k: t('pkv.author'), v: m.author } : null,
    m.synthesis?.model ? { k: c('kModel'), v: m.synthesis.model } : null,
    m.sharing?.license ? { k: t('pkv.license'), v: m.sharing.license } : null,
    m.created ? { k: t('pkv.created'), v: day(m.created) } : null,
    m.updated ? { k: t('pkv.updated'), v: day(m.updated) } : null,
    tags.length ? { k: c('kTags'), v: tags.join(', ') } : null,
  ];
  const openAll = () => ctx.setAllEntries(entries, !allOpen);

  return renderPage(ctx, {
    crumbs: [m.name || c('untitled')], title: m.name || c('untitled'), marks, doors, strip, railGroups,
    children: html`
      <${Section} id="kp-about" num="01" title=${c('secAbout')} first=${true}>
        ${m.synthesis?.description ? html`<${Note} kind="lead">${m.synthesis.description}<//>` : html`<${Note} kind="quiet">${c('noAbout')}<//>`}
      <//>
      <${Section} id="kp-entries" num="02" title=${c('secEntries')} count=${entries.length} doors=${html`<${Action} small soft onClick=${openAll}>${allOpen ? c('closeAll') : c('openAll')}<//>`}>
        <${List} cols="name-doors" keepCols empty=${c('noEntries')}>${entries.map((e, i) => entryRow(ctx, pkg, e, i, entries))}<//>
      <//>
      <${Section} id="kp-sharing" num="03" title=${c('secSharing')}>
        <${Facts} wide flush rows=${sharing} />
      <//>
      <${Section} fold id="kp-details" num="04" title=${c('secDetails')} sub=${`${id}${m.author ? ` · ${m.author}` : ''}`} open=${ctx.detailsOpen} onToggle=${() => ctx.setDetailsOpen(v => !v)}>
        <${Facts} wide flush rows=${details} />
      <//>`,
  });
}
