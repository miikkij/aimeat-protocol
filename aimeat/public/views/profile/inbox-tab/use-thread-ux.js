/**
 * @file public/views/profile/inbox-tab/use-thread-ux.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Thread-pane UX hooks for the profile Inbox tab: useThreadAutoScroll (jump to the
 *   latest message on open / near-bottom follow / a single one-time jump when a NEW message arrives —
 *   never a sticky pin), useMobileComposerKeyboard (≤760px: publishes the on-screen keyboard's
 *   height as --inbox-kb from visualViewport and scrolls the composer into view on focus) and
 *   useAttachmentUrlRefresh (re-mints expiring presigned attachment URLs while a thread is open).
 *   Extracted from inbox-tab.js to satisfy max-file-lines.
 * @usage import { useThreadAutoScroll, useMobileComposerKeyboard } from './inbox-tab/use-thread-ux.js';
 * @version-history
 *   v1.6.0 — 2026-08-18 — useMobileComposerKeyboard also measures the DESKTOP pane: --inbox-desk-avail
 *     is the real distance from the messenger top edge to the bottom of the window, so the pane stops
 *     guessing how much shell sits above it.
 *   v1.5.0 — 2026-08-04 — Add useAttachmentUrlRefresh: while a thread is open, a 15 min tick re-mints
 *     presigned attachment URLs approaching their 1 h token expiry — a download click in a long-open
 *     tab hit a dead token (410 → the browser's bare "Couldn't download"). useRecentBroadcasts moved
 *     here from inbox-tab.js (max-file-lines).
 *   v1.4.0 — 2026-07-21 — useThreadAutoScroll: on OPEN, keep re-pinning to the bottom for ~2.5s while late
 *     content (images, link previews, long histories) grows the thread, instead of a single jump that left
 *     a big thread stuck partway up. Re-pins only on real height growth; aborts the moment the reader
 *     scrolls up.
 *   v1.3.0 — 2026-07-21 — Add useLinkPreviewToggle: persisted global on/off for the message link-preview
 *     cards (default ON); the ThreadPanel head button flips it.
 *   v1.2.0 — 2026-07-19 — useThreadAutoScroll now suppresses the one-time new-message jump while the
 *     composer is focused (near-bottom follow still applies). This lets the inbox reload the open thread
 *     on EVERY 'messages' live-update — so incoming messages render immediately even while you're typing
 *     a reply — without yanking the scroll/caret (the old fix instead skipped the whole reload).
 *   v1.0.0 — 2026-07-17 — Extracted from inbox-tab.js (max-file-lines) alongside the new mobile
 *     keyboard handling + one-time new-message auto-scroll.
 *   v1.1.0 — 2026-07-18 — Rework useMobileComposerKeyboard(mode): MEASURE available height (body top →
 *     visualViewport bottom) as `--inbox-avail` instead of the `dvh − keyboard` double-count that collapsed
 *     the messenger on Android Chrome; drop the composer scrollIntoView(center) that left a dead gap.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { resolveThreadAttachmentUrls } from './helpers.js';
import { attachmentUrl } from '/js/services/messages.js';

const LINK_PREVIEWS_KEY = 'aimeat.inbox.linkPreviews';
const BC_STORE = 'aimeat.inbox.broadcasts';

/** Recent broadcasts/polls the user sent — tracked in localStorage so results stay re-accessible.
 *  Moved here from inbox-tab.js (max-file-lines). */
export function useRecentBroadcasts() {
  const [recentBroadcasts, setRecentBroadcasts] = useState([]);
  useEffect(() => { try { setRecentBroadcasts(JSON.parse(localStorage.getItem(BC_STORE) || '[]')); } catch { /* none */ } }, []);   // eslint-disable-line aimeat/no-silent-catch -- none
  const trackBroadcast = (entry) => setRecentBroadcasts(prev => {
    const next = [entry, ...prev.filter(b => b.id !== entry.id)].slice(0, 30);
    try { localStorage.setItem(BC_STORE, JSON.stringify(next)); } catch { /* quota */ }   // eslint-disable-line aimeat/no-silent-catch -- quota
    return next;
  });
  return { recentBroadcasts, trackBroadcast };
}

/** Presigned attachment URLs carry a 1 h token. While a thread stays open (no reload, no SSE
 *  traffic), the links in the DOM would outlive their tokens and every download click would fail.
 *  A 15 min tick re-runs the resolver: entries younger than the reuse window (helpers.
 *  ATTACHMENT_URL_REUSE_MS) come back from cache (no network), entries approaching expiry get a
 *  fresh token before it dies. */
