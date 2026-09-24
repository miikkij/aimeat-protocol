/**
 * @file public/views/design-lab/frame-checks.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the preview page measures on the component it draws, for Themes & Styles (07,
 *   "Measured in the frames before Save"): every control can be seen and clicked (the point at its
 *   centre is the control itself, `elementFromPoint`), words are 11 px or more, words reach their
 *   contrast (4.5:1, or 3:1 for large words) against the ground they sit on, and on a phone every
 *   control is at least 40 px each way. A finding names the element in words a person can find it
 *   by. The editor compares the frame with the operator's CSS against the one without it and warns
 *   only about what the CSS caused.
 * @structure measureChecks(stage) → Finding[]
 * @usage import { measureChecks } from './frame-checks.js';  measureChecks(stageElement)
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles S5).
 */

const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])';

/** "rgb(1, 2, 3)" or "rgba(1, 2, 3, 0.5)" as numbers. */
function rgba(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value || '');
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

const lum = ({ r, g, b }) => {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });

/** The solid ground an element's words sit on: its own background, or the first one above it. */
function groundOf(el) {
  const layers = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.backgroundImage !== 'none') return null;   // a gradient or an image: not measured
    const c = rgba(s.backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
  }
  let ground = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) ground = over(layers[i], ground);
  return ground;
}

/** A name a person finds the element by: its words, else its label, else its tag and class. */
function nameOf(el) {
  const words = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0];
  return words ? `"${words}"` : `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
}

/** True when the element is not drawn at all (display, visibility, opacity, or no size). */
function hidden(el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return true;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.1) return true;
  }
  return false;
}

/**
 * @param {HTMLElement} stage
 * @returns {Array<{ code: 'hidden'|'covered'|'small-text'|'contrast'|'small-target', what: string, value?: string }>}
 */
export function measureChecks(stage) {
  /** @type {Array<{ code: 'hidden'|'covered'|'small-text'|'contrast'|'small-target', what: string, value?: string }>} */
  const out = [];
  const phone = window.innerWidth <= 480;
  for (const el of stage.querySelectorAll(CONTROLS)) {
    if (el.closest('[aria-hidden="true"]') || /** @type {any} */ (el).disabled) continue;
    const what = nameOf(el);
    if (hidden(el)) { out.push({ code: 'hidden', what }); continue; }
    const r = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = r.top + r.height / 2 < window.innerHeight ? document.elementFromPoint(x, y) : el;
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) out.push({ code: 'covered', what });
    if (phone && (r.width < 40 || r.height < 40)) out.push({ code: 'small-target', what, value: `${Math.round(r.width)}×${Math.round(r.height)}` });
  }
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent || '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  const done = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || done.has(el) || hidden(el)) continue;
    done.add(el);
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    if (size < 11) out.push({ code: 'small-text', what: nameOf(el), value: `${Math.round(size * 10) / 10} px` });
    const ink = rgba(s.color);
    const ground = groundOf(el);
    if (!ink || !ground) continue;
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const min = large ? 3 : 4.5;
    const got = ratio(over(ink, ground), ground);
    if (got < min) out.push({ code: 'contrast', what: nameOf(el), value: `${Math.round(got * 10) / 10}:1 / ${min}:1` });
  }
  return out;
}
