/**
 * @file public-knowledge-viewer.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public knowledge library, no login required: the same poster face as the
 *   Knowledge page without the profile shell. The LIBRARY is one search field with the kind and
 *   the order beside it, and a list where a row says what a package is about and who published it,
 *   by name. A PACKAGE is a reading room: the entries open as text with their sources named
 *   verified or unchecked, cloning as the slab when signed in, Markdown and JSON as doors, the
 *   origin in the rail. Reads the public endpoints; the Art. 50(4) label stays under the headline.
 * @structure PublicKnowledgeViewer · BrowseView · DetailView · entryToMarkdown · buildFullMarkdown
 * @version-history
 *   v2.0.0 — 2026-08-30 — The poster face (design canvas "AIMEAT Tietopankin sivu", direction A):
 *     the card grid becomes a list with a sentence per package, the centred card becomes a reading
 *     room with the entries open. Dates in the reader's locale; every word through t().
 *   v1.x — 2026-05 to 2026-08 — the card grid and the accordion detail; provenance label (TARGET-058).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { AiLabel } from '/components/ai-label.js';
import { getSession } from '/js/services/auth.js';
import { apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

const CONTENT_TYPES = ['idea', 'research', 'plan', 'dataset', 'document', 'tutorial', 'collection', 'article', 'story', 'fiction', 'guide'];
const c = (key, vars) => t('knowledge.cover.' + key, vars);
const loc = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(loc()) : '');
const ctWord = (ct) => (ct ? (t('knowledge.contentTypes.' + ct) || ct) : '');
const maturityWord = (m) => (m ? (t('knowledge.maturity.' + m) || m) : '');
const synthWord = (s) => (s ? (t('knowledge.synthesis.' + s) || s) : '');
const relWord = (r) => c('relation.' + r) || r;
const authorName = (a) => String(a || '').split('@')[0] || '';

/* ── The public endpoints ── */
async function fetchPublic(path) {
  const resp = await fetch(path);
  if (!resp.ok) { const err = new Error(`HTTP ${resp.status}`); err.status = resp.status; throw err; }
  return resp.json();
}
async function discoverPackages(opts = {}) {
  const params = new URLSearchParams();
  if (opts.content_type) params.set('content_type', opts.content_type);
  if (opts.tags) params.set('tags', opts.tags);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return fetchPublic(`/v1/catalogue/knowledge${qs ? '?' + qs : ''}`);
}
const getPackageManifest = (id) => fetchPublic(`/v1/knowledge/${encodeURIComponent(id)}`);
const getPackageReputation = (id) => fetchPublic(`/v1/knowledge/${encodeURIComponent(id)}/reputation`);
const getPackageLinks = (id) => fetchPublic(`/v1/knowledge/${encodeURIComponent(id)}/links`);
const exportPackage = (id) => fetchPublic(`/v1/knowledge/${encodeURIComponent(id)}/export`);

