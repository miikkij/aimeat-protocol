/**
 * @file public/views/profile/knowledge/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Knowledge page in the poster face (design canvas "AIMEAT Tietopankin sivu",
 *   direction A). The COVER answers in the order a person asks: what I have (packages as rows,
 *   drafts, published and datasets apart), how I make a new one (three roads: an agent over MCP, a
 *   chat with a prompt and the result pasted back, a finished package pasted in), what the organisms
 *   share, and what in the public library is worth taking. A package opens as its own page
 *   (package.js). Pure render functions over the ctx bag knowledge-tab.js assembles, composed from
 *   the shared component set (components/poster-parts.js) with no class or style of its own.
 * @structure renderKnowledgeView · renderCover · secPackages · secMake · importPreview · secOrganisms · secLibrary
 * @usage import { renderKnowledgeView } from './knowledge/cover.js';
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set (Page, Rail, Section, NumeralBand,
 *     ListRow, Surface, Field, Action, Chip, Text) so the cover follows the one theme and
 *     knowledge-poster.css is no longer read by it. Content, handlers and i18n keys unchanged; the
 *     arrow after an outside link is the allowed →.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces the action bar, the always-open import box and the wall
 *     of expandable cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Columns, Stack, ListRow, NumeralBand, Surface, Field, Action, Chip, Text } from '/components/poster-parts.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, num, rel, ctWord, synthWord, visWord, relWord, manifestOf, statsOf, groupOf, GROUP_ORDER, pkgId, authorName, crumb, packageRows, pageLinks } from './frame.js';
import { renderPackage } from './package.js';

const openLibrary = (id) => window.open('/v1/publicknowledgeviewer' + (id ? '?id=' + encodeURIComponent(id) : ''), '_blank', 'noopener');

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
  const chip = (n, key, tone) => html`<${Chip} tone=${tone}>${c(key, { n })}<//>`;
  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    latest ? { label: c('stripLatest'), value: rel(manifestOf(latest).updated || latest.updated_at), note: manifestOf(latest).name } : { label: c('stripLatest'), value: '·', note: c('noneYet') },
    { label: c('stripListed'), value: `${listed}/${pkgs.length}`, note: c('stripListedSub') },
    { label: c('stripRefs'), value: `${totals.verified}/${totals.refs}`, note: totals.refs - totals.verified ? c('stripRefsSub', { n: totals.refs - totals.verified }) : c('stripRefsAll') },
    { label: c('stripFederated'), value: federated, note: c('stripFederatedSub'), tone: federated ? 'coral' : undefined },
  ]} />`;
  const rail = html`<${Rail} kind="index" title=${c('railTitle')} entries=${[
    { href: '#kp-packages', label: c('secPackages'), count: pkgs.length },
    { href: '#kp-make', label: c('make') },
    { href: '#kp-orgs', label: c('secOrganisms'), count: ctx.organismPackages.length },
    { href: '#kp-library', label: c('secLibrary'), count: ctx.discovered.length },
  ]}>${pageLinks()}<//>`;
  return html`<${Page} title=${t('knowledge.tabLabel')} crumbs=${crumb(ctx, [])}
    identity=${html`<${Stack} direction="wrap" density="compact">
      ${chip(pkgs.length, 'chipPackages')}${chip(totals.entries, 'chipEntries')}${chip(listed, 'chipListed')}${chip(clonable, 'chipClonable')}
      ${federated ? chip(federated, 'chipFederated', 'sun') : null}${drafts ? chip(drafts, 'chipDrafts', 'muted') : null}${datasets ? chip(datasets, 'chipDatasets', 'sun') : null}
    <//>`}
    actions=${html`<${Action} kind="primary" onClick=${() => scrollTo('kp-make')}>${c('make')}<//>
      <${Action} onClick=${() => openLibrary()}>${c('library')} →<//>`}
    rail=${rail}>
    <${Stack}>
      <${Text} tone="muted">${c('desc')}<//>
      ${strip}
      ${secPackages(ctx)}
      ${secMake(ctx)}
      ${secOrganisms(ctx)}
      ${secLibrary(ctx)}
    <//>
  <//>`;
}

/* ── 01 My packages ────────────────────────────────────────────────────────────────────────── */
function secPackages(ctx) {
  const pkgs = ctx.packages;
  const byUpdated = (a, b) => new Date(manifestOf(b).updated || b.updated_at || 0).getTime() - new Date(manifestOf(a).updated || a.updated_at || 0).getTime();
  const byName = (a, b) => String(manifestOf(a).name || '').localeCompare(String(manifestOf(b).name || ''));
  const sortDoor = (id, label) => html`<${Action} kind="tab" selected=${ctx.sort === id} onClick=${() => ctx.setSort(id)}>${label}<//>`;
  const doors = html`${sortDoor('state', c('byState'))}${sortDoor('name', c('byName'))}${sortDoor('newest', c('byNewest'))}`;
  let body;
  if (ctx.loading) body = html`<${Text} tone="muted">${t('common.loading')}<//>`;
  else if (!pkgs.length) body = html`<${Text} tone="muted">${c('nonePackages')}<//>`;
  else if (ctx.sort === 'state') {
    const groups = GROUP_ORDER.map(g => ({ g, list: pkgs.filter(p => groupOf(manifestOf(p)) === g).sort(byUpdated) })).filter(x => x.list.length);
    body = html`<${Stack}>${groups.map(({ g, list }) => html`<${Stack} key=${g} density="compact">
      <${Text} kind="label">${c('group.' + g)} ${list.length}<//>${packageRows(ctx, list)}<//>`)}<//>`;
  } else {
    body = packageRows(ctx, [...pkgs].sort(ctx.sort === 'name' ? byName : byUpdated));
  }
  return html`<${Section} id="kp-packages" density="compact" title=${c('secPackages')} count=${pkgs.length} actions=${doors}>${body}<//>`;
}

