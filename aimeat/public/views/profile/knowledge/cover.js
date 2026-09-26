/**
 * @file public/views/profile/knowledge/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Knowledge page in the poster face (design canvas "AIMEAT Tietopankin sivu",
 *   direction A). The COVER answers in the order a person asks: what I have (packages as a table,
 *   drafts, published and datasets apart), how I make a new one (three roads: an agent over MCP, a
 *   chat with a prompt and the result pasted back, a finished package pasted in), what the organisms
 *   share, and what in the public library is worth taking. A package opens as its own page
 *   (package.js). Pure render functions over the ctx bag knowledge-tab.js assembles.
 * @structure renderKnowledgeView · renderCover · secPackages · secMake · importPreview · secOrganisms · secLibrary
 * @usage import { renderKnowledgeView } from './knowledge/cover.js';
 * @version-history
 *   v1.19.0 -- 2026-09-26 -- On the component kit (page group G7): the page is the SettingsPage (crumb,
 *     marks, the rail and its sibling pages as data), the strip the FigureStrip; the sections are
 *     Section; the packages table, the organisms' packages and the library are the List (its head,
 *     Group headings with their tally for the drafts, published and datasets; the loading and empty
 *     lines are the List's); the sort is Tabs in the fold tone; the three roads are Roads/Road
 *     (chosen on the sun, the door chooses); the paste field is the TextArea, its refusal the Note
 *     message; a pasted package's preview is the Box (its name and tags in the head, import and
 *     discard at its foot) with its entries as a List and "List in the catalogue" as the Check.
 *     main's dim tags come back (drafts, the synthesis and the count of a pasted package, a private
 *     entry in it), and a different author in the preview says so in coral again. No class is written here.
 *   v1.18.0 -- 2026-09-26 -- The packages table with its groups, the organisms' packages, the library's packages and a pasted package's entries are the Listing (listing, listing-row and its head row, name, words and doors cells, the line under a name; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.17.0 -- 2026-09-26 -- The line under a package's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.16.0 -- 2026-09-26 -- "List in the catalogue" is the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-26 -- The figure's "of how many" is the Figure strip's own cut (.og-strip-of), moved unchanged from .kp-of (a move).
 *   v1.13.0 -- 2026-09-26 -- A pasted package's reference and relation lines are the Package preview's own small lines; the typewriter that restyled them goes (a unification).
 *   v1.12.0 -- 2026-09-25 -- A road or an option you choose is the Choice tile (.poster-choice), a unification: the look most tabs use.
 *   v1.11.0 -- 2026-09-25 -- The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.10.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.8.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the action bar, the always-open import box and the wall
 *     of expandable cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section } from '/components/Section.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { scrollToSection, openTab } from '/components/Rail.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tinted } from '/components/Figure.js';
import { Box } from '/components/Box.js';
import { Roads, Road } from '/components/Roads.js';
import { Tabs } from '/components/Tabs.js';
import { TextArea } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { List, Row, Name, Desc, Cell, Doors, Group } from '/components/List.js';
import { Hint } from '/components/Hint.js';
import { c, num, rel, ctWord, synthWord, visWord, relWord, manifestOf, statsOf, groupOf, GROUP_ORDER, pkgId, authorName, crumb, packageHead, packageRow, pageLinks } from './frame.js';
import { renderPackage } from './package.js';

/** The public library, in a new window. */
const openLibraryPage = () => window.open('/v1/publicknowledgeviewer', '_blank', 'noopener');
const libraryUrl = (id) => '/v1/publicknowledgeviewer?id=' + encodeURIComponent(id);

export function renderKnowledgeView(ctx) {
  const v = ctx.view;
  if (v.kind === 'package') {
    const pkg = ctx.packages.find(p => pkgId(p) === v.id);
    if (pkg) return renderPackage(ctx, pkg);
  }
  return renderCover(ctx);
}

