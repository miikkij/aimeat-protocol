/**
 * @file public/views/admin/realtime-tab.js
 * @description Admin dashboard "Realtime" tab (Preact + HTM) — displays live collaboration state:
 *   active rooms with peer counts and Yjs documents, with an operator action to close a room.
 *
 * @structure
 *   - RealtimeTab({ data, reload }): default export; StatsGrid (rooms/peers/docs) + rooms & Yjs-docs tables
 *   - doClose(roomId): confirm-then-closeRoom() with toast error handling and reload
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, StatsGrid, Empty, useToast, Toast } from './shared.js';
import { closeRoom } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';

export default function RealtimeTab({ data, reload }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const rt = data.realtime;
  if (!rt) return html`<${Empty} text=${t('dashboard.realtimeUnavailable')} />`;

  const rooms = rt.rooms || [];
  const docs = rt.yjs_documents || [];

  function doClose(roomId) {
    confirm(t('dashboard.closeRoomConfirm'), async () => {
      try { await closeRoom(roomId); reload(); }
      catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${StatsGrid} items=${[
      { label: t('dashboard.activeRooms'), value: rooms.length, tone: 'cyan' },
      { label: t('dashboard.totalPeers'), value: rooms.reduce((a, r) => a + (r.peer_count || r.peers?.length || 0), 0), tone: 'green' },
      { label: t('dashboard.yjsDocs'), value: docs.length, tone: 'purple' },
    ]} />

    ${rooms.length > 0 && html`
      <div class="adm-card">
        <h4 style="margin:0 0 8px">${t('dashboard.rooms')}</h4>
        <table>
          <thead><tr>
            <th>${t('dashboard.roomId')}</th>
            <th>${t('dashboard.peers')}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${rooms.map(r => html`<tr>
              <td class="mono">${escHtml(r.id || r.room_id)}</td>
              <td>${num(r.peer_count || r.peers?.length || 0)}</td>
              <td><button class="adm-btn-sm" onClick=${() => doClose(r.id || r.room_id)}>${t('dashboard.close')}</button></td>
            </tr>`)}
          </tbody>
        </table>
      </div>
    `}

    ${docs.length > 0 && html`
      <div class="adm-card" style="margin-top:12px">
        <h4 style="margin:0 0 8px">${t('dashboard.yjsDocs')}</h4>
        <table>
          <thead><tr><th>${t('dashboard.docName')}</th><th>${t('dashboard.size')}</th></tr></thead>
          <tbody>${docs.map(d => html`<tr>
            <td class="mono">${escHtml(d.name || d.doc_name)}</td>
            <td>${d.size || '\u2014'}</td>
          </tr>`)}</tbody>
        </table>
      </div>
    `}
    <${ConfirmUI} />
  `;
}
