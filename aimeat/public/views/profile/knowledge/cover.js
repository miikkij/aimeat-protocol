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
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the action bar, the always-open import box and the wall
 *     of expandable cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, num, rel, ctWord, synthWord, visWord, relWord, manifestOf, statsOf, groupOf, GROUP_ORDER, pkgId, authorName, crumb, packageRows, rowsHead, pageLinks } from './frame.js';
import { renderPackage } from './package.js';

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
  const chip = (n, key, cls = '') => html`<span class=${`og-chip ${cls}`}>${c(key, { n })}</span>`;
  const strip = html`
    <div class="og-strip">
      <div>${latest ? html`<b>${rel(manifestOf(latest).updated || latest.updated_at)}</b><span>${c('stripLatest')}</span><small>${manifestOf(latest).name}</small>` : html`<b>·</b><span>${c('stripLatest')}</span><small>${c('noneYet')}</small>`}</div>
      <div><b>${listed}<span class="kp-of">/${pkgs.length}</span></b><span>${c('stripListed')}</span><small>${c('stripListedSub')}</small></div>
      <div><b>${totals.verified}<span class="kp-of">/${totals.refs}</span></b><span>${c('stripRefs')}</span><small>${totals.refs - totals.verified ? c('stripRefsSub', { n: totals.refs - totals.verified }) : c('stripRefsAll')}</small></div>
      <div><b class=${federated ? 'og-strip-coral' : ''}>${federated}</b><span>${c('stripFederated')}</span><small>${c('stripFederatedSub')}</small></div>
    </div>`;
  return html`
    <div class="og og-kp">
      ${crumb(ctx, [])}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${t('knowledge.tabLabel')}</h1>
          <div class="og-chips">
            ${chip(pkgs.length, 'chipPackages')}${chip(totals.entries, 'chipEntries')}${chip(listed, 'chipListed')}${chip(clonable, 'chipClonable')}
            ${federated ? chip(federated, 'chipFederated') : null}${drafts ? chip(drafts, 'chipDrafts', 'og-chip--dim') : null}${datasets ? chip(datasets, 'chipDatasets', 'og-chip--coral') : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" onClick=${() => scrollTo('kp-make')}>${c('make')}</button>
          <div class="og-doors"><button type="button" class="og-door" onClick=${() => window.open('/v1/publicknowledgeviewer', '_blank', 'noopener')}>${c('library')} ↗</button></div>
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
  const sortDoor = (id, label) => html`<button type="button" class=${`og-door og-door--quiet ${ctx.sort === id ? 'on' : ''}`} onClick=${() => ctx.setSort(id)}>${label}</button>`;
  const doors = html`${sortDoor('state', c('byState'))}${sortDoor('name', c('byName'))}${sortDoor('newest', c('byNewest'))}`;
  let body;
  if (ctx.loading) body = html`<p class="og-empty kp-loading">${t('common.loading')}</p>`;
  else if (!pkgs.length) body = html`<p class="og-empty">${c('nonePackages')}</p>`;
  else if (ctx.sort === 'state') {
    const groups = GROUP_ORDER.map(g => ({ g, list: pkgs.filter(p => groupOf(manifestOf(p)) === g).sort(byUpdated) })).filter(x => x.list.length);
    body = html`${rowsHead()}${groups.map(({ g, list }) => html`<div class="kp-group" key=${g}><div class="kp-lbl">${c('group.' + g)}<em>${list.length}</em></div>${packageRows(ctx, list)}</div>`)}`;
  } else {
    body = html`${rowsHead()}${packageRows(ctx, [...pkgs].sort(ctx.sort === 'name' ? byName : byUpdated))}`;
  }
  return html`<${Section} id="kp-packages" num="01" title=${c('secPackages')} count=${pkgs.length} doors=${doors} first=${true}>${body}<//>`;
}

