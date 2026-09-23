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
 *   v1.1.0 — 2026-09-23 — Decision variants (`id=decision:<id>`), and the drawn element's values
 *     (face, size, weight, case, tracking, padding, frame, radius, fill, colour by token) sent to the
 *     frame with its height.
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { h } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { demoFor, EXTRA_DEMOS } from './demos.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** Theme tokens a colour is named by, when it equals one. */
const COLOUR_TOKENS = ['--text', '--bg', '--card-bg', '--card', '--text-dim', '--border', '--accent', '--sun', '--on-sun',
  '--success', '--success-fg', '--danger', '--warn-fg', '--info-fg', '--bg-surface', '--bg-dim', '--muted'];

/** "#1A1A2E" or "rgb(26, 26, 46)" as one comparable string. */
function rgbOf(value) {
  const v = String(value || '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const s = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return `rgb(${parseInt(s.slice(0, 2), 16)}, ${parseInt(s.slice(2, 4), 16)}, ${parseInt(s.slice(4, 6), 16)})`;
  }
  return v.replace(/\s+/g, ' ');
}

/** A computed colour, named by its token when one matches; transparent says so. */
function colourName(value) {
  if (!value || value === 'rgba(0, 0, 0, 0)' || value === 'transparent') return 'none';
  const root = getComputedStyle(document.documentElement);
  const hit = COLOUR_TOKENS.find((t) => rgbOf(root.getPropertyValue(t)) === rgbOf(value));
  return hit ? `var(${hit})` : value;
}

/** Pixels as the stylesheets write them: rem, trimmed ("10.88px" → ".68rem"). */
const rem = (px) => {
  const n = parseFloat(px);
  if (!Number.isFinite(n) || n === 0) return '0';
  return `${String(Math.round((n / 16) * 1000) / 1000).replace(/^0\./, '.')}rem`;
};

/** What a person compares between two variants, read from the drawn element. */
function measureValues(el) {
  const s = getComputedStyle(el);
  const family = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  // A border is snapped to the screen's device pixels (1px reads 0.8px at 125 %), so the width is
  // given in whole CSS pixels, as it is written.
  const width = parseFloat(s.borderTopWidth);
  const border = s.borderTopStyle === 'none' || !width
    ? 'none' : `${Math.max(1, Math.round(width))}px ${s.borderTopStyle} ${colourName(s.borderTopColor)}`;
  const size = parseFloat(s.fontSize);
  const spacing = parseFloat(s.letterSpacing);
  return {
    font: `${family} ${rem(s.fontSize)} ${s.fontWeight}`,
    case: s.textTransform === 'none' ? 'as written' : s.textTransform,
    tracking: Number.isFinite(spacing) && size ? `${String(Math.round((spacing / size) * 100) / 100).replace(/^0\./, '.')}em` : 'normal',
    padding: s.padding.split(' ').map(rem).join(' '),
    frame: border,
    radius: s.borderRadius === '0px' ? 'none' : s.borderRadius,
    fill: colourName(s.backgroundColor),
    colour: colourName(s.color),
  };
}

function params() {
  const q = new URLSearchParams(window.location.search);
  return { id: q.get('id') || '', v: Number(q.get('v') || 0), theme: q.get('theme') === 'dark' ? 'dark' : 'light' };
}

export default function DesignLabFrame() {
  const { id, v, theme } = params();
  const demo = useMemo(() => demoFor(id), [id]);
  const [example, setExample] = useState(/** @type {any} */ (null));
  const [empty, setEmpty] = useState(false);
  const stage = useRef(/** @type {HTMLDivElement|null} */ (null));

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  useEffect(() => {
    let alive = true;
    if (EXTRA_DEMOS[id] || id.startsWith('decision:')) { setExample({}); return undefined; }
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
      const variant = demo?.variants?.[v] ?? demo?.variants?.[0];
      const target = variant?.measure ? stage.current?.querySelector(variant.measure) : null;
      window.parent.postMessage({
        type: 'design-lab-size', height: demo?.height ?? measured,
        values: target ? measureValues(target) : null,
      }, window.location.origin);
    };
    const ro = new ResizeObserver(report);
    ro.observe(stage.current);
    report();
    return () => ro.disconnect();
  }, [example, demo, v]);

  if (!demo) return html`<p class="poster-specimen-stage">${tr('designLab.noDemo', 'No demo for this part.')}</p>`;
  const variant = demo.variants[v] ?? demo.variants[0];
  if (example === null) return html`<div ref=${stage} class="poster-specimen-stage"></div>`;

  return html`
    <div ref=${stage} class=${'poster-specimen-stage' + (demo.flush ? ' poster-specimen-stage--flush' : '')}>
      <div class="poster-specimen-drawn">${variant.render(example)}</div>
      ${empty && demo.emptyNote ? html`<p class="poster-specimen-note">${demo.emptyNote}</p>` : ''}
    </div>`;
}
