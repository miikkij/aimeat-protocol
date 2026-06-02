/**
 * @file public-knowledge-viewer.js
 * @description Public knowledge package viewer -- no login required.
 *   Browse, search, filter, and read public knowledge packages.
 * @version-history v1.0.0 — 2026-05-26 — Initial implementation
 *   v1.1.0 — 2026-05-26 — Human-readable entry rendering, Copy as Markdown
 *   v1.2.0 — 2026-06-02 — Migrate Copy-as-Markdown button to canonical CopyButton component
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';

const NODE_URL = typeof window !== 'undefined' ? window.location.origin : '';

const CONTENT_TYPES = [
  'idea', 'research', 'plan', 'dataset', 'document',
  'tutorial', 'collection', 'article', 'story', 'fiction', 'guide'
];

const SORT_OPTIONS = ['newest', 'name'];

/* ── API helpers (no auth required for public endpoints) ── */

async function fetchPublic(path) {
  const resp = await fetch(path);
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

async function discoverPackages(opts = {}) {
  const params = new URLSearchParams();
  if (opts.content_type) params.set('content_type', opts.content_type);
  if (opts.tags) params.set('tags', opts.tags);
  if (opts.language) params.set('language', opts.language);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return fetchPublic(`/v1/catalogue/knowledge${qs ? '?' + qs : ''}`);
}

async function getPackageManifest(id) {
  return fetchPublic(`/v1/knowledge/${encodeURIComponent(id)}`);
}

async function getPackageReputation(id) {
  return fetchPublic(`/v1/knowledge/${encodeURIComponent(id)}/reputation`);
}

async function getPackageLinks(id) {
  return fetchPublic(`/v1/knowledge/${encodeURIComponent(id)}/links`);
}

async function exportPackage(id) {
  return fetchPublic(`/v1/knowledge/${encodeURIComponent(id)}/export`);
}

/* ── Human-readable JSON rendering ── */

function formatKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function RenderValue({ value, depth = 0 }) {
  if (value == null) return null;
  if (typeof value === 'string') return html`<span>${value}</span>`;
  if (typeof value === 'number' || typeof value === 'boolean') return html`<span>${String(value)}</span>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every(v => typeof v === 'string' || typeof v === 'number')) {
      return html`<span>${value.join(', ')}</span>`;
    }
    return html`<div class="pkv-val-list">
      ${value.map((item, i) => html`
        <div class="pkv-val-list-item">
          <${RenderValue} value=${item} depth=${depth + 1} />
        </div>
      `)}
    </div>`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return null;
    return html`<div class=${depth > 0 ? 'pkv-val-nested' : 'pkv-val-obj'}>
      ${entries.map(([k, v]) => html`
        <div class="pkv-val-row">
          <span class="pkv-val-key">${formatKey(k)}</span>
          <div class="pkv-val-value"><${RenderValue} value=${v} depth=${depth + 1} /></div>
        </div>
      `)}
    </div>`;
  }
  return html`<span>${String(value)}</span>`;
}

function RenderEntryContent({ content }) {
  if (typeof content === 'string') {
    return html`<div class="pkv-entry-text">${content}</div>`;
  }
  if (content && typeof content === 'object') {
    const title = content.title;
    const summary = content.summary;
    const rest = Object.fromEntries(
      Object.entries(content).filter(([k]) => k !== 'title' && k !== 'summary')
    );
    return html`
      <div class="pkv-entry-readable">
        ${title && html`<h4 class="pkv-entry-h">${title}</h4>`}
        ${summary && html`<p class="pkv-entry-summary">${summary}</p>`}
        ${Object.keys(rest).length > 0 && html`<${RenderValue} value=${rest} />`}
      </div>
    `;
  }
  return html`<div class="pkv-entry-text">${String(content)}</div>`;
}

/* ── Markdown export ── */

function valueToMarkdown(value, depth = 0) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.every(v => typeof v === 'string' || typeof v === 'number')) {
      return value.join(', ');
    }
    return value.map(item => {
      if (typeof item === 'object' && item !== null) {
        const parts = Object.entries(item)
          .map(([k, v]) => `**${formatKey(k)}:** ${valueToMarkdown(v, depth + 1)}`)
          .join(' | ');
        return `- ${parts}`;
      }
      return `- ${valueToMarkdown(item, depth + 1)}`;
    }).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => {
      const rendered = valueToMarkdown(v, depth + 1);
      if (rendered.includes('\n')) {
        return `**${formatKey(k)}:**\n${rendered}`;
      }
      return `**${formatKey(k)}:** ${rendered}`;
    }).join('\n\n');
  }
  return String(value);
}

function entryToMarkdown(content) {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return String(content || '');

  const lines = [];
  if (content.summary) lines.push(`*${content.summary}*\n`);
  const rest = Object.entries(content).filter(([k]) => k !== 'title' && k !== 'summary');
  for (const [key, val] of rest) {
    lines.push(`### ${formatKey(key)}\n`);
    lines.push(valueToMarkdown(val, 0));
    lines.push('');
  }
  return lines.join('\n');
}