function renderCover(ctx) {
  const pkgs = ctx.packages;
  const totals = pkgs.reduce((a, p) => { const s = statsOf(manifestOf(p)); a.entries += s.entries; a.refs += s.refs; a.verified += s.verified; return a; }, { entries: 0, refs: 0, verified: 0 });
  const listed = pkgs.filter(p => manifestOf(p).sharing?.catalog_listed).length;
  const clonable = pkgs.filter(p => manifestOf(p).sharing?.allow_clone).length;
  const federated = pkgs.filter(p => ctx.fedConsents[pkgId(p)]).length;
  const drafts = pkgs.filter(p => groupOf(manifestOf(p)) === 'draft').length;
  const datasets = pkgs.filter(p => groupOf(manifestOf(p)) === 'dataset').length;
  const latest = [...pkgs].sort((a, b) => new Date(manifestOf(b).updated || b.updated_at || 0).getTime() - new Date(manifestOf(a).updated || a.updated_at || 0).getTime())[0];
  const chip = (n, key, tone) => ({ label: c(key, { n }), tone });
  // Drafts are dim (they count nothing yet), datasets coral, as main drew them.
  const marks = [
    chip(pkgs.length, 'chipPackages'), chip(totals.entries, 'chipEntries'), chip(listed, 'chipListed'), chip(clonable, 'chipClonable'),
    federated ? chip(federated, 'chipFederated') : null, drafts ? chip(drafts, 'chipDrafts', 'dim') : null, datasets ? chip(datasets, 'chipDatasets', 'coral') : null,
  ];
  const strip = html`<${FigureStrip} items=${[
    latest ? { n: rel(manifestOf(latest).updated || latest.updated_at), label: c('stripLatest'), sub: manifestOf(latest).name || '' } : { n: '·', label: c('stripLatest'), sub: c('noneYet') },
    { n: listed, of: '/' + pkgs.length, label: c('stripListed'), sub: c('stripListedSub') },
    { n: totals.verified, of: '/' + totals.refs, label: c('stripRefs'), sub: totals.refs - totals.verified ? c('stripRefsSub', { n: totals.refs - totals.verified }) : c('stripRefsAll') },
    { n: federated, tone: federated ? 'coral' : undefined, label: c('stripFederated'), sub: c('stripFederatedSub') },
  ]} />`;
  const toMake = () => scrollToSection('kp-make');
  const actions = html`
    <${Loud} onClick=${toMake}>${c('make')}<//>
    <${Actions}><${Action} small onClick=${openLibraryPage}>${c('library')} ↗<//><//>`;
  const sections = [
    { id: 'kp-packages', num: '01', label: c('secPackages'), count: pkgs.length },
    { id: 'kp-make', num: '02', label: c('make'), count: '' },
    { id: 'kp-orgs', num: '03', label: c('secOrganisms'), count: ctx.organismPackages.length },
    { id: 'kp-library', num: '04', label: c('secLibrary'), count: ctx.discovered.length },
  ];
  return html`
    <${SettingsPage} name="kp" crumb=${crumb(ctx, [])} title=${t('knowledge.tabLabel')} marks=${marks} desc=${c('desc')}
      actions=${actions} strip=${strip} railTitle=${c('railTitle')} sections=${sections} pagesLabel=${c('pages')} pages=${pageLinks()}>
      ${secPackages(ctx)}
      ${secMake(ctx)}
      ${secOrganisms(ctx)}
      ${secLibrary(ctx)}
    <//>`;
}

/* ── 01 My packages ────────────────────────────────────────────────────────────────────────── */
function secPackages(ctx) {
  const pkgs = ctx.packages;
  const byUpdated = (a, b) => new Date(manifestOf(b).updated || b.updated_at || 0).getTime() - new Date(manifestOf(a).updated || a.updated_at || 0).getTime();
  const byName = (a, b) => String(manifestOf(a).name || '').localeCompare(String(manifestOf(b).name || ''));
  const doors = html`<${Tabs} tone="fold" label=${c('secPackages')} value=${ctx.sort} onSelect=${(v) => ctx.setSort(v)}
    items=${[{ value: 'state', label: c('byState') }, { value: 'name', label: c('byName') }, { value: 'newest', label: c('byNewest') }]} />`;
  let body;
  if (ctx.sort === 'state') {
    const groups = GROUP_ORDER.map(g => ({ g, list: pkgs.filter(p => groupOf(manifestOf(p)) === g).sort(byUpdated) })).filter(x => x.list.length);
    body = groups.map(({ g, list }) => html`<${Group} key=${g} title=${c('group.' + g)} count=${list.length}>${list.map(pkg => packageRow(ctx, pkg))}<//>`);
  } else {
    body = [...pkgs].sort(ctx.sort === 'name' ? byName : byUpdated).map(pkg => packageRow(ctx, pkg));
  }
  return html`<${Section} id="kp-packages" num="01" title=${c('secPackages')} count=${pkgs.length} doors=${doors} first=${true}>
    <${List} cols="name-count-words-when-doors" keepCols head=${packageHead()} loading=${ctx.loading && t('common.loading')} empty=${c('nonePackages')}>${body}<//>
  <//>`;
}

