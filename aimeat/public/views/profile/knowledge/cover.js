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
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, num, rel, ctWord, synthWord, visWord, relWord, manifestOf, statsOf, groupOf, GROUP_ORDER, pkgId, authorName, crumb, packageRows, pageLinks } from './frame.js';
import { renderPackage } from './package.js';
import { Hint } from '/components/Hint.js';

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
  const chip = (n, key, cls = '') => html`<span class=${`poster-chip ${cls}`}>${c(key, { n })}</span>`;
  const strip = html`
    <div class="og-strip">
      <div>${latest ? html`<b>${rel(manifestOf(latest).updated || latest.updated_at)}</b><span>${c('stripLatest')}</span><small>${manifestOf(latest).name}</small>` : html`<b>·</b><span>${c('stripLatest')}</span><small>${c('noneYet')}</small>`}</div>
      <div><b>${listed}<span class="og-strip-of">/${pkgs.length}</span></b><span>${c('stripListed')}</span><small>${c('stripListedSub')}</small></div>
      <div><b>${totals.verified}<span class="og-strip-of">/${totals.refs}</span></b><span>${c('stripRefs')}</span><small>${totals.refs - totals.verified ? c('stripRefsSub', { n: totals.refs - totals.verified }) : c('stripRefsAll')}</small></div>
      <div><b class=${federated ? 'og-strip-coral' : ''}>${federated}</b><span>${c('stripFederated')}</span><small>${c('stripFederatedSub')}</small></div>
    </div>`;
  return html`
    <div class="og og-kp">
      ${crumb(ctx, [])}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('knowledge.tabLabel')}</h1>
          <div class="poster-chips">
            ${chip(pkgs.length, 'chipPackages')}${chip(totals.entries, 'chipEntries')}${chip(listed, 'chipListed')}${chip(clonable, 'chipClonable')}
            ${federated ? chip(federated, 'chipFederated') : null}${drafts ? chip(drafts, 'chipDrafts') : null}${datasets ? chip(datasets, 'chipDatasets', 'poster-chip--coral') : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="poster-slab" onClick=${() => scrollTo('kp-make')}>${c('make')}</button>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => window.open('/v1/publicknowledgeviewer', '_blank', 'noopener')}>${c('library')} ↗</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secPackages(ctx)}
          ${secMake(ctx)}
          ${secOrganisms(ctx)}
          ${secLibrary(ctx)}
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'kp-packages', c('secPackages'), pkgs.length], ['02', 'kp-make', c('make'), ''], ['03', 'kp-orgs', c('secOrganisms'), ctx.organismPackages.length], ['04', 'kp-library', c('secLibrary'), ctx.discovered.length]]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
    </div>`;
}

/* ── 01 My packages ────────────────────────────────────────────────────────────────────────── */
function secPackages(ctx) {
  const pkgs = ctx.packages;
  const byUpdated = (a, b) => new Date(manifestOf(b).updated || b.updated_at || 0).getTime() - new Date(manifestOf(a).updated || a.updated_at || 0).getTime();
  const byName = (a, b) => String(manifestOf(a).name || '').localeCompare(String(manifestOf(b).name || ''));
  const sortDoor = (id, label) => html`<button type="button" class=${`poster-tab poster-tab--fold ${ctx.sort === id ? 'is-on' : ''}`} onClick=${() => ctx.setSort(id)}>${label}</button>`;
  const doors = html`${sortDoor('state', c('byState'))}${sortDoor('name', c('byName'))}${sortDoor('newest', c('byNewest'))}`;
  let body;
  if (ctx.loading) body = html`<p class="poster-quiet loading-mark">${t('common.loading')}</p>`;
  else if (!pkgs.length) body = html`<p class="poster-quiet">${c('nonePackages')}</p>`;
  else if (ctx.sort === 'state') {
    const groups = GROUP_ORDER.map(g => ({ g, list: pkgs.filter(p => groupOf(manifestOf(p)) === g).sort(byUpdated) })).filter(x => x.list.length);
    body = groups.map(({ g, list }, i) => html`<div key=${g}>${packageRows(ctx, list, { head: i === 0, label: html`<div class="kp-lbl poster-day-title">${c('group.' + g)}<em>${list.length}</em></div>` })}</div>`);
  } else {
    body = packageRows(ctx, [...pkgs].sort(ctx.sort === 'name' ? byName : byUpdated), { head: true });
  }
  return html`<${PageSection} id="kp-packages" num="01" title=${c('secPackages')} count=${pkgs.length} doors=${doors} first=${true}>${body}<//>`;
}

