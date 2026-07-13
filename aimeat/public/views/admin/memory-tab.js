/**
 * @file memory-tab.js
 * @description Admin dashboard tab for browsing and managing all memory keys
 *   across all owners. Provides filtering, pagination, expandable value preview,
 *   and delete functionality.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial implementation
 *   v1.1.0 — 2026-06-02 — Admin design unification: fix the broken useToast wiring
 *     (array hook was used as an object via .show()/.current/.dismiss — toasts never
 *     rendered and delete threw); now canonical [msg,showErr,showOk,clear] + correct
 *     <Toast>. The bespoke adm-mem-stat summary → canonical <StatsGrid>.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Empty, StatsGrid, useToast, Toast } from './shared.js';
import { getAdminMemory, deleteAdminMemory } from '/js/services/admin.js';

const PAGE_SIZE = 50;

export default function MemoryTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  // Filters
  const [ownerFilter, setOwnerFilter] = useState('');
  const [prefixFilter, setPrefixFilter] = useState('');
  const [visFilter, setVisFilter] = useState('');

  // Expanded rows
  const [expanded, setExpanded] = useState({});

  const [toast, showErr, showOk, clearToast] = useToast();

  const loadMemory = useCallback(async (off = 0, { showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const params = { limit: PAGE_SIZE, offset: off };
      if (ownerFilter.trim()) params.owner = ownerFilter.trim();
      if (prefixFilter.trim()) params.prefix = prefixFilter.trim();
      if (visFilter) params.visibility = visFilter;
      const r = await getAdminMemory(params);
      if (r.data) {
        setItems(r.data.items || []);
        setTotal(r.data.total || 0);
        setOffset(off);
      }
    } catch (e) {
      console.warn('Failed to load memory:', e.message);
    }
    setLoading(false);
  }, [ownerFilter, prefixFilter, visFilter]);

  useEffect(() => { loadMemory(0); }, [loadMemory]);

  // Listen for live updates
  useEffect(() => onLiveUpdate(['memory'], () => loadMemory(offset, { showSpinner: false })), [loadMemory, offset]);

  function toggleExpand(idx) {
    setExpanded(prev => {
      const n = { ...prev };
      if (n[idx]) { delete n[idx]; } else { n[idx] = true; }
      return n;
    });
  }

  async function handleDelete(ownerGaii, key) {
    if (!confirm(t('dashboard.memoryDeleteConfirm'))) return;
    try {
      await deleteAdminMemory(ownerGaii, key);
      showOk(t('dashboard.memoryDeleted'));
      loadMemory(offset);
    } catch (e) {
      showErr(e.message);
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    setOffset(0);
    loadMemory(0);
  }

  function fmtSize(val) {
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    const bytes = new Blob([str]).size;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Visibility stats from current page context
  const visCounts = {};
  items.forEach(m => {
    visCounts[m.visibility] = (visCounts[m.visibility] || 0) + 1;
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return html`
    <div>
      ${toast && html`<${Toast} type=${toast.type} text=${toast.text} onDismiss=${clearToast} />`}

      <!-- Stats summary -->
      <${StatsGrid} items=${[
        { label: t('dashboard.memoryTotal'), value: total },
        ...Object.entries(visCounts).map(([vis, count]) => ({ label: vis, value: count })),
      ]} />

      <!-- Filter bar -->
      <form class="adm-mem-filters" onSubmit=${handleSearch}>
        <input
          type="text"
          class="adm-input"
          placeholder=${t('dashboard.memoryFilterOwner')}
          value=${ownerFilter}
          onInput=${e => setOwnerFilter(e.target.value)}
        />
        <input
          type="text"
          class="adm-input"
          placeholder=${t('dashboard.memoryFilterPrefix')}
          value=${prefixFilter}
          onInput=${e => setPrefixFilter(e.target.value)}
        />
        <select class="adm-input" value=${visFilter} onChange=${e => setVisFilter(e.target.value)}>
          <option value="">${t('dashboard.memoryVisibility')} (${t('dashboard.all') || 'All'})</option>
          <option value="private">private</option>
          <option value="owner">owner</option>
          <option value="group">group</option>
          <option value="public">public</option>
        </select>
        <button type="submit" class="adm-btn" disabled=${loading}>
          ${loading ? t('dashboard.loading') : t('dashboard.memorySearch')}
        </button>
      </form>

      <!-- Table -->
      ${items.length === 0 && !loading && html`<${Empty} text=${t('dashboard.memoryNoResults')} />`}

      ${items.length > 0 && html`
        <div class="adm-card">
          <div class="scrollable">
            <table>
              <thead><tr>
                <th>${t('dashboard.memoryOwner')}</th>
                <th>${t('dashboard.memoryKey')}</th>
                <th>${t('dashboard.memoryVisibility')}</th>
                <th>${t('dashboard.memoryVersion')}</th>
                <th>${t('dashboard.memoryUpdated')}</th>
                <th>${t('dashboard.memorySize')}</th>
                <th></th>
              </tr></thead>
              <tbody>
                ${items.map((m, i) => html`
                  <tr>
                    <td class="mono" style="font-size:.8rem">${escHtml(m.owner_gaii)}</td>
                    <td class="mono">${escHtml(m.key)}</td>
                    <td><span class="tag">${m.visibility}</span></td>
                    <td>${m.version}</td>
                    <td style="color:var(--text-dim)">${dt(m.updated_at)}</td>
                    <td style="color:var(--text-dim)">${fmtSize(m.value)}</td>
                    <td>
                      <button class="adm-btn-sm" onClick=${() => toggleExpand(i)}>
                        ${expanded[i] ? t('dashboard.hide') : t('dashboard.details')}
                      </button>
                      <button class="adm-btn-sm adm-btn-danger" onClick=${() => handleDelete(m.owner_gaii, m.key)}>
                        ${t('dashboard.delete')}
                      </button>
                    </td>
                  </tr>
                  ${expanded[i] && html`<tr><td colspan="7">
                    <div class="adm-sub-panel">
                      <div class="adm-mem-value-label">${t('dashboard.memoryValue')}:</div>
                      <pre class="adm-mem-value">${JSON.stringify(m.value, null, 2)}</pre>
                      ${m.tags?.length > 0 && html`
                        <div style="margin-top:6px">Tags: ${m.tags.map(tg => html`<span class="tag">${escHtml(tg)}</span> `)}</div>
                      `}
                      ${m.flag_count > 0 && html`
                        <div style="margin-top:4px;color:var(--warning)">Flags: ${m.flag_count}</div>
                      `}
                    </div>
                  </td></tr>`}
                `)}
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          ${totalPages > 1 && html`
            <div class="adm-mem-pagination">
              <button class="adm-btn-sm"
                disabled=${offset === 0}
                onClick=${() => loadMemory(Math.max(0, offset - PAGE_SIZE))}>
                \u2190 ${t('dashboard.prev') || 'Prev'}
              </button>
              <span class="adm-mem-page-info">${currentPage} / ${totalPages}</span>
              <button class="adm-btn-sm"
                disabled=${offset + PAGE_SIZE >= total}
                onClick=${() => loadMemory(offset + PAGE_SIZE)}>
                ${t('dashboard.next') || 'Next'} \u2192
              </button>
            </div>
          `}
        </div>
      `}
    </div>
  `;
}
