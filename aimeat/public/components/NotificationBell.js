/**
 * @file NotificationBell.js
 * @description Header notification bell — shows the unread count and a dropdown of the user's
 *   in-app notifications (GET /v1/notifications). Opening the dropdown marks them read. Refreshes on
 *   the SSE `aimeat-live-update` event and a 45s poll, so a workspace-access approval (or request)
 *   surfaces without the user having to guess. Self-contained: reads the JWT from window.AIMEAT.auth.
 * @structure NotificationBell({ t, onNavigate }) — t = i18n fn, onNavigate(path) = SPA navigate.
 * @usage import { NotificationBell } from '/components/NotificationBell.js';  html`<${NotificationBell} t=${t} onNavigate=${navigate} />`
 * @version-history
 *   v1.0.0 — 2026-06-08 — Initial: header bell + dropdown + mark-read for the notification inbox.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
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
    const d = new Date(iso), now = new Date(), s = Math.round((now - d) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return d.toLocaleDateString();
  } catch { return ''; }
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
    const onUpd = () => load();
    window.addEventListener('aimeat-live-update', onUpd);
    const iv = setInterval(load, 45000);
    return () => { window.removeEventListener('aimeat-live-update', onUpd); clearInterval(iv); };
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
    if (!n.link) return;
    // Profile tab deep-links carry a #hash that the SPA router ignores (it matches on pathname
    // only). Translate them into the profile's tab-open mechanism: prime sessionStorage so a cold
    // mount opens the tab, navigate to the profile, then dispatch aimeat-open-tab so an
    // already-mounted profile reacts too. `#inbox[/<conversationId|requests>]` opens that thread.
    const m = /\/v1\/profile#([a-z]+)(?:\/(.+))?$/i.exec(n.link);
    if (m) {
      const tabId = m[1] === 'inbox' ? 'messages' : m[1];
      const rest = m[2] || '';
      try {
        sessionStorage.setItem('aimeat-profile-tab', JSON.stringify({ tabId, slot: 'main' }));
        if (tabId === 'messages' && rest) sessionStorage.setItem('aimeat.inbox.open', rest);
      } catch { /* noop */ }
      if (onNavigate) onNavigate('/v1/profile');
      setTimeout(() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } })), 60);
      return;
    }
    if (onNavigate) onNavigate(n.link);
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
