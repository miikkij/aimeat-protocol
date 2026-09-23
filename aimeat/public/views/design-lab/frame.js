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
 * @structure DesignLabFrame (default) — reads ?id=&v=&theme=&solo= · soloLayout
 * @usage /v1/design-lab/frame?id=step-card&v=0&theme=dark · &solo=1 for the decided element alone
 * @version-history
 *   v1.2.0 — 2026-09-23 — `solo=1`: only the element a decision is about, alone and up to twice its
 *     size (Jouni: "Show only the thing being decided"); the values on the window for the crop script.
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
import { demoFor, isLabOnly } from './demos.js';

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
    fill: s.backgroundImage !== 'none' && s.backgroundImage.includes('gradient') ? 'a gradient' : colourName(s.backgroundColor),
    colour: colourName(s.color),
    // An underline drawn as text decoration or as a bottom rule reads the same to a person.
    underline: s.textDecorationLine.includes('underline') || (parseFloat(s.borderBottomWidth) > 0 && s.borderBottomStyle !== 'none' && parseFloat(s.borderTopWidth) === 0) ? 'yes' : 'no',
    // A mark (📎, ✗, ⋯) has no letters, so what the font does to it is not a change a person reads.
    letters: /\p{L}/u.test(el.textContent || '') ? 'yes' : 'no',
    dimmed: parseFloat(s.opacity) < 1 ? 'yes' : 'no',
  };
}

function params() {
  const q = new URLSearchParams(window.location.search);
  return { id: q.get('id') || '', v: Number(q.get('v') || 0), theme: q.get('theme') === 'dark' ? 'dark' : 'light', solo: q.get('solo') === '1' };
}

const SOLO_PAD = 12;
const SOLO_SCALE = 1.5;

/**
 * What of an element can be seen: its box when it draws a frame or a ground, otherwise its text,
 * so a label that is a full-width block is framed by its words and not by the empty row.
 * @param {Element} el
 */
function seenRect(el) {
  const s = getComputedStyle(el);
  const drawsBox = parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0
    || (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent')
    || s.backgroundImage !== 'none' || s.boxShadow !== 'none'
    // A box drawn by a pseudo-element, as the dialog's close square is.
    || parseFloat(getComputedStyle(el, '::before').borderTopWidth) > 0;
  if (drawsBox) return el.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  return r.width && r.height ? r : el.getBoundingClientRect();
}

/**
 * Only the thing being decided: every other element of the drawn part is hidden (it keeps its
 * place, so the element keeps the look its real surroundings give it), and the element is moved to
 * the frame's corner and drawn up to twice its size. Returns the height the frame needs.
 * @param {HTMLElement} stage
 * @param {string} selector
 */
function soloLayout(stage, selector) {
  const targets = [...stage.querySelectorAll(selector)];
  if (!targets.length) return null;
  stage.classList.add('dl-solo');
  stage.style.transform = '';
  const base = stage.getBoundingClientRect();
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const el of targets) {
    el.classList.add('dl-solo-target');
    const r = seenRect(el);
    x0 = Math.min(x0, r.left - base.left); y0 = Math.min(y0, r.top - base.top);
    x1 = Math.max(x1, r.right - base.left); y1 = Math.max(y1, r.bottom - base.top);
  }
  const w = x1 - x0 + SOLO_PAD * 2;
  // One fixed scale, not a fit: today and after are drawn in separate frames, and a size difference
  // between them must be the element's, never the frame's. Only an element wider than the frame at
  // that scale is drawn smaller, and then its width says so.
  const room = window.innerWidth - 2;
  const scale = Math.max(0.5, Math.min(SOLO_SCALE, room / w));
  // Geometry measured at run time, like the frame's own height: it cannot be a class.
  stage.style.transformOrigin = '0 0';
  stage.style.transform = `scale(${scale}) translate(${SOLO_PAD - x0}px, ${SOLO_PAD - y0}px)`;
  return Math.ceil((y1 - y0 + SOLO_PAD * 2) * scale);
}

export default function DesignLabFrame() {
  const { id, v, theme, solo } = params();
  const demo = useMemo(() => demoFor(id), [id]);
  const [example, setExample] = useState(/** @type {any} */ (null));
  const [empty, setEmpty] = useState(false);
  const stage = useRef(/** @type {HTMLDivElement|null} */ (null));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dl-solo-page', solo);
  }, [theme, solo]);

  useEffect(() => {
    let alive = true;
    if (isLabOnly(id)) { setExample({}); return undefined; }
    apiGet(`/v1/ui/components/${encodeURIComponent(id)}`)
      .then((r) => { if (alive) setExample(r?.data?.example ?? {}); })
      .catch((e) => { swallowed('design-lab frame: entry', e); if (alive) setExample({}); });
    return () => { alive = false; };
  }, [id]);

  // The height goes to the frame around this page, measured on every change of the stage. The
  // values are also left on the window, where the crop script reads them to compare this preview
  // with the real page.
  useEffect(() => {
    if (!stage.current) return undefined;
    const report = () => {
      if (!stage.current) return;
      setEmpty(stage.current.querySelector('.poster-specimen-drawn')?.childElementCount === 0);
      const variant = demo?.variants?.[v] ?? demo?.variants?.[0];
      const soloHeight = solo && variant?.solo ? soloLayout(stage.current, variant.solo) : null;
      const target = variant?.measure ? stage.current.querySelector(variant.measure) : null;
      const values = target ? measureValues(target) : null;
      /** @type {any} */ (window).__dlValues = values;
      if (window.parent === window) return;
      window.parent.postMessage({
        type: 'design-lab-size', height: soloHeight ?? demo?.height ?? stage.current.scrollHeight, values,
      }, window.location.origin);
    };
    const ro = new ResizeObserver(report);
    ro.observe(stage.current);
    report();
    return () => ro.disconnect();
  }, [example, demo, v, solo]);

  if (!demo) return html`<p class="poster-specimen-stage">${tr('designLab.noDemo', 'No demo for this part.')}</p>`;
  const variant = demo.variants[v] ?? demo.variants[0];
  if (example === null) return html`<div ref=${stage} class="poster-specimen-stage"></div>`;

  return html`
    <div ref=${stage} class=${'poster-specimen-stage' + (demo.flush ? ' poster-specimen-stage--flush' : '')}>
      <div class="poster-specimen-drawn">${variant.render(example)}</div>
      ${empty && demo.emptyNote ? html`<p class="poster-specimen-note">${demo.emptyNote}</p>` : ''}
    </div>`;
}
