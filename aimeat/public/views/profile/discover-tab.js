/**
 * @file discover-tab.js
 * @description Profile tab for the master directory — a faceted browse over GET /v1/discover. One
 *   surface to find anything on the node across every domain (capabilities, workflows, knowledge,
 *   decisions, research, material, companies + offerings, documents, apps, memory). Scope toggle
 *   (own / public / shared), free-text query, clickable type facets, and a ranked result list.
 *   Reads only via cortex-free session.fetch; re-fetches on aimeat-live-update.
 * @structure DiscoverTab() — scope + query + type-facet state → /v1/discover → result list
 * @usage registered in profile.js TABS as id 'discover'
 * @version-history
 *   v0.1.1 — 2026-07-10 — Route result clicks to each entry's real home (workspace deep-link /
 *     public viewers / SPA tab) instead of navigating to the raw /v1/ fetch href, which needs a
 *     Bearer header and rendered an auth-error JSON in the new tab.
 *   v0.1.0 — 2026-06-23 — Phase 4: human-facing master-directory browse (design doc 2026-06-23).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { EmptyState } from '/components/EmptyState.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { getSession } from '/js/services/auth.js';

const SCOPES = ['own', 'public', 'shared'];
const TYPE_ICONS = {
  capability: '\u{1F9E9}', workflow: '\u{2699}\u{FE0F}', knowledge: '\u{1F4DA}', decision: '\u{2696}\u{FE0F}',
  research: '\u{1F52C}', material: '\u{1F4E6}', company: '\u{1F3E2}', offering: '\u{1F3F7}\u{FE0F}',
  document: '\u{1F4C4}', organism: '\u{1F9EC}', app: '\u{1F4F1}', memory: '\u{1F9E0}',
};

export default function DiscoverTab() {
  const [scope, setScope] = useState('own');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [data, setData] = useState({ entries: [], total: 0, facets: { types: [], tags: [] } });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    setLoading(true);
    const params = new URLSearchParams({ scope, per_page: '50' });
    if (query.trim()) params.set('q', query.trim());
    if (typeFilter) params.set('type', typeFilter);
    try {
      const res = await session.fetch(`/v1/discover?${params.toString()}`);
      setData(res.data || { entries: [], total: 0, facets: { types: [], tags: [] } });
    } catch {
      setData({ entries: [], total: 0, facets: { types: [], tags: [] } });
    }
    setLoading(false);
  }, [scope, query, typeFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  // Open a result at its real home. The backend `href` is the canonical API *fetch* URL (for
  // agents/MCP) — navigating a browser tab there has no Bearer header and shows an auth-error
  // JSON, so clicks are routed by type instead (same handoff as notebook-tab's openHit).
  const openEntry = useCallback((entry) => {
    const id = String(entry.id || '');
    const ws = id.match(/^organism\.([^.]+)\.w\.([^.]+)\.([^.]+)\.([^.]+)/);
    if (ws) {
      const [, org, wsId, space, docId] = ws;
      if (scope === 'public') {
        window.open(
          `/v1/publicworkspaceviewer?org=${encodeURIComponent(org)}&ws=${encodeURIComponent(wsId)}` +
          `&type=${encodeURIComponent(space)}&id=${encodeURIComponent(docId)}`,
          '_blank', 'noopener'
        );
        return;
      }
      try {
        sessionStorage.setItem('aimeat.ws.openId', org);
        sessionStorage.setItem('aimeat.ws.openWs', wsId);
        sessionStorage.setItem(`aimeat.ws.${org}.${wsId}.openDoc`, JSON.stringify({ namespace: space, id: docId }));
      } catch { /* noop */ }
      window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }));
      return;
    }
    const pkg = id.match(/^packages\/([^/]+)\//);
    if (pkg) {
      window.open(`/v1/publicknowledgeviewer?id=${encodeURIComponent(pkg[1])}`, '_blank', 'noopener');
      return;
    }
    if (entry.type === 'app' && entry.href) {
      window.open(entry.href, '_blank', 'noopener');
      return;
    }
    const HOME_TAB = { capability: 'capabilities', workflow: 'workflows', organism: 'organisms', knowledge: 'knowledge' };
    window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: HOME_TAB[entry.type] || 'memory' } }));
  }, [scope]);

  const facetTypes = data.facets?.types || [];

  return html`
    <div class="pf-section">
      <div class="section-title">${t('discover.title')}</div>
      <div class="section-desc">${t('discover.desc')}</div>

      <div class="dsc-controls">
        <div class="dsc-scope">
          ${SCOPES.map(s => html`
            <button
              class=${'btn-ghost dsc-scope-btn' + (scope === s ? ' dsc-scope-active' : '')}
              onClick=${() => setScope(s)}
            >${t('discover.scope.' + s)}</button>
          `)}
        </div>
        <input
          type="text"
          class="dsc-search"
          placeholder="${t('discover.searchPlaceholder')}"
          value=${query}
          onInput=${e => setQuery(e.target.value)}
        />
      </div>

      <!-- Type facets (map mode) -->
      <div class="dsc-facets">
        <button
          class=${'dsc-facet' + (typeFilter === '' ? ' dsc-facet-active' : '')}
          onClick=${() => setTypeFilter('')}
        >${t('discover.allTypes')} (${data.total})</button>
        ${facetTypes.map(f => html`
          <button
            class=${'dsc-facet' + (typeFilter === f.value ? ' dsc-facet-active' : '')}
            onClick=${() => setTypeFilter(typeFilter === f.value ? '' : f.value)}
          >${TYPE_ICONS[f.value] || ''} ${t('discover.type.' + f.value) || f.value} (${f.count})</button>
        `)}
      </div>

      ${loading ? html`<${Spinner} />` : html`
        ${!data.entries.length
          ? html`<${EmptyState} text=${t('discover.empty')} />`
          : data.entries.map(e => html`
            <a class="dsc-item" href="#" onClick=${ev => { ev.preventDefault(); openEntry(e); }}>
              <div class="dsc-item-head">
                <span class="dsc-type-badge">${TYPE_ICONS[e.type] || ''} ${t('discover.type.' + e.type) || e.type}</span>
                <strong class="dsc-item-title">${escHtml(e.title || e.id)}</strong>
                ${e.segment ? html`<span class="dsc-segment">${escHtml(e.segment)}</span>` : ''}
              </div>
              ${e.description ? html`<div class="dsc-item-desc">${escHtml(e.description)}</div>` : ''}
              <div class="dsc-item-meta">
                ${(e.tags || []).slice(0, 6).map(tag => html`<span class="dsc-tag">${escHtml(tag)}</span>`)}
                <span class="dsc-owner">${escHtml(e.owner || '')}</span>
              </div>
            </a>
          `)}
      `}
    </div>
  `;
}
