/**
 * @file public/js/open-item.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Open one thing on a Settings & Controls page from elsewhere: an agent's card, a
 *   schedule, a workflow, a company, a contact, a skill, an extension. The caller primes the item in
 *   sessionStorage (read when the page mounts) and sends the window event `aimeat-open-item` (heard
 *   when the page is already open), and asks for the page with `aimeat-open-tab`. A page takes it
 *   with one line, useOpenItem(tabId, open, ready): `open(id)` runs once the page's data has loaded
 *   (`ready`), so an item asked for before its list arrived still opens. A shared place and its
 *   workspaces keep the Organisms page's own way in (openOrganism). First user: the menu find
 *   (components/MenuFind.js).
 * @structure openItem(tabId, id) · useOpenItem(tabId, open, ready) · openOrganism(orgId, wsId) ·
 *   scrollToElementSoon(selector)
 * @usage openItem('scheduler', scheduleId);
 *        useOpenItem('scheduler', (id) => pickView({ kind: 'detail', id }), !loading);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (the menu find finds your own things; Jouni searched an agent's
 *     name and the find found nothing).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { swallowed } from '/js/swallowed.js';
import { scrollToElement } from '/components/Rail.js';

const KEY = 'aimeat.open.item';

/**
 * Ask a Settings page to open one of its items.
 * @param {string} tabId the page (profile tab id)
 * @param {string} id the item's id on that page
 */
export function openItem(tabId, id) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ tabId, id })); } catch (err) { swallowed('open-item: prime', err); }
  window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
  window.dispatchEvent(new CustomEvent('aimeat-open-item', { detail: { tabId, id } }));
}

/**
 * A page takes the item asked for: primed before it mounted, or sent while it is open.
 * @param {string} tabId this page's tab id
 * @param {(id: string) => void} open opens the item
 * @param {boolean} [ready] the page's data has loaded; the item waits until then
 */
export function useOpenItem(tabId, open, ready = true) {
  const pending = useRef(/** @type {string|null} */ (null));
  const openRef = useRef(open);
  openRef.current = open;
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v && v.tabId === tabId) { sessionStorage.removeItem(KEY); pending.current = String(v.id); setAsked((n) => n + 1); }
    } catch (err) { swallowed('open-item: read', err); }
    const onItem = (e) => {
      if (e.detail?.tabId !== tabId) return;
      try { sessionStorage.removeItem(KEY); } catch (err) { swallowed('open-item: consume', err); }
      pending.current = String(e.detail.id);
      setAsked((n) => n + 1);
    };
    window.addEventListener('aimeat-open-item', onItem);
    return () => window.removeEventListener('aimeat-open-item', onItem);
  }, [tabId]);

  useEffect(() => {
    if (!ready || pending.current === null) return;
    const id = pending.current;
    pending.current = null;
    openRef.current(id);
  }, [ready, asked]);
}

/**
 * Open a shared place, or one workspace in it, the way the Organisms page is opened from elsewhere
 * (the command palette does the same): primed for a page that mounts, an event for one already open.
 * @param {string} orgId
 * @param {string} [wsId]
 */
export function openOrganism(orgId, wsId) {
  try {
    sessionStorage.setItem('aimeat.ws.openId', orgId);
    if (wsId) sessionStorage.setItem('aimeat.ws.openWs', wsId); else sessionStorage.removeItem('aimeat.ws.openWs');
  } catch (err) { swallowed('open-item: prime organism', err); }
  window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'organisms' } }));
  window.dispatchEvent(new CustomEvent('aimeat-open-organism', { detail: { orgId, wsId: wsId || null } }));
}

/**
 * Bring an element into view once its page has drawn it (an agent's card after the list loads),
 * for four seconds at most.
 * @param {string} selector
 */
export function scrollToElementSoon(selector) {
  let tries = 0;
  const look = () => {
    const el = document.querySelector(selector);
    if (el) { scrollToElement(el); return; }
    if (++tries < 40) setTimeout(look, 100);
  };
  setTimeout(look, 60);
}