function buildFullMarkdown(manifest, publicEntries, entryData) {
  const lines = [];
  lines.push(`# ${manifest.name}\n`);
  lines.push(`**Author:** ${manifest.author || '-'}  `);
  lines.push(`**Version:** ${manifest.version || '1.0.0'}  `);
  lines.push(`**Content type:** ${manifest.content_type || '-'}  `);
  lines.push(`**Language:** ${manifest.language || '-'}  `);
  lines.push(`**Maturity:** ${manifest.maturity || '-'}  `);
  if (manifest.created) lines.push(`**Created:** ${new Date(manifest.created).toLocaleDateString()}  `);
  if (manifest.updated) lines.push(`**Updated:** ${new Date(manifest.updated).toLocaleDateString()}  `);
  if (manifest.synthesis) {
    lines.push(`**Synthesis:** ${manifest.synthesis.level}${manifest.synthesis.model ? ' (' + manifest.synthesis.model + ')' : ''}  `);
    if (manifest.synthesis.description) lines.push(`> ${manifest.synthesis.description}`);
  }
  if (manifest.tags?.length) lines.push(`\n**Tags:** ${manifest.tags.join(', ')}`);
  if (manifest.sharing?.license) lines.push(`**License:** ${manifest.sharing.license}`);
  lines.push('\n---\n');

  for (const entry of publicEntries) {
    const entryName = entry.key.split('/').pop() || entry.key;
    const content = entryData[entryName];
    lines.push(`## ${entry.title || entryName}\n`);
    if (content) {
      lines.push(entryToMarkdown(content));
    } else {
      lines.push('*Content unavailable*');
    }
    lines.push('\n---\n');
  }

  if (manifest.references?.length) {
    lines.push('## References\n');
    for (const ref of manifest.references) {
      const title = ref.title || ref.url || 'Untitled';
      if (ref.url) {
        lines.push(`- [${title}](${ref.url})${ref.accessed ? ' -- accessed ' + new Date(ref.accessed).toLocaleDateString() : ''}`);
      } else {
        lines.push(`- ${title}`);
      }
    }
  }

  return lines.join('\n');
}

/* ── Main Component ── */