/* ── 02 Make a package: three roads ────────────────────────────────────────────────────────── */
function secMake(ctx) {
  // A road is chosen by its door (no onPick): the tile keeps the plain pointer.
  const road = (id, title, step, body, doorLabel, onClick) => html`
    <${Road} key=${id} chosen=${ctx.road === id} name=${title} sub=${step} text=${body}
      doors=${html`<${Action} small onClick=${onClick}>${doorLabel}<//>`} />`;
  const paste = (v) => ctx.handleImportPaste(v);
  return html`<${Section} id="kp-make" num="02" title=${c('make')} count=${c('makeSub')}>
    <${Roads} cols="three">
      ${road('mcp', c('roadMcp'), c('roadMcpStep'), c('roadMcpBody'), c('roadMcpDoor'), () => { ctx.setRoad('mcp'); ctx.copyPrompt('mcp'); })}
      ${road('chat', c('roadChat'), c('roadChatStep'), c('roadChatBody'), c('roadChatDoor'), () => { ctx.setRoad('chat'); ctx.copyPrompt('human'); })}
      ${road('paste', c('roadPaste'), c('roadPasteStep'), c('roadPasteBody'), c('roadPasteDoor'), () => { ctx.setRoad('paste'); ctx.setPasteOpen(true); })}
    <//>
    ${ctx.road === 'chat' || ctx.road === 'paste' || ctx.pasteOpen || ctx.importText ? html`
      <${TextArea} rows=${4} ariaLabel=${c('roadPaste')} placeholder=${t('knowledge.import.placeholder')} value=${ctx.importText} onInput=${paste} />
      ${ctx.importError ? html`<${Note} kind="message" error>${ctx.importError}<//>` : null}
      ${ctx.importPreview ? importPreview(ctx) : html`<${Hint}>${c('pasteHint', { ghii: ctx.ghii })}<//>`}` : null}
  <//>`;
}

function importPreview(ctx) {
  const p = ctx.importPreview;
  const pkg = p.pkg;
  const entries = pkg.entries || [];
  const ghiiLine = p.ghiiMatch ? t('knowledge.import.ghiiConfirm').replace('{ghii}', ctx.ghii) : t('knowledge.import.ghiiMismatch').replace('{ghii}', p.targetGhii);
  const discard = () => ctx.handleImportPaste('');
  const marks = html`<${Mark}>${ctWord(pkg.content_type || 'document')}<//><${Mark} tone="dim">${synthWord(pkg.synthesis?.level)}<//><${Mark} tone="dim">${c('entriesN', { n: entries.length })}<//>`;
  const doors = html`
    <${Loud} control disabled=${ctx.importing} onClick=${ctx.confirmImport}>${ctx.importing ? '…' : c('importN', { n: entries.length })}<//>
    <${Action} small soft onClick=${discard}>${c('discard')}<//>`;
  return html`
    <${Box} name=${pkg.name || pkg.title || pkg.id || c('untitled')} marks=${marks} doors=${doors}>
      <${Note}>${p.ghiiMatch ? ghiiLine : html`<${Tinted} tone="notice">${ghiiLine}<//>`}<//>
      <${List} cols="tag-name" keepCols apart>
        ${entries.map((e, i) => {
          const data = p.raw?.entry_data?.[e.key] || e.value;
          const val = typeof data === 'string' ? data : (data?.body || data?.summary || data?.description || '');
          const refs = e.references || [];
          const lines = [
            val ? (val.length > 140 ? val.slice(0, 140) + '…' : val) : null,
            refs.length ? c('refsVerified', { v: refs.filter(r => r.verified).length, n: refs.length }) : null,
            (e.related_entries || []).length ? e.related_entries.map(r => `${relWord(r.relation)} ${r.key}`).join(' · ') : null,
          ].filter(Boolean);
          return html`
            <${Row} key=${i}>
              <${Cell}><${Mark} tone=${e.visibility === 'public' ? 'sun' : 'dim'}>${visWord(e.visibility)}<//><//>
              <${Name} meta=${lines.length ? lines.map((l, j) => html`${j ? html`<br />` : null}${l}`) : null}>${e.title || e.key || c('entryN', { n: i + 1 })}<//>
            <//>`;
        })}
      <//>
      <${Check} checked=${p.catalogListed} onChange=${(on) => ctx.setImportPreview({ ...p, catalogListed: on })}>${t('knowledge.import.catalogToggle')}<//>
    <//>`;
}

