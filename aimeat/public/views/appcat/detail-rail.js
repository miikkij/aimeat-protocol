/**
 * @file public/views/appcat/detail-rail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which link of the detail's "On this page" rail is lit, and the way a link brings its
 *   section to the top (features F67, F68, F177), as the old catalogue's detail-rail.js decided it:
 *   - a press on a link pins that section: it stays lit while the body scrolls smoothly to put its
 *     headline 24px under the top, even when the section sits too low ever to reach the reading line;
 *   - the person's own scrolling releases the pin: the wheel, a touch move, a press on the body's
 *     scroll bar, or the keys (arrows, Page Up/Down, Home, End, Space) when they are not typed into a
 *     field and Space is not on a button or a link;
 *   - unpinned, the lit link is the last section whose headline has passed the upper third of the
 *     body, and the last section once the body is scrolled to its bottom;
 *   - the work is done once per animation frame; opening another app clears the pin.
 *   The rail itself is components/Rail.js; this hook only says which item is on and scrolls.
 * @structure useDetailRail(bodyRef, ids, resetKey) → { current, goTo(index), scrollToId(id, gap) }
 * @usage const rail = useDetailRail(bodyRef, sectionIds, ref); … on: rail.current === i, onClick: () => rail.goTo(i)
 * @version-history
 *   v1.1.0 — 2026-09-27 — scrollToId takes the gap above the section (0 for the legal chip, as the old
 *     page's scrollIntoView put it; parity pass).
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's detail-rail.js as a hook over DOM ids.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

const KEYS = /^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/;

/**
 * @param {{ current: HTMLElement|null }} bodyRef  the element that scrolls (the detail's body)
 * @param {string[]} ids  the DOM ids of the sections, in their order on the page
 * @param {string} resetKey  changes when another app opens (the pin is cleared)
 */
export function useDetailRail(bodyRef, ids, resetKey) {
  const [current, setCurrent] = useState(-1);
  const pinned = useRef(-1);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const mark = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const secs = idsRef.current.map((id) => document.getElementById(id)).filter(Boolean);
    let on = -1;
    if (pinned.current >= 0 && pinned.current < secs.length) {
      on = pinned.current;
    } else {
      const box = body.getBoundingClientRect();
      const line = box.top + box.height / 3;
      secs.forEach((sec, i) => { if (sec.getBoundingClientRect().top <= line) on = i; });
      // At the very bottom the last sections may never reach the line; the last one is then the one read.
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4 && secs.length) on = secs.length - 1;
    }
    setCurrent(on);
  }, [bodyRef]);

  // One mark per animation frame, however many scroll events come.
  const queued = useRef(false);
  const remark = useCallback(() => {
    if (queued.current) return;
    queued.current = true;
    requestAnimationFrame(() => { queued.current = false; mark(); });
  }, [mark]);

  const idsKey = ids.join('|');
  useEffect(() => { pinned.current = -1; remark(); }, [resetKey, remark]);
  useEffect(() => { remark(); }, [idsKey, remark]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    // Only a scroll the person makes releases the pin; the smooth scroll a press started fires
    // scroll events too, and those must leave the pressed section lit.
    const release = () => { if (pinned.current < 0) return; pinned.current = -1; remark(); };
    const onDown = (e) => { if (e.target === body && e.offsetX >= body.clientWidth) release(); };
    const onKey = (e) => {
      if (pinned.current < 0 || !KEYS.test(e.key)) return;
      const el = e.target;
      // Keys typed into a field move a caret, and a space on a button presses it; neither scrolls.
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === ' ' && el && /^(BUTTON|A)$/.test(el.tagName)) return;
      release();
    };
    body.addEventListener('scroll', remark, { passive: true });
    body.addEventListener('wheel', release, { passive: true });
    body.addEventListener('touchmove', release, { passive: true });
    body.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      body.removeEventListener('scroll', remark);
      body.removeEventListener('wheel', release);
      body.removeEventListener('touchmove', release);
      body.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bodyRef, remark]);

  /**
   * Bring a section 24px under the body's top, smoothly; `gap` 0 puts its top on the body's top (the
   * old page's scrollIntoView block start, which the masthead's legal chip used).
   */
  const scrollToId = useCallback((id, gap = 24) => {
    const body = bodyRef.current;
    const sec = document.getElementById(id);
    if (!body || !sec) return;
    const top = body.scrollTop + sec.getBoundingClientRect().top - body.getBoundingClientRect().top - gap;
    body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [bodyRef]);

  /** A press on a rail link: pin that section, light it, and bring it up. */
  const goTo = useCallback((index) => {
    const id = idsRef.current[index];
    if (!id) return;
    pinned.current = index;
    mark();
    scrollToId(id);
  }, [mark, scrollToId]);

  return { current, goTo, scrollToId };
}
