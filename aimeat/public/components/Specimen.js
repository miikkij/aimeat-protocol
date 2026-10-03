/**
 * @file public/components/Specimen.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One live preview of an interface part, framed and captioned: the part is drawn by
 *   the real page in its own frame, so its theme and its width are its own and the page around it
 *   changes neither. A row of them shows the same part in several looks side by side. Its look is
 *   css/components/specimen.css; the catalogue entry is `specimen`.
 *
 *   THE FRAME SETS ITS OWN HEIGHT. The page inside reports its height with a message
 *   (`design-lab-size`), and the frame takes it, so a specimen is as tall as what it shows and
 *   nothing scrolls inside it. A message from any other window is ignored. When the page inside
 *   measured an element (a decision's variant), the values reach `onValues`.
 *
 *   A FEW FRAMES LOAD AT A TIME, AND ONLY NEAR THE SCREEN. Every frame is a whole page with its own
 *   copy of every component module, so the library's overview (254 frames on 2026-10-03) asked the
 *   browser for tens of thousands of files at once and it ran out of resources
 *   (net::ERR_INSUFFICIENT_RESOURCES): no frame drew, and the admin page's own requests failed with
 *   them. Native `loading="lazy"` did not hold it, because a frame is 120 pixels tall before it
 *   reports its height and the browser loads lazy frames from far below the screen. So a frame gets
 *   its address when it comes near the screen and a loading slot is free (LOAD_AT_ONCE), gives the
 *   slot back when it has drawn (its first size message) or after SLOT_TIMEOUT_MS, and gives its
 *   address back when it moves far from the screen, keeping its height. `eager` skips all of this.
 * @structure Specimens({ children }) · Specimen({ label, src, phone, note, eager, onValues }) ·
 *   SpecimenImage({ label, src, missing }) · queue (LOAD_AT_ONCE, takeSlot)
 * @usage html`<${Specimens}><${Specimen} label="Light" src="/v1/design-lab/frame?id=turn&theme=light" /><//>`
 * @version-history
 *   v1.3.0 — 2026-10-03 — A few frames load at a time and only near the screen; a frame far from it
 *     gives its page back. The overview of 254 frames had stopped the browser.
 *   v1.2.0 — 2026-09-23 — `eager`, for a frame whose values the page waits for.
 *   v1.1.0 — 2026-09-23 — onValues: the measured values of a decision's variant; SpecimenImage, a
 *     crop from a real page.
 *   v1.0.0 — 2026-09-23 — Initial, for the design lab's library view (UI consolidation phase 2).
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

/** How many frames may be loading at one time. */
const LOAD_AT_ONCE = 3;
/** A frame that has not drawn in this time gives its slot back anyway (an error page sends no size). */
const SLOT_TIMEOUT_MS = 15000;
/** How near the screen a frame loads, and how far from it the frame gives its page back. */
const NEAR = '800px 0px';

let loadingNow = 0;
/** @type {Array<() => void>} */
const waiting = [];

function pump() {
  while (loadingNow < LOAD_AT_ONCE && waiting.length) {
    loadingNow += 1;
    /** @type {() => void} */ (waiting.shift())();
  }
}

/**
 * Waits for a loading slot. `start` runs when the slot is free; the returned function gives the slot
 * back, or leaves the line when the slot was not yet given. Calling it twice does nothing.
 * @param {() => void} start
 * @returns {() => void}
 */
function takeSlot(start) {
  let state = 'waiting';
  const run = () => { state = 'running'; start(); };
  waiting.push(run);
  pump();
  return () => {
    if (state === 'waiting') {
      const i = waiting.indexOf(run);
      if (i >= 0) waiting.splice(i, 1);
    } else if (state === 'running') {
      loadingNow = Math.max(0, loadingNow - 1);
      pump();
    }
    state = 'done';
  };
}

/**
 * The box that scrolls the frame, or null for the window. The shell scrolls `.page-content`, not the
 * window, and a box that scrolls clips what the observer sees, so the margin is counted from it.
 * @param {Element} el
 */
