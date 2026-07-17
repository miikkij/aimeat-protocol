/**
 * @file public/views/profile/inbox-tab/use-thread-ux.js
 * @description Thread-pane UX hooks for the profile Inbox tab: useThreadAutoScroll (jump to the
 *   latest message on open / near-bottom follow / a single one-time jump when a NEW message arrives —
 *   never a sticky pin) and useMobileComposerKeyboard (≤760px: publishes the on-screen keyboard's
 *   height as --inbox-kb from visualViewport and scrolls the composer into view on focus).
 *   Extracted from inbox-tab.js to satisfy max-file-lines.
 * @usage import { useThreadAutoScroll, useMobileComposerKeyboard } from './inbox-tab/use-thread-ux.js';
 * @version-history
 *   v1.0.0 — 2026-07-17 — Extracted from inbox-tab.js (max-file-lines) alongside the new mobile
 *     keyboard handling + one-time new-message auto-scroll.
 */
import { useEffect, useRef } from 'preact/hooks';

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
    if (mode !== 'thread' || !el || thread.length === 0) return;
    const convKey = activeConv?.peerGhii ?? activeConv?.id ?? null;
    const lastId = thread[thread.length - 1]?.id ?? null;
    const isNewOpen = lastScrolledConvRef.current !== convKey;
    const hasNewMsg = !isNewOpen && lastMsgIdRef.current !== null && lastId !== lastMsgIdRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (isNewOpen || nearBottom || hasNewMsg) el.scrollTop = el.scrollHeight;
    lastScrolledConvRef.current = convKey;
    lastMsgIdRef.current = lastId;
    // msgsRef is a stable ref object — the content deps below are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, mode, activeConv]);
}

/** Mobile keyboard ergonomics. (1) The on-screen keyboard's height is published as --inbox-kb: on iOS
 *  the layout viewport (and thus dvh) does NOT shrink when the keyboard opens — only visualViewport
 *  does — so the ≤760px .inbox-body height subtracts this var to keep the composer above the keyboard.
 *  (2) Focusing an editable inside the composer scrolls it into view once the keyboard has settled. */
export function useMobileComposerKeyboard() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const onResize = vv ? () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--inbox-kb', `${kb}px`);
    } : null;
    if (vv && onResize) { vv.addEventListener('resize', onResize); onResize(); }
    const onFocusIn = (e) => {
      if (!window.matchMedia('(max-width: 760px)').matches) return;
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.closest('.inbox-composer')) return;
      setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* noop */ } }, 300);
    };
    window.addEventListener('focusin', onFocusIn);
    return () => {
      if (vv && onResize) vv.removeEventListener('resize', onResize);
      root.style.removeProperty('--inbox-kb');
      window.removeEventListener('focusin', onFocusIn);
    };
  }, []);
}