/* ── 02 Make a package: three roads ────────────────────────────────────────────────────────── */
function secMake(ctx) {
  const road = (id, title, step, body, doorLabel, onClick) => {
    const on = ctx.road === id;
    return html`<${Surface} key=${id} kind="box" tone=${on ? 'sun' : 'plain'}><${Stack} density="compact">
      <${Text} kind="lead"><strong>${title}</strong><//>
      <${Text} kind="mono" tone=${on ? 'plain' : 'coral'}>${step}<//>
      <${Text} kind="caption" tone=${on ? 'plain' : 'muted'}>${body}<//>
      <${Action} kind="text" onClick=${onClick}>${doorLabel} →<//>
    <//><//>`;
  };
  return html`<${Section} id="kp-make" density="compact" title=${c('make')} count=${c('makeSub')}>
    <${Stack}>
      <${Columns} layout="thirds" collapse="560">
        ${road('mcp', c('roadMcp'), c('roadMcpStep'), c('roadMcpBody'), c('roadMcpDoor'), () => { ctx.setRoad('mcp'); ctx.copyPrompt('mcp'); })}
        ${road('chat', c('roadChat'), c('roadChatStep'), c('roadChatBody'), c('roadChatDoor'), () => { ctx.setRoad('chat'); ctx.copyPrompt('human'); })}
        ${road('paste', c('roadPaste'), c('roadPasteStep'), c('roadPasteBody'), c('roadPasteDoor'), () => { ctx.setRoad('paste'); ctx.setPasteOpen(true); })}
      <//>
      ${ctx.road === 'chat' || ctx.road === 'paste' || ctx.pasteOpen || ctx.importText ? html`
        <${Field} type="textarea" rows=${4} placeholder=${t('knowledge.import.placeholder')} value=${ctx.importText} onInput=${(e) => ctx.handleImportPaste(e.target.value)} />
        ${ctx.importError ? html`<${Text} tone="danger">${ctx.importError}<//>` : null}
        ${ctx.importPreview ? importPreview(ctx) : html`<${Text} kind="caption" tone="muted">${c('pasteHint', { ghii: ctx.ghii })}<//>`}` : null}
    <//>
  <//>`;
}