/* ── An entry's content as text, and as Markdown ── */
const formatKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
function valueToText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(v => (typeof v === 'object' && v !== null ? Object.entries(v).map(([k, x]) => `${formatKey(k)}: ${valueToText(x)}`).join(' · ') : valueToText(v))).map(s => '· ' + s).join('\n');
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${formatKey(k)}\n${valueToText(v)}`).join('\n\n');
  return String(value);
}
function entryToText(content) {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return String(content || '');
  const parts = [];
  if (content.summary) parts.push(content.summary);
  if (content.body) parts.push(content.body);
  const rest = Object.entries(content).filter(([k]) => !['title', 'summary', 'body'].includes(k));
  for (const [k, v] of rest) parts.push(`${formatKey(k)}\n${valueToText(v)}`);
  return parts.join('\n\n');
}
function valueToMarkdown(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.every(v => typeof v === 'string' || typeof v === 'number')) return value.join(', ');
    return value.map(item => (typeof item === 'object' && item !== null ? '- ' + Object.entries(item).map(([k, v]) => `**${formatKey(k)}:** ${valueToMarkdown(v)}`).join(' | ') : `- ${valueToMarkdown(item)}`)).join('\n');
  }
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => { const r = valueToMarkdown(v); return r.includes('\n') ? `**${formatKey(k)}:**\n${r}` : `**${formatKey(k)}:** ${r}`; }).join('\n\n');
  return String(value);
}
function entryToMarkdown(content) {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return String(content || '');
  const lines = [];
  if (content.summary) lines.push(`*${content.summary}*\n`);
  for (const [key, val] of Object.entries(content).filter(([k]) => k !== 'title' && k !== 'summary')) { lines.push(`### ${formatKey(key)}\n`); lines.push(valueToMarkdown(val)); lines.push(''); }
  return lines.join('\n');
}
function buildFullMarkdown(manifest, publicEntries, entryData) {
  const lines = [`# ${manifest.name}\n`, `**Author:** ${manifest.author || '-'}  `, `**Version:** ${manifest.version || '1.0.0'}  `, `**Content type:** ${manifest.content_type || '-'}  `, `**Language:** ${manifest.language || '-'}  `, `**Maturity:** ${manifest.maturity || '-'}  `];
  if (manifest.created) lines.push(`**Created:** ${day(manifest.created)}  `);
  if (manifest.updated) lines.push(`**Updated:** ${day(manifest.updated)}  `);
  if (manifest.synthesis) { lines.push(`**Synthesis:** ${manifest.synthesis.level}${manifest.synthesis.model ? ' (' + manifest.synthesis.model + ')' : ''}  `); if (manifest.synthesis.description) lines.push(`> ${manifest.synthesis.description}`); }
  if (manifest.tags?.length) lines.push(`\n**Tags:** ${manifest.tags.join(', ')}`);
  if (manifest.sharing?.license) lines.push(`**License:** ${manifest.sharing.license}`);
  lines.push('\n---\n');
  for (const entry of publicEntries) {
    const entryName = entry.key.split('/').pop() || entry.key;
    lines.push(`## ${entry.title || entryName}\n`);
    lines.push(entryData[entryName] ? entryToMarkdown(entryData[entryName]) : '*Content unavailable*');
    for (const ref of entry.references || []) lines.push(`- ${ref.verified ? '' : '(unverified) '}${ref.url ? `[${ref.title || ref.url}](${ref.url})` : ref.title}`);
    lines.push('\n---\n');
  }
  if (manifest.references?.length) { lines.push('## References\n'); for (const ref of manifest.references) lines.push(ref.url ? `- [${ref.title || ref.url}](${ref.url})` : `- ${ref.title}`); }
  return lines.join('\n');
}

