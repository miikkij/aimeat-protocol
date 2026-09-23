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
 * @structure Specimens({ children }) · Specimen({ label, src, phone, note, onValues }) ·
 *   SpecimenImage({ label, src, missing })
 * @usage html`<${Specimens}><${Specimen} label="Light" src="/v1/design-lab/frame?id=turn&theme=light" /><//>`
 * @version-history
 *   v1.2.0 — 2026-09-23 — `eager`, for a frame whose values the page waits for.
 *   v1.1.0 — 2026-09-23 — onValues: the measured values of a decision's variant; SpecimenImage, a
 *     crop from a real page.
 *   v1.0.0 — 2026-09-23 — Initial, for the design lab's library view (UI consolidation phase 2).
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

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
  const [height, setHeight] = useState(120);

  useEffect(() => {
    const onMessage = (/** @type {MessageEvent} */ e) => {
      if (e.origin !== window.location.origin) return;
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      if (e.data?.type === 'design-lab-size' && Number.isFinite(e.data.height)) {
        setHeight(Math.max(40, Math.ceil(e.data.height)));
        if (e.data.values && onValues) onValues(e.data.values);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onValues]);

  return html`
    <figure class=${'poster-specimen' + (phone ? ' poster-specimen--phone' : '')}>
      <figcaption class="poster-label">${label}</figcaption>
      <div class="poster-frame poster-specimen-box">
        <iframe ref=${ref} class="poster-specimen-frame" src=${src} title=${typeof label === 'string' ? label : ''}
          loading=${eager ? 'eager' : 'lazy'} height=${height}></iframe>
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
