/**
 * @file public/views/design-lab/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's preview page: ONE interface part, drawn by its real component with
 *   the catalogue entry's example data, in one variant and one theme. The gallery shows it in a
 *   frame (components/Specimen.js), so the theme and the width are this page's own: light and dark
 *   side by side, and a phone width that meets the real phone rules.
 *
 *   The shell draws no header and no footer on this address (spa.html). The page reports its height
 *   to the frame around it with a `design-lab-size` message, to that frame's own origin only.
 * @structure DesignLabFrame (default) — reads ?id=&v=&theme=
 * @usage /v1/design-lab/frame?id=step-card&v=0&theme=dark
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { demoFor, EXTRA_DEMOS } from './demos.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

function params() {
  const q = new URLSearchParams(window.location.search);
  return { id: q.get('id') || '', v: Number(q.get('v') || 0), theme: q.get('theme') === 'dark' ? 'dark' : 'light' };
}

export default function DesignLabFrame() {
  const { id, v, theme } = params();
  const demo = demoFor(id);
  const [example, setExample] = useState(/** @type {any} */ (null));
  const [empty, setEmpty] = useState(false);
  const stage = useRef(/** @type {HTMLDivElement|null} */ (null));

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  useEffect(() => {
    let alive = true;
    if (EXTRA_DEMOS[id]) { setExample({}); return undefined; }
    apiGet(`/v1/ui/components/${encodeURIComponent(id)}`)
      .then((r) => { if (alive) setExample(r?.data?.example ?? {}); })
      .catch((e) => { swallowed('design-lab frame: entry', e); if (alive) setExample({}); });
    return () => { alive = false; };
  }, [id]);

  // The height goes to the frame around this page, measured on every change of the stage.
  useEffect(() => {
    if (!stage.current || window.parent === window) return undefined;
    const report = () => {
      const measured = stage.current ? stage.current.scrollHeight : 0;
      setEmpty(!!stage.current && stage.current.querySelector('.poster-specimen-drawn')?.childElementCount === 0);
      window.parent.postMessage({ type: 'design-lab-size', height: demo?.height ?? measured }, window.location.origin);
    };
    const ro = new ResizeObserver(report);
    ro.observe(stage.current);
    report();
    return () => ro.disconnect();
  }, [example, demo]);

  if (!demo) return html`<p class="poster-specimen-stage">${tr('designLab.noDemo', 'No demo for this part.')}</p>`;
  const variant = demo.variants[v] ?? demo.variants[0];
  if (example === null) return html`<div ref=${stage} class="poster-specimen-stage"></div>`;

  return html`
    <div ref=${stage} class=${'poster-specimen-stage' + (demo.flush ? ' poster-specimen-stage--flush' : '')}>
      <div class="poster-specimen-drawn">${variant.render(example)}</div>
      ${empty && demo.emptyNote ? html`<p class="poster-specimen-note">${demo.emptyNote}</p>` : ''}
    </div>`;
}