/* ── Main ── */
export default function PublicKnowledgeViewer() {
  const [packageId, setPackageId] = useState(() => new URLSearchParams(window.location.search).get('id'));
  const openPackage = useCallback((id) => {
    setPackageId(id);
    const url = new URL(window.location.href); url.searchParams.set('id', id); history.pushState(null, '', url.toString());
  }, []);
  const goBack = useCallback(() => {
    setPackageId(null);
    const url = new URL(window.location.href); url.searchParams.delete('id'); history.pushState(null, '', url.toString());
  }, []);
  useEffect(() => {
    const handler = () => setPackageId(new URLSearchParams(window.location.search).get('id'));
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  return html`<div class="og og-kp og-kp--public">${packageId ? html`<${DetailView} packageId=${packageId} onBack=${goBack} />` : html`<${BrowseView} onSelect=${openPackage} />`}</div>`;
}

const crumbPublic = (parts, onBack) => html`
  <div class="og-crumb">
    <span>${window.location.host}</span><span>/</span>
    ${parts.length ? html`<button type="button" class="og-crumb-link" onClick=${onBack}>${t('pkv.title')}</button>` : html`<span class="og-crumb-here">${t('pkv.title')}</span>`}
    ${parts.map((p, i) => html`<span key=${i}>/</span><span class="og-crumb-here">${p}</span>`)}
  </div>`;

/* ── The library ── */
function BrowseView({ onSelect }) {
  const [packages, setPackages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [contentType, setContentType] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const debounceRef = useRef(null);
  const signedIn = !!getSession();

  const load = useCallback(async ({ p = 1, q = search, ct = contentType, s = sort } = {}) => {
    setLoading(true); setError(null);
    try {
      const result = await discoverPackages({ content_type: ct, tags: q, sort: s === 'name' ? 'name' : 'newest', page: p, limit: 20 });
      const items = result?.data?.packages || result?.data?.items || [];
      setPackages(prev => (p > 1 ? [...prev, ...items] : items));
      setTotal(result?.data?.total || items.length);
      setPage(p);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- every input is passed in; the defaults are the current state
  }, []);
  useEffect(() => {
    load({ p: 1, ct: contentType, s: sort, q: search });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the search has its own debounced path; load is stable
  }, [contentType, sort]);
  const onSearch = (v) => { setSearch(v); if (debounceRef.current) clearTimeout(debounceRef.current); debounceRef.current = setTimeout(() => load({ p: 1, q: v, ct: contentType, s: sort }), 400); };

  const shown = useMemo(() => (sort === 'refs' ? [...packages].sort((a, b) => (b.verified_references || 0) - (a.verified_references || 0) || (b.references_count || 0) - (a.references_count || 0)) : packages), [packages, sort]);
  const publishers = new Set(packages.map(p => authorName(p.author)));
  const clonable = packages.filter(p => p.sharing?.allow_clone !== false).length;
  const typesPresent = CONTENT_TYPES.filter(ct => packages.some(p => p.content_type === ct) || ct === contentType);

  return html`
    ${crumbPublic([], null)}
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title">${t('pkv.title')}</h1>
        <div class="og-chips">
          <span class="og-chip">${c('pubChipPackages', { n: total || packages.length })}</span>
          ${publishers.size ? html`<span class="og-chip">${c('pubChipPublishers', { n: publishers.size })}</span>` : null}
          <span class="og-chip">${c('pubChipClonable', { n: clonable })}</span>
        </div>
        <p class="og-desc">${c('pubDesc')}</p>
      </div>
      <div class="og-mast-actions"><div class="og-doors">
        ${signedIn ? html`<a class="og-door" href="/v1/profile?tab=knowledge">${c('pubMine')}</a>` : null}
        <a class="og-door og-door--quiet" href="/v1/help#knowledge">${c('pubWhat')}</a>
      </div></div>
    </div>
    <div class="kp-desk">
      <input type="search" class="kp-field" value=${search} placeholder=${c('pubSearch')} onInput=${(e) => onSearch(e.target.value)} />
      <div class="og-choice">
        <button type="button" class=${`og-choice-btn ${contentType === '' ? 'on' : ''}`} onClick=${() => setContentType('')}>${c('pubAll')}</button>
        ${typesPresent.map(ct => html`<button type="button" key=${ct} class=${`og-choice-btn ${contentType === ct ? 'on' : ''}`} onClick=${() => setContentType(contentType === ct ? '' : ct)}>${ctWord(ct)}</button>`)}
      </div>
      <div class="og-choice">
        ${[['newest', c('pubNewest')], ['name', c('pubByName')], ['refs', c('pubByRefs')]].map(([id, label]) => html`<button type="button" key=${id} class=${`og-choice-btn ${sort === id ? 'on' : ''}`} onClick=${() => setSort(id)}>${label}</button>`)}
      </div>
    </div>
    ${error ? html`<p class="kp-error">${error}</p>` : null}
    ${!loading && !packages.length && !error ? html`<p class="og-empty kp-pub-empty">${c('pubEmpty')}</p>` : null}
    ${packages.length ? html`
      <div class="kp-lib kp-lib--head"><div>${c('pubColPackage')}</div><div>${c('pubColKind')}</div><div>${c('pubColContents')}</div><div></div><div></div></div>
      <div class="kp-lib">
        ${shown.map(p => { const cl = p.sharing?.allow_clone !== false; return html`
          <div class="kp-nm" key=${'n' + p.package_id}><button type="button" class="og-tbl-name" onClick=${() => onSelect(p.package_id)}>${p.name || c('untitled')}</button>${p.synthesis?.description ? html`<small>${p.synthesis.description}</small>` : null}</div>
          <div class="kp-m" key=${'t' + p.package_id}>${[ctWord(p.content_type), maturityWord(p.maturity), p.language ? String(p.language).toLowerCase() : ''].filter(Boolean).join(' · ')}<br /><b>${authorName(p.author)}</b></div>
          <div class="kp-m" key=${'e' + p.package_id}>${c('entriesN', { n: p.public_entries ?? p.entries_count ?? 0 })}${p.references_count ? html`<br />${c('refsVerified', { v: p.verified_references || 0, n: p.references_count })}` : null}</div>
          <div class="kp-m" key=${'c' + p.package_id}>${cl ? html`<b>${c('clonable')}</b>` : c('pubReadable')}</div>
          <div class="og-tbl-door" key=${'d' + p.package_id}><button type="button" class="og-door" onClick=${() => onSelect(p.package_id)}>${c('open')}</button></div>`; })}
      </div>` : null}
    ${loading ? html`<p class="og-empty kp-loading kp-pub-empty">${c('pubLoading')}</p>` : null}
    ${!loading && page * 20 < total ? html`<p class="kp-more"><button type="button" onClick=${() => load({ p: page + 1, q: search, ct: contentType, s: sort })}>${t('pkv.loadMore')}</button></p>` : null}
    <p class="kp-hint">${c('pubHint')}</p>`;
}

/* ── The reading room ── */
function DetailView({ packageId, onBack }) {
  const [manifest, setManifest] = useState(null);
  const [provenance, setProvenance] = useState(null);
  const [reputation, setReputation] = useState(null);
  const [links, setLinks] = useState([]);
  const [entryData, setEntryData] = useState({});
  const [closed, setClosed] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cloneState, setCloneState] = useState('');
  const signedIn = !!getSession();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      const [pkgResult, repResult, linksResult, exportResult] = await Promise.allSettled([getPackageManifest(packageId), getPackageReputation(packageId), getPackageLinks(packageId), exportPackage(packageId)]);
      if (cancelled) return;
      if (pkgResult.status === 'fulfilled') { setManifest(pkgResult.value?.data?.manifest || pkgResult.value?.data || null); setProvenance(pkgResult.value?.meta?.provenance || null); }
      else setError(pkgResult.reason?.message || t('pkv.notFound'));
      if (repResult.status === 'fulfilled') setReputation(repResult.value?.data || null);
      if (linksResult.status === 'fulfilled') { const l = linksResult.value?.data?.links || linksResult.value?.data || []; setLinks(Array.isArray(l) ? l : []); }
      if (exportResult.status === 'fulfilled') setEntryData(exportResult.value?.entry_data || exportResult.value?.data?.entry_data || {});
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [packageId]);

  const handleExport = useCallback(async () => {
    try {
      const result = await exportPackage(packageId);
      const blob = new Blob([JSON.stringify(result?.data || result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${manifest?.name || packageId}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { swallowed('public-knowledge-viewer: export', err); setError(err.message); }
  }, [packageId, manifest]);
  const handleClone = useCallback(async () => {
    setCloneState('busy');
    try {
      const r = await apiPost(`/v1/knowledge/${encodeURIComponent(packageId)}/clone`, { target_prefix: 'cloned' });
      setCloneState(r?.data?.cloned_package_id ? 'done' : 'failed');
    } catch (err) { swallowed('public-knowledge-viewer: clone', err); setCloneState('failed'); }
  }, [packageId]);

  if (loading) return html`${crumbPublic([], onBack)}<p class="og-empty kp-loading kp-pub-empty">${c('pubLoading')}</p>`;
  if (error || !manifest) return html`${crumbPublic([], onBack)}<p class="og-empty kp-pub-empty">${error || t('pkv.notFound')}</p><p><button type="button" class="og-door" onClick=${onBack}>${c('pubBack')}</button></p>`;

  const publicEntries = (manifest.entries || []).filter(e => e.visibility === 'public');
  let refs = 0, verified = 0;
  for (const e of publicEntries) for (const r of e.references || []) { refs++; if (r.verified) verified++; }
  for (const r of manifest.references || []) { refs++; if (r.verified) verified++; }
  const toggle = (key) => setClosed(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const clones = reputation?.clone_count ?? null;
  const tags = manifest.tags || [];
  const target = (k) => (manifest.entries || []).find(e => e.key === k || String(e.key || '').endsWith('/' + k));

  return html`
    ${crumbPublic([manifest.name], onBack)}
    <div class="og-mast og-mast--page">
      <div class="og-mast-words">
        <h1 class="og-title kp-title--page">${manifest.name}</h1>
        <div class="og-chips">
          ${manifest.content_type ? html`<span class="og-chip">${ctWord(manifest.content_type)}</span>` : null}
          ${manifest.maturity ? html`<span class="og-chip">${maturityWord(manifest.maturity)}</span>` : null}
          ${manifest.synthesis?.level ? html`<span class="og-chip">${synthWord(manifest.synthesis.level)}</span>` : null}
          ${manifest.language ? html`<span class="og-chip og-chip--dim">${String(manifest.language).toLowerCase()}</span>` : null}
          ${manifest.sharing?.license ? html`<span class="og-chip og-chip--dim kp-chip--case">${manifest.sharing.license}</span>` : null}
          <span class="og-chip og-chip--sun kp-chip--case">${authorName(manifest.author)} · ${window.location.host}</span>
          ${tags.slice(0, 4).map(tag => html`<span class="og-chip og-chip--dim kp-chip--case" key=${tag}>${tag}</span>`)}
          ${tags.length > 4 ? html`<span class="og-chip og-chip--dim">+${tags.length - 4}</span>` : null}
        </div>
      </div>
      <div class="og-mast-actions"><div class="og-doors">
        ${signedIn && manifest.sharing?.allow_clone !== false ? html`<button type="button" class="og-slab" disabled=${cloneState === 'busy' || cloneState === 'done'} onClick=${handleClone}>${cloneState === 'done' ? c('pubCloned') : c('pubCloneToMine')}</button>` : null}
        <${CopyButton} text=${buildFullMarkdown(manifest, publicEntries, entryData)} className="og-door" label=${t('pkv.copyMarkdown')} copiedLabel=${t('common.copied')} />
        <button type="button" class="og-door og-door--quiet" onClick=${handleExport}>${t('pkv.exportJson')}</button>
      </div></div>
    </div>
    ${cloneState === 'failed' ? html`<p class="kp-error">${c('pubCloneFailed')}</p>` : null}
    <${AiLabel} variant="block" record=${provenance?.record} recordUrl=${provenance?.recordUrl} />
    <div class="og-strip">
      <div><b>${publicEntries.length}</b><span>${c('pubEntries')}</span><small>${c('pubEntriesSub')}</small></div>
      <div><b>${verified}<span class="kp-of">/${refs}</span></b><span>${c('stripRefs')}</span><small>${refs ? (refs - verified ? c('stripRefsSub', { n: refs - verified }) : c('stripRefsAll')) : c('noRefs')}</small></div>
      <div><b>${day(manifest.created) || '·'}</b><span>${c('pubPublished')}</span><small>${manifest.updated ? `${t('pkv.updated').toLowerCase()} ${day(manifest.updated)}` : ''}${manifest.version ? ` · v${manifest.version}` : ''}</small></div>
      <div><b class="og-strip-coral">${clones ?? '·'}</b><span>${c('pubClones')}</span><small>${clones ? c('pubClonesSub', { n: clones }) : c('pubNoClones')}</small></div>
    </div>
    <div class="og-grid">
      <div class="og-main">
        ${manifest.synthesis?.description ? html`<section class="og-sec og-sec--first"><p class="kp-about">${manifest.synthesis.description}</p></section>` : null}
        ${publicEntries.map((entry, i) => {
          const entryName = entry.key.split('/').pop() || entry.key;
          const content = entryData[entryName];
          const isClosed = closed.has(entry.key);
          const erefs = entry.references || [];
          const rels = entry.related_entries || [];
          return html`<section class=${`og-sec kp-entry-sec ${i === 0 && !manifest.synthesis?.description ? 'og-sec--first' : ''}`} id=${'kp-pe-' + i} key=${entry.key}>
            <div class="og-sec-h"><h2><span class="kp-num">${String(i + 1).padStart(2, '0')}</span> ${entry.title || entryName}</h2><div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => toggle(entry.key)}>${isClosed ? c('open') : c('close')}</button></div></div>
            ${isClosed ? null : html`
              ${content ? html`<p>${entryToText(content)}</p>` : html`<p class="og-empty">${t('pkv.entryUnavailable')}</p>`}
              ${erefs.length ? html`<div class="kp-refs">${erefs.map((r, j) => html`<div class="kp-ref" key=${j}><i class=${r.verified ? '' : 'kp-ref--no'}>${r.verified ? c('verified') : c('unverified')}</i>${r.url ? html`<a href=${r.url} target="_blank" rel="noopener">${r.title || r.url} ↗</a>` : html`<span>${r.title || c('untitled')}</span>`}</div>`)}</div>` : null}
              ${rels.length ? html`<div class="kp-rels">${rels.map((r, j) => { const tg = target(r.key); return html`<span class="kp-rel" key=${j}><b>${relWord(r.relation)}</b>${tg ? (tg.title || r.key) : r.key}</span>`; })}</div>` : null}`}
          </section>`;
        })}
        ${manifest.references?.length ? html`<section class="og-sec"><div class="og-sec-h"><h2>${t('pkv.references')}</h2></div><div class="kp-refs">${manifest.references.map((r, j) => html`<div class="kp-ref" key=${j}><i class=${r.verified ? '' : 'kp-ref--no'}>${r.verified ? c('verified') : c('unverified')}</i>${r.url ? html`<a href=${r.url} target="_blank" rel="noopener">${r.title || r.url} ↗</a>` : html`<span>${r.title}</span>`}</div>`)}</div></section>` : null}
        ${links.length ? html`<section class="og-sec"><div class="og-sec-h"><h2>${c('pubRelated')}</h2></div><div class="kp-rels">${links.map((l, j) => html`<span class="kp-rel" key=${j}><b>${relWord(l.relation)}</b>${l.target_name || l.target}</span>`)}</div></section>` : null}
      </div>
      <nav class="og-rail">
        <span class="og-rail-label">${t('pkv.title')}</span>
        <button type="button" class="og-rail-link" onClick=${onBack}><i>←</i>${c('pubBack')}</button>
        ${publicEntries.length ? html`<hr /><span class="og-rail-label">${c('pubEntries')}</span>
          ${publicEntries.map((e, i) => html`<button type="button" class=${`og-rail-link ${closed.has(e.key) ? '' : 'on'}`} key=${e.key} onClick=${() => document.getElementById('kp-pe-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><i>${String(i + 1).padStart(2, '0')}</i>${e.title || e.key.split('/').pop()}</button>`)}` : null}
        <hr /><span class="og-rail-label">${c('pubOrigin')}</span>
        <span class="og-rail-link kp-prov">${c('pubOriginText', { a: authorName(manifest.author) || '?', d: day(manifest.created) || '?' })}${manifest.author?.includes('@') ? ` ${manifest.author}` : ''}</span>
      </nav>
    </div>`;
}
