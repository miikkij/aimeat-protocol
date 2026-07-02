/**
 * @file NotificationBell.js
 * @description Header notification bell — shows the unread count and a dropdown of the user's
 *   in-app notifications (GET /v1/notifications). Opening the dropdown marks them read. Refreshes on
 *   the SSE `aimeat-live-update` event and a 45s poll, so a workspace-access approval (or request)
 *   surfaces without the user having to guess. Self-contained: reads the JWT from window.AIMEAT.auth.
 *   Exports openNotificationLink() — the ONE translation from a notification link/URL into SPA
 *   navigation, shared by the bell dropdown and the service-worker push-click handler (spa.html).
 * @structure
 *   - openNotificationLink(link, onNavigate) — deep-link a bell/push notification target
 *   - NotificationBell({ t, onNavigate }) — t = i18n fn, onNavigate(path) = SPA navigate.
 * @usage import { NotificationBell } from '/components/NotificationBell.js';  html`<${NotificationBell} t=${t} onNavigate=${navigate} />`
 * @version-history
 *   v1.0.0 — 2026-06-08 — Initial: header bell + dropdown + mark-read for the notification inbox.
 *   v1.0.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.1.0 — 2026-07-02 — Extract openNotificationLink() so push-notification clicks reuse the
 *     same deep-link translation as bell clicks (supports both '#hash' and '?tab=' forms).
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);

const jwt = () => { try { return window.AIMEAT?.auth?.getSession?.()?.jwt || ''; } catch { return ''; } };
async function api(path, opts = {}) {
  const token = jwt();
  if (!token) return null;
  try {
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    return await res.json();
  } catch { return null; }
}

function relTime(iso) {
  try {
    const d = new Date(iso), now = new Date(), s = Math.round((+now - +d) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return d.toLocaleDateString();
  } catch { return ''; }
}

/**
 * Deep-link a notification target into the SPA. Handles both notification link vocabularies:
 * the bell's hash form ('/v1/profile#organisms', '/v1/profile#inbox/<conversationId>') and the
 * push URL form ('/v1/profile?tab=messages#inbox/<id>'). Profile targets switch tabs in place:
 * prime sessionStorage so a cold profile mount opens the tab, navigate, then dispatch
 * aimeat-open-tab so an already-mounted profile reacts too. Anything else just navigates.
 * @param {string} link
 * @param {(path: string) => void} [onNavigate]
 */
export function openNotificationLink(link, onNavigate) {
  if (!link) return;
  let url;
  try { url = new URL(link, window.location.origin); } catch { return; }
  if (url.origin === window.location.origin && url.pathname === '/v1/profile') {
    const hashMatch = /^#([a-z]+)(?:\/(.+))?$/i.exec(url.hash || '');
    const rawTab = url.searchParams.get('tab') || (hashMatch ? hashMatch[1] : '');
    if (rawTab) {
      const tabId = rawTab.toLowerCase() === 'inbox' ? 'messages' : rawTab;
      const rest = hashMatch ? (hashMatch[2] || '') : '';
      try {
        sessionStorage.setItem('aimeat-profile-tab', JSON.stringify({ tabId, slot: 'main' }));
        if (tabId === 'messages' && rest) sessionStorage.setItem('aimeat.inbox.open', rest);
      } catch { /* noop */ }
      if (onNavigate) onNavigate('/v1/profile');
      setTimeout(() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } })), 60);
      return;
    }
  }
  // App pages ('/v1/apps/<owner>/<file>') and other non-SPA documents are served by the
  // backend (and may 301 to the isolated app origin) — a hard navigation, not SPA routing.
  if (/^\/v1\/apps\//.test(url.pathname) || /\.html$/i.test(url.pathname)) {
    window.location.assign(url.pathname + url.search + url.hash);
    return;
  }
  if (onNavigate) onNavigate(url.pathname + url.search + url.hash);
}

export function NotificationBell({ t, onNavigate }) {
  const tr = (k, fb) => (t ? t(k) : null) || fb;
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    const r = await api('/v1/notifications');
    if (r && r.data) { setItems(r.data.notifications || []); setUnread(r.data.unread || 0); }
  }, []);

  useEffect(() => {
    load();
    return onLiveUpdate(['agent-messages', 'agent-tasks', 'notifications', 'workspace-access'], () => load());
  }, [load]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      setItems(its => its.map(n => ({ ...n, read: true })));
      await api('/v1/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) });
    }
  };
  const clickNotif = (n) => {
    setOpen(false);
    openNotificationLink(n.link, onNavigate);
  };

  return html`
    <div class="notif-bell" ref=${ref}>
      <button class="notif-bell-btn" aria-label=${tr('notif.title', 'Notifications')} title=${tr('notif.title', 'Notifications')} onClick=${toggle}>
        ${'🔔'}${unread > 0 ? html`<span class="notif-badge">${unread > 99 ? '99+' : unread}</span>` : null}
      </button>
      ${open ? html`
        <div class="notif-dropdown">
          <div class="notif-dropdown-head">${tr('notif.title', 'Notifications')}</div>
          ${items.length === 0
            ? html`<div class="notif-empty">${tr('notif.empty', 'No notifications yet')}</div>`
            : items.map(n => html`
              <button class="notif-item ${n.read ? '' : 'unread'}" key=${n.id} onClick=${() => clickNotif(n)}>
                <div class="notif-item-title">${n.title}</div>
                ${n.body ? html`<div class="notif-item-body">${n.body}</div>` : null}
                <div class="notif-item-time">${relTime(n.createdAt)}</div>
              </button>`)}
        </div>` : null}
    </div>`;
}
