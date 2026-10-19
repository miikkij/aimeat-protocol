/**
 * @file public/js/visual-viewport.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The part of the page a person can actually see on a phone, published as two CSS
 *   variables on <html>: --vv-top (how far the visible area is scrolled down the page) and
 *   --vv-height (how tall it is, without the on-screen keyboard). A full-screen phone conversation
 *   (the inbox's open pane, the chat) sets `top: var(--vv-top)` and `height: var(--vv-height)`, so
 *   its composer sits on the keyboard on every phone.
 *
 *   WHY NOT A HEIGHT ALONE. Both surfaces used to be `position: fixed; inset: 0` with a measured
 *   height. That holds where the keyboard shrinks the page itself, which is Android Chrome honouring
 *   the viewport meta's interactive-widget=resizes-content. iOS Safari and an app installed to the
 *   home screen do not honour it: the keyboard covers the page and the browser scrolls the visible
 *   area down to the focused field, so a pane pinned to the page's top edge leaves its composer
 *   behind the keyboard or its head above the screen. A user replying from a notification hit this
 *   (2026-10-19). Pinned to the visible area, the pane is the same on both: on Android --vv-top is 0
 *   and --vv-height is the shrunk page.
 *
 *   One listener set however many surfaces ask; the variables are removed when the last one leaves
 *   and on a wide screen, where nothing reads them.
 * @structure trackVisualViewport(query?) → { sync, stop }
 * @usage useEffect(() => { const t = trackVisualViewport(); return t.stop; }, []);
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial: the inbox and the chat pin their phone pane to the visible area.
 */

const NARROW = '(max-width: 760px)';

let users = 0;
let detach = null;
let frame = 0;

function root() { return document.documentElement; }

function clear() {
  root().style.removeProperty('--vv-top');
  root().style.removeProperty('--vv-height');
}

function write() {
  frame = 0;
  const vv = window.visualViewport;
  if (!vv || !window.matchMedia(NARROW).matches) { clear(); return; }
  root().style.setProperty('--vv-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
  root().style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
}

/** Write the variables on the next frame; repeated calls in one frame write once. */
function schedule() {
  if (!frame) frame = requestAnimationFrame(write);
}

function attach() {
  const vv = window.visualViewport;
  const mq = window.matchMedia(NARROW);
  if (vv) { vv.addEventListener('resize', schedule); vv.addEventListener('scroll', schedule); }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  mq.addEventListener?.('change', schedule);
  return () => {
    if (vv) { vv.removeEventListener('resize', schedule); vv.removeEventListener('scroll', schedule); }
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    mq.removeEventListener?.('change', schedule);
  };
}

/**
 * Start publishing --vv-top and --vv-height. `sync` re-reads at once (a surface calls it when a
 * field gains focus, before the keyboard's own events arrive); `stop` ends this surface's interest.
 */
export function trackVisualViewport() {
  if (users === 0) detach = attach();
  users += 1;
  write();
  let stopped = false;
  return {
    sync: schedule,
    stop() {
      if (stopped) return;
      stopped = true;
      users -= 1;
      if (users === 0) {
        detach?.();
        detach = null;
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        clear();
      }
    },
  };
}