/* ── 02 Make a package: three roads ────────────────────────────────────────────────────────── */
function secMake(ctx) {
  const road = (id, title, step, body, doorLabel, onClick) => html`
    <div class=${`kp-road ${ctx.road === id ? 'on' : ''}`} key=${id}>
      <b>${title}</b><span class="kp-step">${step}</span><p>${body}</p>
      <div class="og-doors"><button type="button" class="og-door" onClick=${onClick}>${doorLabel}</button></div>
    </div>`;
  return html`<${Section} id="kp-make" num="02" title=${c('make')} count=${c('makeSub')}>
    <div class="kp-roads">
      ${road('mcp', c('roadMcp'), c('roadMcpStep'), c('roadMcpBody'), c('roadMcpDoor'), () => { ctx.setRoad('mcp'); ctx.copyPrompt('mcp'); })}
      ${road('chat', c('roadChat'), c('roadChatStep'), c('roadChatBody'), c('roadChatDoor'), () => { ctx.setRoad('chat'); ctx.copyPrompt('human'); })}
      ${road('paste', c('roadPaste'), c('roadPasteStep'), c('roadPasteBody'), c('roadPasteDoor'), () => { ctx.setRoad('paste'); ctx.setPasteOpen(true); })}
    </div>
    ${ctx.road === 'chat' || ctx.road === 'paste' || ctx.pasteOpen || ctx.importText ? html`
      <textarea class="kp-paste" rows="4" placeholder=${t('knowledge.import.placeholder')} value=${ctx.importText} onInput=${(e) => ctx.handleImportPaste(e.target.value)}></textarea>
      ${ctx.importError ? html`<p class="kp-error">${ctx.importError}</p>` : null}
      ${ctx.importPreview ? importPreview(ctx) : html`<p class="kp-hint">${c('pasteHint', { ghii: ctx.ghii })}</p>`}` : null}
  <//>`;
}

function importPreview(ctx) {
  const p = ctx.importPreview;
  const pkg = p.pkg;
  const entries = pkg.entries || [];
  return html`
    <div class="kp-preview">
      <div class="kp-preview-h">
        <b>${pkg.name || pkg.title || pkg.id || c('untitled')}</b>
        <span class="og-chip">${ctWord(pkg.content_type || 'document')}</span>
        <span class="og-chip og-chip--dim">${synthWord(pkg.synthesis?.level)}</span>
        <span class="og-chip og-chip--dim">${c('entriesN', { n: entries.length })}</span>
      </div>
      <p class=${`kp-hint ${p.ghiiMatch ? '' : 'kp-warn'}`}>${p.ghiiMatch ? t('knowledge.import.ghiiConfirm').replace('{ghii}', ctx.ghii) : t('knowledge.import.ghiiMismatch').replace('{ghii}', p.targetGhii)}</p>
      <div class="kp-preview-entries">
        ${entries.map((e, i) => { const data = p.raw?.entry_data?.[e.key] || e.value; const val = typeof data === 'string' ? data : (data?.body || data?.summary || data?.description || ''); return html`
          <div class="kp-preview-entry" key=${i}>
            <span class=${`og-chip ${e.visibility === 'public' ? 'og-chip--sun' : 'og-chip--dim'}`}>${visWord(e.visibility)}</span>
            <b>${e.title || e.key || c('entryN', { n: i + 1 })}</b>
            ${val ? html`<small>${val.length > 140 ? val.slice(0, 140) + '…' : val}</small>` : null}
            ${(e.references || []).length ? html`<small class="kp-mono">${c('refsVerified', { v: (e.references || []).filter(r => r.verified).length, n: e.references.length })}</small>` : null}
            ${(e.related_entries || []).length ? html`<small class="kp-mono">${e.related_entries.map(r => `${relWord(r.relation)} ${r.key}`).join(' · ')}</small>` : null}
          </div>`; })}
      </div>
      <label class="kp-check"><input type="checkbox" checked=${p.catalogListed} onChange=${(e) => ctx.setImportPreview({ ...p, catalogListed: e.target.checked })} />${t('knowledge.import.catalogToggle')}</label>
      <div class="kp-preview-actions">
        <button type="button" class="og-slab" disabled=${ctx.importing} onClick=${ctx.confirmImport}>${ctx.importing ? '…' : c('importN', { n: entries.length })}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.handleImportPaste('')}>${c('discard')}</button>
      </div>
    </div>`;
}