/* ── 02 Make a package: three roads ────────────────────────────────────────────────────────── */
function secMake(ctx) {
  const road = (id, title, step, body, doorLabel, onClick) => html`
    <div class=${`poster-choice kp-road ${ctx.road === id ? 'on' : ''}`} key=${id}>
      <b>${title}</b><span class="kp-step">${step}</span><p>${body}</p>
      <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${onClick}>${doorLabel}</button></div>
    </div>`;
  return html`<${PageSection} id="kp-make" num="02" title=${c('make')} count=${c('makeSub')}>
    <div class="kp-roads">
      ${road('mcp', c('roadMcp'), c('roadMcpStep'), c('roadMcpBody'), c('roadMcpDoor'), () => { ctx.setRoad('mcp'); ctx.copyPrompt('mcp'); })}
      ${road('chat', c('roadChat'), c('roadChatStep'), c('roadChatBody'), c('roadChatDoor'), () => { ctx.setRoad('chat'); ctx.copyPrompt('human'); })}
      ${road('paste', c('roadPaste'), c('roadPasteStep'), c('roadPasteBody'), c('roadPasteDoor'), () => { ctx.setRoad('paste'); ctx.setPasteOpen(true); })}
    </div>
    ${ctx.road === 'chat' || ctx.road === 'paste' || ctx.pasteOpen || ctx.importText ? html`
      <textarea class="og-textarea kp-paste" rows="4" placeholder=${t('knowledge.import.placeholder')} value=${ctx.importText} onInput=${(e) => ctx.handleImportPaste(e.target.value)}></textarea>
      ${ctx.importError ? html`<p class="form-message form-message--error">${ctx.importError}</p>` : null}
      ${ctx.importPreview ? importPreview(ctx) : html`<${Hint}>${c('pasteHint', { ghii: ctx.ghii })}<//>`}` : null}
  <//>`;
}

function importPreview(ctx) {
  const p = ctx.importPreview;
  const pkg = p.pkg;
  const entries = pkg.entries || [];
  return html`
    <div class="kp-preview poster-box">
      <div class="kp-preview-h">
        <b>${pkg.name || pkg.title || pkg.id || c('untitled')}</b>
        <span class="poster-chip">${ctWord(pkg.content_type || 'document')}</span>
        <span class="poster-chip">${synthWord(pkg.synthesis?.level)}</span>
        <span class="poster-chip">${c('entriesN', { n: entries.length })}</span>
      </div>
      <p class=${`poster-hint ${p.ghiiMatch ? '' : 'kp-warn'}`}>${p.ghiiMatch ? t('knowledge.import.ghiiConfirm').replace('{ghii}', ctx.ghii) : t('knowledge.import.ghiiMismatch').replace('{ghii}', p.targetGhii)}</p>
      <div class="listing listing--cols listing--tag-name kp-preview-entries">
        ${entries.map((e, i) => { const data = p.raw?.entry_data?.[e.key] || e.value; const val = typeof data === 'string' ? data : (data?.body || data?.summary || data?.description || ''); return html`
          <div class="listing-row" key=${i}>
            <div><span class=${`poster-chip ${e.visibility === 'public' ? 'poster-chip--sun' : ''}`}>${visWord(e.visibility)}</span></div>
            <div class="listing-name">${e.title || e.key || c('entryN', { n: i + 1 })}
              ${val ? html`<small class="listing-meta">${val.length > 140 ? val.slice(0, 140) + '…' : val}</small>` : null}
              ${(e.references || []).length ? html`<small class="listing-meta">${c('refsVerified', { v: (e.references || []).filter(r => r.verified).length, n: e.references.length })}</small>` : null}
              ${(e.related_entries || []).length ? html`<small class="listing-meta">${e.related_entries.map(r => `${relWord(r.relation)} ${r.key}`).join(' · ')}</small>` : null}
            </div>
          </div>`; })}
      </div>
      <label class="kp-check check-line"><input type="checkbox" checked=${p.catalogListed} onChange=${(e) => ctx.setImportPreview({ ...p, catalogListed: e.target.checked })} />${t('knowledge.import.catalogToggle')}</label>
      <div class="kp-preview-actions">
        <button type="button" class="poster-slab poster-slab--control" disabled=${ctx.importing} onClick=${ctx.confirmImport}>${ctx.importing ? '…' : c('importN', { n: entries.length })}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.handleImportPaste('')}>${c('discard')}</button>
      </div>
    </div>`;
}