function importPreview(ctx) {
  const p = ctx.importPreview;
  const pkg = p.pkg;
  const entries = pkg.entries || [];
  return html`<${Surface} kind="box"><${Stack}>
    <${Stack} direction="wrap" align="center" density="compact">
      <${Text} kind="lead"><strong>${pkg.name || pkg.title || pkg.id || c('untitled')}</strong><//>
      <${Chip}>${ctWord(pkg.content_type || 'document')}<//>
      <${Chip} tone="muted">${synthWord(pkg.synthesis?.level)}<//>
      <${Chip} tone="muted">${c('entriesN', { n: entries.length })}<//>
    <//>
    <${Text} kind="caption" tone=${p.ghiiMatch ? 'muted' : 'coral'}>${p.ghiiMatch ? t('knowledge.import.ghiiConfirm').replace('{ghii}', ctx.ghii) : t('knowledge.import.ghiiMismatch').replace('{ghii}', p.targetGhii)}<//>
    <div>
      ${entries.map((e, i) => { const data = p.raw?.entry_data?.[e.key] || e.value; const val = typeof data === 'string' ? data : (data?.body || data?.summary || data?.description || ''); return html`
        <${ListRow} key=${i} density="compact" detailKind="text" name=${e.title || e.key || c('entryN', { n: i + 1 })}
          detail=${val ? (val.length > 140 ? val.slice(0, 140) + '…' : val) : undefined}
          value=${html`<${Chip} tone=${e.visibility === 'public' ? 'sun' : 'muted'}>${visWord(e.visibility)}<//>`}>
          ${(e.references || []).length || (e.related_entries || []).length ? html`<${Stack} density="compact">
            ${(e.references || []).length ? html`<${Text} kind="mono" tone="muted">${c('refsVerified', { v: (e.references || []).filter(r => r.verified).length, n: e.references.length })}<//>` : null}
            ${(e.related_entries || []).length ? html`<${Text} kind="mono" tone="muted">${e.related_entries.map(r => `${relWord(r.relation)} ${r.key}`).join(' · ')}<//>` : null}
          <//>` : null}
        <//>`; })}
    </div>
    <${Field} type="checkbox" label=${t('knowledge.import.catalogToggle')} value=${p.catalogListed} onChange=${(e) => ctx.setImportPreview({ ...p, catalogListed: e.target.checked })} />
    <${Stack} direction="horizontal" align="center">
      <${Action} kind="primary" disabled=${ctx.importing} onClick=${ctx.confirmImport}>${ctx.importing ? '…' : c('importN', { n: entries.length })}<//>
      <${Action} onClick=${() => ctx.handleImportPaste('')}>${c('discard')}<//>
    <//>
  <//><//>`;
}

/* ── 03 The organisms' packages ────────────────────────────────────────────────────────────── */
function secOrganisms(ctx) {
  const list = ctx.organismPackages;
  return html`<${Section} id="kp-orgs" density="compact" title=${c('secOrganisms')} count=${c('secOrganismsSub', { n: new Set(list.map(p => p.organismName)).size })}
    actions=${html`<${Action} onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }))}>${t('profile.tabs.organisms')}<//>`}>
    <${Stack}>
      ${ctx.organismLoading ? html`<${Text} tone="muted">${t('common.loading')}<//>` : !list.length ? html`<${Text} tone="muted">${t('knowledge.organisms.empty')}<//>` : html`
        <div>${list.map((p, i) => html`<${ListRow} key=${i} density="compact" detailKind="text" name=${p.manifest?.name || c('untitled')}
          detail=${[p.organismName || '', p.contributed_at ? c('contributedOn', { d: rel(p.contributed_at) }) : ''].filter(Boolean).join(' · ')}
          value=${p.manifest?.entries?.length ? `${p.manifest.entries.length} ${c('entriesWord', { n: p.manifest.entries.length })}` : undefined} />`)}</div>`}
      <${Text} kind="caption" tone="muted">${c('sharedNote')}<//>
    <//>
  <//>`;
}

/* ── 04 From the public library ────────────────────────────────────────────────────────────── */
function secLibrary(ctx) {
  const mine = new Set(ctx.packages.map(p => pkgId(p)));
  const list = ctx.discovered.filter(p => !mine.has(p.package_id) && authorName(p.author) !== authorName(ctx.ghii));
  const clonable = list.filter(p => p.sharing?.allow_clone !== false);
  return html`<${Section} id="kp-library" density="compact" title=${c('secLibrary')} count=${c('secLibrarySub', { n: ctx.discovered.length, k: clonable.length })}
    actions=${html`<${Action} onClick=${() => openLibrary()}>${c('openLibrary')} →<//>`}>
    <${Stack}>
      ${ctx.discoverLoading ? html`<${Text} tone="muted">${t('common.loading')}<//>` : !list.length ? html`<${Text} tone="muted">${c('noneLibrary')}<//>` : html`
        <div>${list.slice(0, 8).map(p => { const cl = p.sharing?.allow_clone !== false; return html`
          <${ListRow} key=${p.package_id} density="compact" detailKind="text" name=${p.name || c('untitled')} onOpen=${() => openLibrary(p.package_id)}
            detail=${p.synthesis?.description || undefined}
            value=${c('entriesN', { n: p.entries_count || 0 })}
            actions=${cl ? html`<${Action} onClick=${() => ctx.handleClone(p.package_id)}>${c('clone')}<//>` : html`<${Action} onClick=${() => openLibrary(p.package_id)}>${c('open')}<//>`}>
            <${Text} kind="mono" tone="muted">${[ctWord(p.content_type), p.maturity ? t('knowledge.maturity.' + p.maturity) : '', p.language, authorName(p.author),
              p.references_count ? c('refsVerified', { v: p.verified_references || 0, n: p.references_count }) : '', cl ? c('clonable') : c('readOnly')].filter(Boolean).join(' · ')}<//>
          <//>`; })}</div>`}
      <${Text} kind="caption" tone="muted">${c('libraryHint')} ${t('knowledge.discover.trustAdvisory')}<//>
    <//>
  <//>`;
}

export { num };