/* ── 03 The organisms' packages ────────────────────────────────────────────────────────────── */
function secOrganisms(ctx) {
  const list = ctx.organismPackages;
  return html`<${Section} id="kp-orgs" num="03" title=${c('secOrganisms')} count=${c('secOrganismsSub', { n: new Set(list.map(p => p.organismName)).size })} doors=${html`<button type="button" class="og-door og-door--quiet" onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }))}>${t('profile.tabs.organisms')}</button>`}>
    ${ctx.organismLoading ? html`<p class="og-empty kp-loading">${t('common.loading')}</p>` : !list.length ? html`<p class="og-empty">${t('knowledge.organisms.empty')}</p>` : html`
      <div class="kp-rows kp-rows--org">
        ${list.map((p, i) => html`
          <div class="kp-nm" key=${'n' + i}>${p.manifest?.name || c('untitled')}<small>${p.organismName || ''}</small></div>
          <div class="kp-m" key=${'e' + i}>${p.manifest?.entries?.length ? html`<b>${p.manifest.entries.length}</b> ${c('entriesWord', { n: p.manifest.entries.length })}` : ''}</div>
          <div class="kp-m" key=${'c' + i}>${p.contributed_at ? c('contributedOn', { d: rel(p.contributed_at) }) : ''}</div>`)}
      </div>`}
    <p class="kp-hint">${c('sharedNote')}</p>
  <//>`;
}

/* ── 04 From the public library ────────────────────────────────────────────────────────────── */
function secLibrary(ctx) {
  const mine = new Set(ctx.packages.map(p => pkgId(p)));
  const list = ctx.discovered.filter(p => !mine.has(p.package_id) && authorName(p.author) !== authorName(ctx.ghii));
  const clonable = list.filter(p => p.sharing?.allow_clone !== false);
  return html`<${Section} id="kp-library" num="04" title=${c('secLibrary')} count=${c('secLibrarySub', { n: ctx.discovered.length, k: clonable.length })} doors=${html`<button type="button" class="og-door" onClick=${() => window.open('/v1/publicknowledgeviewer', '_blank', 'noopener')}>${c('openLibrary')} ↗</button>`}>
    ${ctx.discoverLoading ? html`<p class="og-empty kp-loading">${t('common.loading')}</p>` : !list.length ? html`<p class="og-empty">${c('noneLibrary')}</p>` : html`
      <div class="kp-lib">
        ${list.slice(0, 8).map(p => { const cl = p.sharing?.allow_clone !== false; return html`
          <div class="kp-nm" key=${'n' + p.package_id}><button type="button" class="og-tbl-name" onClick=${() => window.open('/v1/publicknowledgeviewer?id=' + encodeURIComponent(p.package_id), '_blank', 'noopener')}>${p.name || c('untitled')}</button>${p.synthesis?.description ? html`<small>${p.synthesis.description}</small>` : null}</div>
          <div class="kp-m" key=${'t' + p.package_id}>${[ctWord(p.content_type), p.maturity ? t('knowledge.maturity.' + p.maturity) : '', p.language].filter(Boolean).join(' · ')}<br /><b>${authorName(p.author)}</b></div>
          <div class="kp-m" key=${'e' + p.package_id}>${c('entriesN', { n: p.entries_count || 0 })}${p.references_count ? html`<br />${c('refsVerified', { v: p.verified_references || 0, n: p.references_count })}` : null}</div>
          <div class="kp-m" key=${'c' + p.package_id}>${cl ? html`<b>${c('clonable')}</b>` : c('readOnly')}</div>
          <div class="og-tbl-door" key=${'d' + p.package_id}>${cl ? html`<button type="button" class="og-door" onClick=${() => ctx.handleClone(p.package_id)}>${c('clone')}</button>` : html`<button type="button" class="og-door" onClick=${() => window.open('/v1/publicknowledgeviewer?id=' + encodeURIComponent(p.package_id), '_blank', 'noopener')}>${c('open')}</button>`}</div>`; })}
      </div>`}
    <p class="kp-hint">${c('libraryHint')} ${t('knowledge.discover.trustAdvisory')}</p>
  <//>`;
}

export { num };