/* ── 03 The organisms' packages ────────────────────────────────────────────────────────────── */
function secOrganisms(ctx) {
  const list = ctx.organismPackages;
  return html`<${PageSection} id="kp-orgs" num="03" title=${c('secOrganisms')} count=${c('secOrganismsSub', { n: new Set(list.map(p => p.organismName)).size })} doors=${html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }))}>${t('profile.tabs.organisms')}</button>`}>
    ${ctx.organismLoading ? html`<p class="poster-quiet loading-mark">${t('common.loading')}</p>` : !list.length ? html`<p class="poster-quiet">${t('knowledge.organisms.empty')}</p>` : html`
      <div class="listing listing--cols listing--name-count-when">
        ${list.map((p, i) => html`
          <div class="listing-row" key=${i}>
            <div class="listing-name">${p.manifest?.name || c('untitled')}<small class="listing-meta">${p.organismName || ''}</small></div>
            <div class="listing-desc">${p.manifest?.entries?.length ? html`<b>${p.manifest.entries.length}</b> ${c('entriesWord', { n: p.manifest.entries.length })}` : ''}</div>
            <div class="listing-desc">${p.contributed_at ? c('contributedOn', { d: rel(p.contributed_at) }) : ''}</div>
          </div>`)}
      </div>`}
    <${Hint}>${c('sharedNote')}<//>
  <//>`;
}

/* ── 04 From the public library ────────────────────────────────────────────────────────────── */
function secLibrary(ctx) {
  const mine = new Set(ctx.packages.map(p => pkgId(p)));
  const list = ctx.discovered.filter(p => !mine.has(p.package_id) && authorName(p.author) !== authorName(ctx.ghii));
  const clonable = list.filter(p => p.sharing?.allow_clone !== false);
  return html`<${PageSection} id="kp-library" num="04" title=${c('secLibrary')} count=${c('secLibrarySub', { n: ctx.discovered.length, k: clonable.length })} doors=${html`<button type="button" class="poster-action poster-action--small" onClick=${() => window.open('/v1/publicknowledgeviewer', '_blank', 'noopener')}>${c('openLibrary')} ↗</button>`}>
    ${ctx.discoverLoading ? html`<p class="poster-quiet loading-mark">${t('common.loading')}</p>` : !list.length ? html`<p class="poster-quiet">${c('noneLibrary')}</p>` : html`
      <div class="listing listing--cols listing--name-kind-count-state-doors">
        ${list.slice(0, 8).map(p => { const cl = p.sharing?.allow_clone !== false; return html`
          <div class="listing-row" key=${p.package_id}>
            <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => window.open('/v1/publicknowledgeviewer?id=' + encodeURIComponent(p.package_id), '_blank', 'noopener')}>${p.name || c('untitled')}</button>${p.synthesis?.description ? html`<small class="listing-meta">${p.synthesis.description}</small>` : null}</div>
          <div class="listing-desc">${[ctWord(p.content_type), p.maturity ? t('knowledge.maturity.' + p.maturity) : '', p.language].filter(Boolean).join(' · ')}<br /><b>${authorName(p.author)}</b></div>
          <div class="listing-desc">${c('entriesN', { n: p.entries_count || 0 })}${p.references_count ? html`<br />${c('refsVerified', { v: p.verified_references || 0, n: p.references_count })}` : null}</div>
          <div class="listing-desc">${cl ? html`<b>${c('clonable')}</b>` : c('readOnly')}</div>
          <div class="listing-doors">${cl ? html`<button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.handleClone(p.package_id)}>${c('clone')}</button>` : html`<button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => window.open('/v1/publicknowledgeviewer?id=' + encodeURIComponent(p.package_id), '_blank', 'noopener')}>${c('open')}</button>`}</div>
          </div>`; })}
      </div>`}
    <${Hint}>${c('libraryHint')} ${t('knowledge.discover.trustAdvisory')}<//>
  <//>`;
}

export { num };
