/**
 * @file messages-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard "Messages" tab — operator visibility into direct-message (user↔user)
 *   delivery: total + 24h counts by status (delivered / queued / failed / undeliverable), the busiest
 *   target nodes, and a recent-attempts table. Privacy by design: shows NO message content and NO
 *   participant identities — only routing/outcome metadata from the delivery-telemetry log.
 * @structure MessagesTab (default) — fetches GET /v1/admin/messages/stats, re-fetches on live updates.
 * @usage Registered in admin.js NAV_GROUPS (Data group).
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial: delivery stats + target nodes + recent attempts.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { StatsGrid } from './shared.js';
import * as api from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';

const STATUSES = ['delivered', 'queued', 'failed', 'undeliverable'];
const TONE = { delivered: 'good', queued: 'warn', failed: 'bad', undeliverable: 'bad' };

function relTime(iso) {
  try {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return new Date(iso).toLocaleDateString();
  } catch (err) { swallowed('messages-tab: relTime', err); return ''; }
}

export default function MessagesTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getMessageStats();
      setData(r?.data || null); setErr(null);
    } catch (e) { setErr(e?.message || 'Failed to load'); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['messages', 'agent-messages'], () => load()), [load]);

  if (err) return html`<div class="adm-section"><div class="adm-error">${escHtml(err)}</div></div>`;
  if (!data) return html`<div class="adm-section">${t('common.loading') || 'Loading…'}</div>`;

  const s = data.stats || { total: 0, total24h: 0, byStatus: {}, byStatus24h: {}, topTargetNodes: [] };
  const recent = data.recent || [];

  const cards = [
    { label: t('admin.messages.total') || 'Total sent', value: s.total ?? 0, sub: `${s.total24h ?? 0} ${t('admin.messages.last24h') || 'in 24h'}` },
    ...STATUSES.map(st => ({
      label: t(`inbox.status.${st}`) || st,
      value: s.byStatus?.[st] ?? 0,
      sub: `${s.byStatus24h?.[st] ?? 0} ${t('admin.messages.last24h') || 'in 24h'}`,
      tone: TONE[st],
    })),
  ];

  return html`
    <div class="adm-section">
      <div class="section-title">${t('admin.messages.title') || 'Direct messages'}</div>
      <div class="section-desc">${t('admin.messages.desc') || 'Delivery telemetry for user-to-user messages. No message content or participant identities are shown.'}</div>

      <${StatsGrid} items=${cards} />

      <div class="adm-subhead">${t('admin.messages.targetNodes') || 'Top target nodes'}</div>
      ${(s.topTargetNodes || []).length === 0
        ? html`<div class="adm-muted">${t('admin.messages.none') || 'No deliveries yet.'}</div>`
        : html`<table class="data-table">
            <thead><tr>
              <th>${t('admin.messages.node') || 'Node'}</th>
              <th>${t('admin.messages.totalCol') || 'Total'}</th>
              <th>${t('admin.messages.failedCol') || 'Failed'}</th>
            </tr></thead>
            <tbody>
              ${s.topTargetNodes.map(n => html`<tr key=${n.nodeId}>
                <td class="mono">${escHtml(n.nodeId)}</td>
                <td>${n.total}</td>
                <td class=${n.failed > 0 ? 'adm-bad' : ''}>${n.failed}</td>
              </tr>`)}
            </tbody>
          </table>`}

      <div class="adm-subhead">${t('admin.messages.recent') || 'Recent attempts'}</div>
      ${recent.length === 0
        ? html`<div class="adm-muted">${t('admin.messages.none') || 'No deliveries yet.'}</div>`
        : html`<table class="data-table">
            <thead><tr>
              <th>${t('admin.messages.when') || 'When'}</th>
              <th>${t('admin.messages.origin') || 'Origin'}</th>
              <th>${t('admin.messages.node') || 'Node'}</th>
              <th>${t('admin.messages.statusCol') || 'Status'}</th>
              <th>${t('admin.messages.detail') || 'Detail'}</th>
            </tr></thead>
            <tbody>
              ${recent.map(r => html`<tr key=${r.id}>
                <td>${relTime(r.createdAt)}</td>
                <td>${escHtml(r.origin)}</td>
                <td class="mono">${escHtml(r.targetNodeId)}</td>
                <td class=${(r.status === 'failed' || r.status === 'undeliverable') ? 'adm-bad' : (r.status === 'queued' ? 'adm-warn' : 'adm-good')}>${escHtml(r.status)}</td>
                <td class="mono">${escHtml([r.httpStatus ? `http ${r.httpStatus}` : '', r.errorMessage || '', `${r.latencyMs}ms`].filter(Boolean).join(' · '))}</td>
              </tr>`)}
            </tbody>
          </table>`}
    </div>`;
}