function scroller(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/** A row of specimens that wraps to one per line on a phone. */
export function Specimens({ children }) {
  return html`<div class="poster-specimens">${children}</div>`;
}

/**
 * `eager` loads the frame at once instead of when it scrolls into view, for a frame whose measured
 * values something on the page waits for.
 * @param {{ label: any, src: string, phone?: boolean, note?: any, eager?: boolean, onValues?: (values: Record<string, string>) => void }} props
 */
export function Specimen({ label, src, phone = false, note, eager = false, onValues }) {
  const ref = useRef(/** @type {HTMLIFrameElement|null} */ (null));
  const box = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [height, setHeight] = useState(120);
  // The address the frame has now: empty while it waits for a slot or is far from the screen.
  const [shown, setShown] = useState(eager ? src : '');
  // Gives the loading slot back; the frame's first size message calls it.
  const free = useRef(/** @type {(() => void)|null} */ (null));

  useEffect(() => {
    const onMessage = (/** @type {MessageEvent} */ e) => {
      if (e.origin !== window.location.origin) return;
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      if (e.data?.type === 'design-lab-size' && Number.isFinite(e.data.height)) {
        free.current?.();
        setHeight(Math.max(40, Math.ceil(e.data.height)));
        if (e.data.values && onValues) onValues(e.data.values);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onValues]);

  useEffect(() => {
    const el = box.current;
    if (eager || !el || typeof IntersectionObserver === 'undefined') { setShown(src); return undefined; }
    setShown('');
    let near = false;
    /** @type {(() => void)|null} */
    let ticket = null;
    let timer = 0;
    const giveBack = () => { clearTimeout(timer); if (ticket) { ticket(); ticket = null; } };
    free.current = giveBack;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !near) {
        near = true;
        ticket = takeSlot(() => { setShown(src); timer = window.setTimeout(giveBack, SLOT_TIMEOUT_MS); });
      } else if (!entry.isIntersecting && near) {
        near = false;
        giveBack();
        setShown('');
      }
    }, { root: scroller(el), rootMargin: NEAR });
    io.observe(el);
    return () => { io.disconnect(); giveBack(); if (free.current === giveBack) free.current = null; };
  }, [src, eager]);

  // A frame far from the screen is an empty one: removing an iframe's address does not unload its
  // page, so the key gives it a new iframe. The empty frame keeps the height the page last reported.
  return html`
    <figure class=${'poster-specimen' + (phone ? ' poster-specimen--phone' : '')}>
      <figcaption class="poster-label">${label}</figcaption>
      <div ref=${box} class="poster-frame poster-specimen-box">
        <iframe key=${shown ? 'page' : 'empty'} ref=${ref} class="poster-specimen-frame" src=${shown || undefined}
          title=${typeof label === 'string' ? label : ''} height=${height}></iframe>
      </div>
      ${note ? html`<p class="poster-specimen-note">${note}</p>` : ''}
    </figure>`;
}

/**
 * A crop from a real page beside the live specimens, framed and captioned the same way. The crop is
 * shot at twice its size and set at its own, so a small chip stays sharp; a missing crop is said in
 * words rather than shown broken.
 * @param {{ label: any, src?: string|null, missing?: any }} props
 */
export function SpecimenImage({ label, src, missing }) {
  return html`
    <figure class="poster-specimen">
      <figcaption class="poster-label">${label}</figcaption>
      <div class="poster-frame poster-specimen-box">
        ${src
          ? html`<img class="poster-specimen-crop" src=${src} alt=${typeof label === 'string' ? label : ''}
              onLoad=${(e) => { const img = /** @type {HTMLImageElement} */ (e.currentTarget); img.width = Math.round(img.naturalWidth / 2); }} />`
          : html`<p class="poster-specimen-note poster-specimen-stage">${missing}</p>`}
      </div>
    </figure>`;
}

export default Specimen;