export default function PublicKnowledgeViewer() {
  const [view, setView] = useState('browse'); // 'browse' | 'detail'
  const [packageId, setPackageId] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
      setPackageId(id);
      setView('detail');
    }
  }, []);

  const openPackage = useCallback((id) => {
    setPackageId(id);
    setView('detail');
    const url = new URL(window.location);
    url.searchParams.set('id', id);
    history.pushState(null, '', url.toString());
  }, []);

  const goBack = useCallback(() => {
    setView('browse');
    setPackageId(null);
    const url = new URL(window.location);
    url.searchParams.delete('id');
    history.pushState(null, '', url.toString());
  }, []);

  useEffect(() => {
    const handler = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      if (id) {
        setPackageId(id);
        setView('detail');
      } else {
        setView('browse');
        setPackageId(null);
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return html`
    <div class="pkv-container">
      ${view === 'browse'
        ? html`<${BrowseView} onSelect=${openPackage} />`
        : html`<${DetailView} packageId=${packageId} onBack=${goBack} />`
      }
    </div>
  `;
}

/* ── Browse View ── */

function BrowseView({ onSelect }) {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [contentType, setContentType] = useState('');
  const [language, setLanguage] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const debounceRef = useRef(null);

  const loadPackages = useCallback(async (opts = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await discoverPackages({
        content_type: opts.contentType || contentType,
        tags: opts.search || search,
        language: opts.language || language,
        sort: opts.sort || sort,
        page: opts.page || page,
        limit: 20,
      });
      const items = result?.data?.packages || result?.data?.items || [];
      setPackages(opts.page > 1 ? prev => [...prev, ...items] : items);
      const total = result?.data?.total || 0;
      const perPage = result?.data?.per_page || 20;
      setHasMore((opts.page || page) * perPage < total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [contentType, language, sort, search, page]);

  useEffect(() => {
    loadPackages({ page: 1 });
  }, [contentType, language, sort]);

  const handleSearch = useCallback((e) => {
    const val = e.target.value;
    setSearch(val);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadPackages({ search: val, page: 1 });
    }, 400);
  }, [loadPackages]);

  const loadMore = useCallback(() => {
    const next = page + 1;
    setPage(next);
    loadPackages({ page: next });
  }, [page, loadPackages]);

  return html`
    <div class="pkv-header">
      <h1>${t('pkv.title')}</h1>
      <p>${t('pkv.subtitle')}</p>
    </div>

    <div class="pkv-controls">
      <input
        class="pkv-search"
        type="text"
        placeholder=${t('pkv.searchPlaceholder')}
        value=${search}
        onInput=${handleSearch}
      />
      <select class="pkv-filter-select" value=${contentType} onChange=${e => { setContentType(e.target.value); setPage(1); }}>
        <option value="">${t('pkv.allTypes')}</option>
        ${CONTENT_TYPES.map(ct => html`<option value=${ct}>${ct}</option>`)}
      </select>
      <select class="pkv-filter-select" value=${sort} onChange=${e => { setSort(e.target.value); setPage(1); }}>
        ${SORT_OPTIONS.map(s => html`<option value=${s}>${t('pkv.sort.' + s)}</option>`)}
      </select>
    </div>

    ${error && html`<div class="pkv-error">${error}</div>`}

    ${!loading && packages.length === 0 && !error && html`
      <div class="pkv-empty">
        <h3>${t('pkv.emptyTitle')}</h3>
        <p>${t('pkv.emptyDesc')}</p>
      </div>
    `}

    <div class="pkv-grid">
      ${packages.map(pkg => html`<${PackageCard} pkg=${pkg} onSelect=${onSelect} />`)}
    </div>

    ${loading && html`<div class="pkv-loading">${t('pkv.loading')}</div>`}

    ${!loading && hasMore && html`
      <div style="text-align:center; margin-top:1.5rem;">
        <button class="btn-outline" onClick=${loadMore}>${t('pkv.loadMore')}</button>
      </div>
    `}
  `;
}

/* ── Package Card ── */

function PackageCard({ pkg, onSelect }) {
  const manifest = pkg.manifest || pkg;
  const id = pkg.package_id || pkg.id || pkg.packageId || manifest.name;
  const tags = manifest.tags || [];

  return html`
    <div class="pkv-card" onClick=${() => onSelect(id)}>
      <div class="pkv-card-title">${manifest.name || id}</div>
      <div class="pkv-card-meta">
        ${manifest.content_type && html`<span class="pkv-badge pkv-badge-type">${manifest.content_type}</span>`}
        ${manifest.maturity && html`<span class="pkv-badge pkv-badge-maturity">${manifest.maturity}</span>`}
        ${manifest.language && html`<span class="pkv-badge pkv-badge-lang">${manifest.language}</span>`}
        ${manifest.entries && html`<span>${manifest.entries.length} ${t('pkv.entries')}</span>`}
      </div>
      ${tags.length > 0 && html`
        <div class="pkv-card-tags">
          ${tags.slice(0, 5).map(tag => html`<span class="pkv-tag">${tag}</span>`)}
          ${tags.length > 5 && html`<span class="pkv-tag">+${tags.length - 5}</span>`}
        </div>
      `}
      ${manifest.author && html`
        <div class="pkv-card-meta" style="margin-top:0.5rem;">
          <span>${manifest.author}</span>
        </div>
      `}
    </div>
  `;
}

/* ── Detail View ── */

function DetailView({ packageId, onBack }) {
  const [manifest, setManifest] = useState(null);
  const [reputation, setReputation] = useState(null);
  const [links, setLinks] = useState([]);
  const [entryData, setEntryData] = useState({});
  const [expandedEntries, setExpandedEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [pkgResult, repResult, linksResult, exportResult] = await Promise.allSettled([
          getPackageManifest(packageId),
          getPackageReputation(packageId),
          getPackageLinks(packageId),
          exportPackage(packageId),
        ]);
        if (cancelled) return;
        if (pkgResult.status === 'fulfilled') {
          setManifest(pkgResult.value?.data?.manifest || pkgResult.value?.data || null);
        } else {
          setError(pkgResult.reason?.message || 'Failed to load package');
        }
        if (repResult.status === 'fulfilled') {
          setReputation(repResult.value?.data || null);
        }
        if (linksResult.status === 'fulfilled') {
          const l = linksResult.value?.data?.links || linksResult.value?.data || [];
          setLinks(Array.isArray(l) ? l : []);
        }
        if (exportResult.status === 'fulfilled') {
          const ed = exportResult.value?.entry_data || exportResult.value?.data?.entry_data || {};
          setEntryData(ed);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [packageId]);

  const toggleEntry = useCallback((entryKey) => {
    setExpandedEntries(prev => ({ ...prev, [entryKey]: !prev[entryKey] }));
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const result = await exportPackage(packageId);
      const blob = new Blob([JSON.stringify(result?.data || result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${manifest?.name || packageId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  }, [packageId, manifest]);

  if (loading) return html`<div class="pkv-loading">${t('pkv.loading')}</div>`;
  if (error) return html`
    <div>
      <button class="pkv-back" onClick=${onBack}>← ${t('pkv.backToLibrary')}</button>
      <div class="pkv-error">${error}</div>
    </div>
  `;
  if (!manifest) return html`
    <div>
      <button class="pkv-back" onClick=${onBack}>← ${t('pkv.backToLibrary')}</button>
      <div class="pkv-empty"><h3>${t('pkv.notFound')}</h3></div>
    </div>
  `;

  const publicEntries = (manifest.entries || []).filter(e => e.visibility === 'public');

  return html`
    <div class="pkv-detail">
      <button class="pkv-back" onClick=${onBack}>← ${t('pkv.backToLibrary')}</button>

      <h2 class="pkv-detail-title">${manifest.name}</h2>
      <div class="pkv-detail-version">v${manifest.version || '1.0.0'}</div>

      <div class="pkv-detail-meta">
        <div class="pkv-meta-item">
          <span class="pkv-meta-label">${t('pkv.author')}</span>
          <span class="pkv-meta-value">${manifest.author || '-'}</span>
        </div>
        <div class="pkv-meta-item">
          <span class="pkv-meta-label">${t('pkv.contentType')}</span>
          <span class="pkv-meta-value">${manifest.content_type || '-'}</span>
        </div>
        <div class="pkv-meta-item">
          <span class="pkv-meta-label">${t('pkv.language')}</span>
          <span class="pkv-meta-value">${manifest.language || '-'}</span>
        </div>
        <div class="pkv-meta-item">
          <span class="pkv-meta-label">${t('pkv.maturity')}</span>
          <span class="pkv-meta-value">${manifest.maturity || '-'}</span>
        </div>
        <div class="pkv-meta-item">
          <span class="pkv-meta-label">${t('pkv.created')}</span>
          <span class="pkv-meta-value">${manifest.created ? new Date(manifest.created).toLocaleDateString() : '-'}</span>
        </div>
        <div class="pkv-meta-item">
          <span class="pkv-meta-label">${t('pkv.updated')}</span>
          <span class="pkv-meta-value">${manifest.updated ? new Date(manifest.updated).toLocaleDateString() : '-'}</span>
        </div>
      </div>

      ${manifest.synthesis && html`
        <div class="pkv-meta-item" style="margin-bottom:0.75rem;">
          <span class="pkv-meta-label">${t('pkv.synthesis')}</span>
          <span class="pkv-meta-value">${manifest.synthesis.level}${manifest.synthesis.model ? ' (' + manifest.synthesis.model + ')' : ''}</span>
        </div>
      `}

      ${manifest.tags && manifest.tags.length > 0 && html`
        <div class="pkv-card-tags" style="margin-bottom:1rem;">
          ${manifest.tags.map(tag => html`<span class="pkv-tag">${tag}</span>`)}
        </div>
      `}

      ${manifest.sharing && html`
        <div class="pkv-meta-item" style="margin-bottom:0.5rem;">
          <span class="pkv-meta-label">${t('pkv.license')}</span>
          <span class="pkv-meta-value">${manifest.sharing.license || t('pkv.noLicense')}</span>
        </div>
      `}

      ${reputation && html`
        <div class="pkv-detail-section">
          <h3>${t('pkv.reputation')}</h3>
          <div class="pkv-reputation">
            ${reputation.review_count != null && html`
              <div class="pkv-rep-item">
                <span class="pkv-rep-value">${reputation.review_count}</span>
                <span class="pkv-rep-label">${t('pkv.reviews')}</span>
              </div>
            `}
            ${reputation.average_score != null && html`
              <div class="pkv-rep-item">
                <span class="pkv-rep-value">${reputation.average_score.toFixed(1)}</span>
                <span class="pkv-rep-label">${t('pkv.avgScore')}</span>
              </div>
            `}
            ${reputation.clone_count != null && html`
              <div class="pkv-rep-item">
                <span class="pkv-rep-value">${reputation.clone_count}</span>
                <span class="pkv-rep-label">${t('pkv.clones')}</span>
              </div>
            `}
          </div>
        </div>
      `}

      ${publicEntries.length > 0 && html`
        <div class="pkv-detail-section">
          <h3>${t('pkv.publicEntries')} (${publicEntries.length})</h3>
          <div class="pkv-entries-list">
            ${publicEntries.map(entry => {
              const entryName = entry.key.split('/').pop() || entry.key;
              const content = entryData[entryName];
              return html`
                <div class="pkv-entry">
                  <div class="pkv-entry-header" onClick=${() => toggleEntry(entry.key)}>
                    <span class="pkv-entry-arrow ${expandedEntries[entry.key] ? 'expanded' : ''}">▶</span>
                    <span class="pkv-entry-title">${entry.title || entry.key}</span>
                  </div>
                  ${expandedEntries[entry.key] && html`
                    <div class="pkv-entry-content">
                      ${content
                        ? html`<${RenderEntryContent} content=${content} />`
                        : html`<span class="pkv-entry-unavailable">${t('pkv.entryUnavailable')}</span>`
                      }
                    </div>
                  `}
                </div>
              `;
            })}
          </div>
        </div>
      `}

      ${manifest.references && manifest.references.length > 0 && html`
        <div class="pkv-detail-section">
          <h3>${t('pkv.references')}</h3>
          <ul class="pkv-references">
            ${manifest.references.map(ref => html`
              <li>
                ${ref.url
                  ? html`<a href=${ref.url} target="_blank" rel="noopener">${ref.title || ref.url}</a>`
                  : html`<span>${ref.title}</span>`
                }
                ${ref.accessed && html` — ${new Date(ref.accessed).toLocaleDateString()}`}
              </li>
            `)}
          </ul>
        </div>
      `}

      ${links.length > 0 && html`
        <div class="pkv-detail-section">
          <h3>${t('pkv.relatedPackages')}</h3>
          <div class="pkv-links-list">
            ${links.map(link => html`
              <div class="pkv-link-item">
                <span class="pkv-link-relation">${link.relation}</span>
                <span>${link.target_name || link.target}</span>
              </div>
            `)}
          </div>
        </div>
      `}

      <div class="pkv-actions">
        <${CopyButton} text=${buildFullMarkdown(manifest, publicEntries, entryData)} className="btn-primary"
          label=${t('pkv.copyMarkdown')} copiedLabel=${t('pkv.copied')} />
        <button class="btn-outline" onClick=${handleExport}>${t('pkv.exportJson')}</button>
      </div>
    </div>
  `;
}