export function useAttachmentUrlRefresh(activeConv, activeConvRef, threadRef, urlCacheRef, setUrlMap) {
  useEffect(() => {
    if (!activeConv) return undefined;
    const iv = setInterval(async () => {
      const conv = activeConvRef.current;
      if (!conv) return;
      const prevMap = urlCacheRef.current.map || {};
      const cache = await resolveThreadAttachmentUrls(threadRef.current, conv.conversationId, urlCacheRef.current, attachmentUrl);
      if (activeConvRef.current?.conversationId !== conv.conversationId) return;   // user switched threads mid-fetch
      urlCacheRef.current = cache;
      // Only re-render when a URL actually changed — an all-fresh tick must not touch <img>/<audio> src.
      const keys = Object.keys(cache.map);
      if (keys.length !== Object.keys(prevMap).length || keys.some(k => cache.map[k] !== prevMap[k])) setUrlMap(cache.map);
    }, 15 * 60 * 1000);
    return () => clearInterval(iv);
    // The refs are stable — the open conversation is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv]);
}

/** Persisted global toggle for the link-preview cards (default ON). Returns the flag + a toggler that
 *  writes the choice to localStorage. Per-card dismissal is owned separately by /components/LinkPreview.js. */
export function useLinkPreviewToggle() {
  const [showLinkPreviews, setShow] = useState(() => {
    try { return localStorage.getItem(LINK_PREVIEWS_KEY) !== 'off'; } catch { return true; }
  });
  const toggleLinkPreviews = () => setShow((v) => {
    try { localStorage.setItem(LINK_PREVIEWS_KEY, v ? 'off' : 'on'); } catch { /* quota */ }   // eslint-disable-line aimeat/no-silent-catch -- quota
    return !v;
  });
  return { showLinkPreviews, toggleLinkPreviews };
}

/** Auto-scroll policy for the open thread: jump to the latest message when a thread is OPENED, follow
 *  when the reader is already near the bottom, and when a genuinely NEW message arrives (last message
 *  id changed) jump down ONCE — a single jump, not a sticky pin, so scrolling back up afterwards is
 *  never fought. Content-only refreshes (same last message — receipts, url re-resolves) never move the
 *  scroll. lastScrolledConvRef distinguishes a fresh open from an in-place update, and we wait for
 *  content (thread.length) so an async load still lands at the bottom on open. */
export function useThreadAutoScroll(msgsRef, mode, thread, activeConv) {
  const lastScrolledConvRef = useRef(null);
  const lastMsgIdRef = useRef(null);
  useEffect(() => {
    const el = msgsRef.current;
    if (mode !== 'thread' || !el || thread.length === 0) return undefined;
    const convKey = activeConv?.peerGhii ?? activeConv?.id ?? null;
    const lastId = thread[thread.length - 1]?.id ?? null;
    const isNewOpen = lastScrolledConvRef.current !== convKey;
    const hasNewMsg = !isNewOpen && lastMsgIdRef.current !== null && lastId !== lastMsgIdRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    // While you're typing a reply, a live-updated new message must still RENDER but must not yank the
    // scroll out from under the caret — so suppress the one-time new-message jump when the composer is
    // focused (near-bottom follow still applies: if you were already at the bottom you keep following).
    const ae = typeof document !== 'undefined' ? document.activeElement : null;
    const composing = ae instanceof HTMLElement && !!ae.closest('.inbox-composer');
    lastScrolledConvRef.current = convKey;
    lastMsgIdRef.current = lastId;

    if (isNewOpen) {
      // Opening a thread: jump to the newest message, then KEEP re-pinning to the bottom for a short
      // window. The final bottom isn't known yet at this point — late content grows the thread (images,
      // link-preview cards, markdown) AND the pane's own height changes as the composer/keyboard settle,
      // either of which opens a gap the single jump can't catch (and the effect won't re-fire — urlMap
      // isn't a dep). So each frame: if a gap has opened, re-pin. `expected` tracks our own set so a real
      // user scroll (which moves away from it) aborts the loop instead of being fought.
      el.scrollTop = el.scrollHeight;
      let raf = 0, expected = el.scrollTop, aborted = false;
      const deadline = performance.now() + 2500;
      const onScroll = () => { if (Math.abs(el.scrollTop - expected) > 40) aborted = true; };
      el.addEventListener('scroll', onScroll, { passive: true });
      const stop = () => { cancelAnimationFrame(raf); el.removeEventListener('scroll', onScroll); };
      const step = (now) => {
        if (aborted) { stop(); return; }
        if (el.scrollHeight - el.scrollTop - el.clientHeight > 4) { el.scrollTop = el.scrollHeight; expected = el.scrollTop; }
        if (now < deadline) raf = requestAnimationFrame(step); else stop();
      };
      raf = requestAnimationFrame(step);
      return stop;   // cancel the pin loop if the thread changes / unmounts
    }
    if (nearBottom || (hasNewMsg && !composing)) el.scrollTop = el.scrollHeight;
    return undefined;
    // msgsRef is a stable ref object — the content deps below are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, mode, activeConv]);
}

/** Mobile keyboard ergonomics — the reliable version. Rather than the fragile `dvh − keyboard` math (which
 *  double-counted on Android Chrome, where dvh ALSO shrinks for the keyboard → the messenger collapsed and
 *  left a big dead gap above the keyboard), we MEASURE the real space: from the top of `.inbox-body` down to
 *  the bottom of the visual viewport (which excludes the keyboard on every platform), and publish it as
 *  `--inbox-avail`. The ≤760px open-panel body height uses that, so the composer sits right on the keyboard
 *  with the thread filling the rest — no void, no page-scroll jump. We deliberately do NOT scrollIntoView the
 *  composer (that centered it and created the gap); instead we keep the message list pinned to the bottom.
 *  Only active on mobile with a thread/compose panel open; otherwise the var is cleared and CSS falls back. */
export function useMobileComposerKeyboard(mode) {
  const syncRef = useRef(() => {});
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;
    const sync = () => {
      const body = document.querySelector('.inbox-body');
      if (!body) { root.style.removeProperty('--inbox-avail'); root.style.removeProperty('--inbox-desk-avail'); return; }

      // DESKTOP: the messenger used to be `100vh - 300px`, a guess at how much shell sits above it.
      // Measured on a 1280x900 window it left 94px of dead space below the pane AND still scrolled the
      // page, while the conversation itself got 229px. The distance to the top edge is a thing the
      // browser knows, so ask it instead of guessing: everything below the pane is the pane's.
      if (!isNarrow()) {
        root.style.removeProperty('--inbox-avail');
        const top = body.getBoundingClientRect().top;
        // The gap that keeps the pane off the bottom edge, matching .pf-content's own padding.
        const avail = Math.max(320, Math.round(window.innerHeight - top - 20));
        root.style.setProperty('--inbox-desk-avail', `${avail}px`);
        return;
      }
      root.style.removeProperty('--inbox-desk-avail');
      if (!vv || !body.classList.contains('inbox-body--panel')) {
        root.style.removeProperty('--inbox-avail');
        return;
      }
      // Distance from the body's top edge to the top of the visible (keyboard-excluded) area, then the
      // remaining height below it. Clamp so a mid-animation reading can't collapse the pane.
      const top = body.getBoundingClientRect().top - (vv.offsetTop || 0);
      const avail = Math.max(220, Math.round(vv.height - top));
      root.style.setProperty('--inbox-avail', `${avail}px`);
    };
    syncRef.current = sync;
    const onFocusIn = (e) => {
      if (!isNarrow()) return;
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.closest('.inbox-composer')) return;
      // The keyboard animates in — re-measure as the viewport settles, then keep the latest messages in view.
      setTimeout(sync, 120); setTimeout(sync, 360);
      setTimeout(() => { const m = document.querySelector('.inbox-msgs'); if (m) m.scrollTop = m.scrollHeight; }, 380);
    };
    if (vv) { vv.addEventListener('resize', sync); vv.addEventListener('scroll', sync); }
    window.addEventListener('resize', sync);
    window.addEventListener('focusin', onFocusIn);
    sync();
    return () => {
      if (vv) { vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync); }
      window.removeEventListener('resize', sync);
      window.removeEventListener('focusin', onFocusIn);
      root.style.removeProperty('--inbox-avail');
    };
  }, []);
  // Re-measure when the panel opens/closes (mode change) — no viewport event fires on a pure route switch.
  useEffect(() => {
    const raf = requestAnimationFrame(() => syncRef.current());
    const t = setTimeout(() => syncRef.current(), 220);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [mode]);
}
