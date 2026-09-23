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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared set: three Sections (the counts, the target
 *     nodes, the recent attempts), the tables the shared Table, the status words in their tone; the
 *     error and loading states are the admin's shared ErrorBox and Spinner.
 *   v1.0.0 -- 2026-06-16 -- Initial: delivery stats + target nodes + recent attempts.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { escHtml } from '/js/utils.js';
import { StatsGrid, DataTable, Empty, ErrorBox, Spinner } from './shared.js';
import { Section, Text } from '/components/poster-parts.js';
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
    return fmtDate(iso);
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

  if (err) return html`<${ErrorBox} message=${escHtml(err)} />`;
  if (!data) return html`<${Spinner} text=${t('common.loading') || 'Loading…'} />`;

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

  const none = t('admin.messages.none') || 'No deliveries yet.';
  const nodes = s.topTargetNodes || [];
  const statusTone = (st) => (st === 'failed' || st === 'undeliverable') ? 'danger' : (st === 'queued' ? 'coral' : 'success');

  return html`
    <${Section} title=${t('admin.messages.title') || 'Direct messages'}
      description=${t('admin.messages.desc') || 'Delivery telemetry for user-to-user messages. No message content or participant identities are shown.'}>
      <${StatsGrid} items=${cards} />
    <//>

    <${Section} title=${t('admin.messages.targetNodes') || 'Top target nodes'} size="small">
      ${nodes.length === 0
        ? html`<${Empty} text=${none} />`
        : html`<${DataTable}
            headers=${[t('admin.messages.node') || 'Node', t('admin.messages.totalCol') || 'Total', t('admin.messages.failedCol') || 'Failed']}
            rows=${nodes.map(n => [
              { text: escHtml(n.nodeId), mono: true },
              { text: n.total, align: 'end' },
              { text: n.failed > 0 ? html`<${Text} kind="mono" tone="danger">${n.failed}<//>` : n.failed, align: 'end' },
            ])} />`}
    <//>

    <${Section} title=${t('admin.messages.recent') || 'Recent attempts'} size="small">
      ${recent.length === 0
        ? html`<${Empty} text=${none} />`
        : html`<${DataTable}
            headers=${[t('admin.messages.when') || 'When', t('admin.messages.origin') || 'Origin', t('admin.messages.node') || 'Node',
              t('admin.messages.statusCol') || 'Status', t('admin.messages.detail') || 'Detail']}
            rows=${recent.map(r => [
              relTime(r.createdAt),
              escHtml(r.origin),
              { text: escHtml(r.targetNodeId), mono: true },
              html`<${Text} kind="mono" tone=${statusTone(r.status)}>${escHtml(r.status)}<//>`,
              { text: escHtml([r.httpStatus ? `http ${r.httpStatus}` : '', r.errorMessage || '', `${r.latencyMs}ms`].filter(Boolean).join(' · ')), mono: true },
            ])} />`}
    <//>`;
}
