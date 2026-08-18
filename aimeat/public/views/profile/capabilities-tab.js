/**
 * @file capabilities-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab showing all node capabilities (auto-aggregated from extensions,
 *   cortex, actions) plus capability policy settings and optional manual creation.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial capability tab (CRUD form)
 *   v2.0.0 — 2026-05-02 — Redesigned: node capabilities listing, policy display, source filter
 *   v2.1.0 — 2026-07-17 — Replace the native alert()/confirm() with the themed useToast +
 *     useConfirm (delete now a proper danger dialog, errors a toast); the inline-styled
 *     delete button becomes .btn-danger.btn-sm.cap-delete-btn (no inline style).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { EmptyState } from '/components/EmptyState.js';
import { useToast } from '/components/Toast.js';
import { useConfirm } from '/components/Modal.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { getSession } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

const SOURCE_ICONS = { extension: '\u{1F50C}', cortex: '\u{1F9E0}', action: '\u{1F6E0}️', manual: '✍️', app: '\u{1F4F1}' };
const POLICY_LABELS = {
  publishing: { disabled: 'policyDisabled', self_only: 'policySelfOnly', moderated: 'policyModerated', open: 'policyOpen' },
  publishers: { all_users: 'policyAllUsers', trusted_only: 'policyTrustedOnly', allowlist: 'policyAllowlist' },
  webhooks: { disabled: 'policyDisabled', allowlist_only: 'policyAllowlistOnly', open: 'policyOpen' },
};

export default function CapabilitiesTab() {
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [caps, setCaps] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newCap, setNewCap] = useState({ id: '', name: '', summary: '', callable: false, visibility: 'private', tags: '' });
  const [detail, setDetail] = useState(null);

  const loadCaps = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    try {
      const res = await session.fetch('/v1/capabilities?per_page=100');
      setCaps(res.data?.capabilities || []);
      if (res.data?.policy) setPolicy(res.data.policy);
    } catch (err) { swallowed('capabilities-tab', err); setCaps([]); }
    setLoading(false);
  }, []);

  useEffect(() => { loadCaps(); }, [loadCaps]);

  useEffect(() => {
    const handler = () => loadCaps();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadCaps]);

  const handleCreate = async () => {
    const session = getSession();
    if (!session) return;
    try {
      await session.fetch('/v1/capabilities', {
        method: 'POST',
        body: JSON.stringify({
          id: newCap.id || undefined,
          name: newCap.name,
          summary: newCap.summary,
          callable: newCap.callable,
          visibility: newCap.visibility,
          source: { type: 'manual', ref: 'manual', version: '1.0.0' },
          tags: newCap.tags ? newCap.tags.split(',').map(s => s.trim()).filter(Boolean) : [],
        }),
      });
      setShowCreate(false);
      setNewCap({ id: '', name: '', summary: '', callable: false, visibility: 'private', tags: '' });
      loadCaps();
    } catch (e) {
      showToast(e.message || 'Failed to create', true);
    }
  };

  const handleDelete = (id) => {
    confirm(t('capabilities.deleteConfirm'), async () => {
      const session = getSession();
      if (!session) return;
      try {
        await session.fetch('/v1/capabilities/' + encodeURIComponent(id), { method: 'DELETE' });
        loadCaps();
      } catch (e) {
        showToast(e.message || 'Failed to delete', true);
      }
    }, { danger: true });
  };

  if (loading) return html`<${Spinner} />`;

  const filtered = caps.filter(c => {
    if (filter !== 'all' && c.source?.type !== filter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.summary?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const sourceCounts = {};
  for (const c of caps) {
    const st = c.source?.type || 'manual';
    sourceCounts[st] = (sourceCounts[st] || 0) + 1;
  }

  const canCreate = policy && policy.publishing !== 'disabled';

  return html`
    <div class="pf-section">
      <div class="section-title">${t('capabilities.nodeCapabilities')}</div>
      <div class="section-desc">${t('capabilities.nodeCapabilitiesDesc')}</div>

      <!-- Filter bar -->
      <div class="cap-filter-bar">
        <input
          type="text"
          class="cap-search-input"
          placeholder="${t('common.search') || 'Search...'}"
          value=${search}
          onInput=${e => setSearch(e.target.value)}
        />
        <select class="cap-filter-select" value=${filter} onChange=${e => setFilter(e.target.value)}>
          <option value="all">${t('capabilities.allTypes')} (${caps.length})</option>
          ${Object.entries(sourceCounts).map(([type, count]) => html`
            <option value=${type}>${SOURCE_ICONS[type] || ''} ${t('capabilities.' + type) || type} (${count})</option>
          `)}
        </select>
      </div>

      <!-- Capability list -->
      ${!filtered.length ? html`<${EmptyState} text=${t('capabilities.noCapabilities')} />` : ''}

      ${filtered.map(c => {
        const s = c.stats || {};
        const srcType = c.source?.type || 'manual';
        const icon = SOURCE_ICONS[srcType] || '';
        const isSelected = detail?.id === c.id;
        return html`
          <div class="cap-item ${isSelected ? 'cap-item-selected' : ''}" onClick=${() => setDetail(isSelected ? null : c)}>
            <div class="cap-item-header">
              <div class="cap-item-name">
                <span class="cap-source-icon">${icon}</span>
                <strong>${escHtml(c.name)}</strong>
                ${c.callable ? html`<span class="cap-badge cap-badge-callable">${t('capabilities.callable')}</span>` : ''}
                ${srcType === 'cortex' ? html`<span class="cap-badge cap-badge-browser">${t('capabilities.browserOnly')}</span>` : ''}
                ${c.status !== 'active' ? html`<span class="cap-badge cap-badge-status">${c.status}</span>` : ''}
              </div>
              <div class="cap-item-stats">
                ${s.totalInvocations ? html`<span>${s.totalInvocations} ${t('capabilities.invocations').toLowerCase()}</span>` : ''}
                ${c.trust?.vouchCount ? html`<span>${c.trust.vouchCount} ${t('capabilities.vouchCount').toLowerCase()}</span>` : ''}
              </div>
            </div>
            ${c.summary ? html`<div class="cap-item-summary">${escHtml(c.summary)}</div>` : ''}
            ${(c.tags || []).length ? html`
              <div class="cap-item-tags">
                ${c.tags.map(tag => html`<span class="cap-tag">${escHtml(tag)}</span>`)}
              </div>
            ` : ''}

            ${isSelected ? html`
              <div class="cap-detail" onClick=${e => e.stopPropagation()}>
                <div class="cap-detail-row"><span class="cap-detail-label">ID:</span> <code class="cap-detail-code">${c.id}</code></div>
                <div class="cap-detail-row"><span class="cap-detail-label">${t('capabilities.source')}:</span> ${srcType} ${c.source?.ref ? html` — <code class="cap-detail-code">${c.source.ref}</code>` : ''}</div>
                <div class="cap-detail-row"><span class="cap-detail-label">${t('capabilities.visibility')}:</span> ${c.visibility === 'public' ? '\u{1F310} Public' : '\u{1F512} Private'}</div>
                <div class="cap-detail-row"><span class="cap-detail-label">${t('capabilities.authRequired')}:</span> ${c.authRequired || 'registered'}</div>
                ${c.usage ? html`<div class="cap-detail-row"><span class="cap-detail-label">Usage:</span> <code class="cap-detail-code">${c.usage}</code></div>` : ''}
                ${c.whenToUse ? html`<div class="cap-detail-row"><span class="cap-detail-label">When to use:</span> ${escHtml(c.whenToUse)}</div>` : ''}
                ${s.totalInvocations ? html`
                  <div class="cap-detail-row">
                    <span class="cap-detail-label">Stats:</span>
                    ${s.totalInvocations} calls, ${s.successCount} ok, ${s.errorCount} errors
                    ${s.avgResponseMs ? html` — avg ${Math.round(s.avgResponseMs)}ms` : ''}
                  </div>
                ` : ''}
                ${c.inputSchema && Object.keys(c.inputSchema).length > 1 ? html`
                  <details class="cap-schema-details">
                    <summary>Input Schema</summary>
                    <pre class="cap-schema-pre">${JSON.stringify(c.inputSchema, null, 2)}</pre>
                  </details>
                ` : ''}
                ${c.outputSchema && Object.keys(c.outputSchema).length > 1 ? html`
                  <details class="cap-schema-details">
                    <summary>Output Schema</summary>
                    <pre class="cap-schema-pre">${JSON.stringify(c.outputSchema, null, 2)}</pre>
                  </details>
                ` : ''}
                ${c.source?.type === 'manual' ? html`
                  <button class="btn-danger btn-sm cap-delete-btn" onClick=${() => handleDelete(c.id)}>
                    ${t('capabilities.delete')}
                  </button>
                ` : ''}
              </div>
            ` : ''}
          </div>
        `;
      })}

      <!-- How capabilities are created -->
      <div class="cap-info-section">
        <div class="cap-info-title">${t('capabilities.howCreated')}</div>
        <div class="cap-info-desc">${t('capabilities.howCreatedDesc')}</div>
      </div>

      <!-- Policy settings -->
      ${policy ? html`
        <div class="cap-info-section">
          <div class="cap-info-title">${t('capabilities.policyTitle')}</div>
          <div class="cap-policy-grid">
            <div class="cap-policy-item">
              <span class="cap-policy-label">${t('capabilities.policyPublishing')}</span>
              <span class="cap-policy-value">${t('capabilities.' + (POLICY_LABELS.publishing[policy.publishing] || 'policyDisabled'))}</span>
            </div>
            <div class="cap-policy-item">
              <span class="cap-policy-label">${t('capabilities.policyPublishers')}</span>
              <span class="cap-policy-value">${t('capabilities.' + (POLICY_LABELS.publishers[policy.publishers] || 'policyAllUsers'))}</span>
            </div>
            <div class="cap-policy-item">
              <span class="cap-policy-label">${t('capabilities.policyWebhooks')}</span>
              <span class="cap-policy-value">${t('capabilities.' + (POLICY_LABELS.webhooks[policy.webhooks] || 'policyDisabled'))}</span>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Create manual capability (if allowed) -->
      ${canCreate ? html`
        <div class="cap-create-section">
          <button class="btn-outline" onClick=${() => setShowCreate(!showCreate)}>
            ${showCreate ? t('common.cancel') : t('capabilities.create')}
          </button>
          ${showCreate ? html`
            <div class="cap-create-form">
              <input class="cap-form-input" placeholder="ID (optional)" value=${newCap.id} onInput=${e => setNewCap({ ...newCap, id: e.target.value })} />
              <input class="cap-form-input" placeholder=${t('capabilities.name')} value=${newCap.name} onInput=${e => setNewCap({ ...newCap, name: e.target.value })} />
              <textarea class="cap-form-input" placeholder=${t('capabilities.summary')} value=${newCap.summary} onInput=${e => setNewCap({ ...newCap, summary: e.target.value })} rows="2" />
              <input class="cap-form-input" placeholder="Tags (comma-separated)" value=${newCap.tags} onInput=${e => setNewCap({ ...newCap, tags: e.target.value })} />
              <label class="cap-form-checkbox">
                <input type="checkbox" checked=${newCap.callable} onChange=${e => setNewCap({ ...newCap, callable: e.target.checked })} />
                ${t('capabilities.callable')}
              </label>
              <select class="cap-form-input" value=${newCap.visibility} onChange=${e => setNewCap({ ...newCap, visibility: e.target.value })}>
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
              <button class="btn-primary" onClick=${handleCreate} disabled=${!newCap.name}>
                ${t('capabilities.create')}
              </button>
            </div>
          ` : ''}
        </div>
      ` : ''}
      <${ToastContainer} />
      <${ConfirmUI} />
    </div>
  `;
}