/* ── 03 The organisms' packages ────────────────────────────────────────────────────────────── */
function secOrganisms(ctx) {
  const list = ctx.organismPackages;
  const toOrganisms = () => openTab('organisms');
  return html`<${Section} id="kp-orgs" num="03" title=${c('secOrganisms')} count=${c('secOrganismsSub', { n: new Set(list.map(p => p.organismName)).size })} doors=${html`<${Action} small soft onClick=${toOrganisms}>${t('profile.tabs.organisms')}<//>`}>
    <${List} cols="name-count-when" keepCols loading=${ctx.organismLoading && t('common.loading')} empty=${t('knowledge.organisms.empty')}>
      ${list.map((p, i) => html`
        <${Row} key=${i}>
          <${Name} meta=${p.organismName || ''}>${p.manifest?.name || c('untitled')}<//>
          <${Desc}>${p.manifest?.entries?.length ? html`<b>${p.manifest.entries.length}</b> ${c('entriesWord', { n: p.manifest.entries.length })}` : ''}<//>
          <${Desc}>${p.contributed_at ? c('contributedOn', { d: rel(p.contributed_at) }) : ''}<//>
        <//>`)}
    <//>
    <${Hint}>${c('sharedNote')}<//>
  <//>`;
}

/* ── 04 From the public library ────────────────────────────────────────────────────────────── */
function secLibrary(ctx) {
  const mine = new Set(ctx.packages.map(p => pkgId(p)));
  const list = ctx.discovered.filter(p => !mine.has(p.package_id) && authorName(p.author) !== authorName(ctx.ghii));
  const clonable = list.filter(p => p.sharing?.allow_clone !== false);
  return html`<${Section} id="kp-library" num="04" title=${c('secLibrary')} count=${c('secLibrarySub', { n: ctx.discovered.length, k: clonable.length })} doors=${html`<${Action} small onClick=${openLibraryPage}>${c('openLibrary')} ↗<//>`}>
    <${List} cols="name-kind-count-state-doors" keepCols loading=${ctx.discoverLoading && t('common.loading')} empty=${c('noneLibrary')}>
      ${list.slice(0, 8).map(p => {
        const cl = p.sharing?.allow_clone !== false;
        const clone = () => ctx.handleClone(p.package_id);
        const open = () => window.open(libraryUrl(p.package_id), '_blank', 'noopener');
        return html`
          <${Row} key=${p.package_id}>
            <${Name} href=${libraryUrl(p.package_id)} newTab meta=${p.synthesis?.description || null}>${p.name || c('untitled')}<//>
            <${Desc}>${[ctWord(p.content_type), p.maturity ? t('knowledge.maturity.' + p.maturity) : '', p.language].filter(Boolean).join(' · ')}<br /><b>${authorName(p.author)}</b><//>
            <${Desc}>${c('entriesN', { n: p.entries_count || 0 })}${p.references_count ? html`<br />${c('refsVerified', { v: p.verified_references || 0, n: p.references_count })}` : null}<//>
            <${Desc}>${cl ? html`<b>${c('clonable')}</b>` : c('readOnly')}<//>
            <${Doors}>${cl ? html`<${Action} small row onClick=${clone}>${c('clone')}<//>` : html`<${Action} small row onClick=${open}>${c('open')}<//>`}<//>
          <//>`;
      })}
    <//>
    <${Hint}>${c('libraryHint')} ${t('knowledge.discover.trustAdvisory')}<//>
  <//>`;
}

export { num };
