/**
 * @file public/views/profile/inbox-tab/use-thread-ux.js
 * @description Thread-pane UX hooks for the profile Inbox tab: useThreadAutoScroll (jump to the
 *   latest message on open / near-bottom follow / a single one-time jump when a NEW message arrives —
 *   never a sticky pin) and useMobileComposerKeyboard (≤760px: publishes the on-screen keyboard's
 *   height as --inbox-kb from visualViewport and scrolls the composer into view on focus).
 *   Extracted from inbox-tab.js to satisfy max-file-lines.
 * @usage import { useThreadAutoScroll, useMobileComposerKeyboard } from './inbox-tab/use-thread-ux.js';
 * @version-history
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
    // While you're typing a reply, a live-updated new message must still RENDER but must not yank the
    // scroll out from under the caret — so suppress the one-time new-message jump when the composer is
    // focused (near-bottom follow still applies: if you were already at the bottom you keep following).
    const ae = typeof document !== 'undefined' ? document.activeElement : null;
    const composing = ae instanceof HTMLElement && !!ae.closest('.inbox-composer');
    if (isNewOpen || nearBottom || (hasNewMsg && !composing)) el.scrollTop = el.scrollHeight;
    lastScrolledConvRef.current = convKey;
    lastMsgIdRef.current = lastId;
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
      if (!vv || !body || !isNarrow() || !body.classList.contains('inbox-body--panel')) {
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
