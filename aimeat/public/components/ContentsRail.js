/**
 * @file public/components/ContentsRail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The contents rail for a page whose sections are drawn by parts that each fetch their
 *   own data: the home (/v1/home), whose blocks the operator arranges, and the Settings & Controls
 *   overview, whose panels come and go with the account. Such a page cannot list its sections up
 *   front the way a Settings page does (SettingsPage `sections`), because it does not know which
 *   part will draw anything, under which heading, or with what count. So the page marks the places
 *   and this component reads what was drawn there.
 *
 *   A section is an element with `data-rail="<key>"` inside the root (one inside another is part of
 *   the outer one and is not listed on its own). It is listed when it has drawn
 *   something that takes up space, in document order, numbered 01, 02, … Its label is
 *   `data-rail-label` when the page sets one, otherwise the words of its first h2 or h3 (a question
 *   mark beside the heading is left out); a section with neither is not listed. Its count is the
 *   `data-rail-count` on it or on any element inside it. A marker that must not change the layout
 *   carries the class `rail-mark` (display: contents, css/components/tab-page.css); for a marker
 *   with no box of its own the rail scrolls to the first child that has one.
 *
 *   The list follows the page: a MutationObserver on the root re-reads it at most once a frame, and
 *   the component re-renders only when a key, a label or a count changed. Nothing is fetched here.
 *
 *   Drawn with the page kit's own parts: Rail beside the page (.og-grid) and railFold as the closed
 *   row a narrow screen shows instead (css/components/tab-page.css switches between the two at
 *   1100px).
 * @structure useRailSections(root) · contentsRail({ title, sections, pagesLabel, pages }) · readSections(root)
 * @usage
 *   const [root, setRoot] = useState(null);
 *   const sections = useRailSections(root);
 *   const rail = contentsRail({ title: t('home.rail.title'), sections, pagesLabel, pages });
 *   html`${rail && railFold([rail])}
 *     <div class="og-grid"><div class="og-main og-main--flow" ref=${setRoot}>…</div>${rail && html`<${Rail} ...${rail} />`}</div>`
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: the contents rail of the home and of the Settings & Controls overview.
 */
import { useEffect, useState } from 'preact/hooks';
import { scrollToElement } from '/components/Rail.js';

/** The words a heading shows: its own text and the text of any child that is not a control. */
function headingWords(heading) {
  let words = '';
  for (const node of heading.childNodes) {
    if (node.nodeType === 3) words += node.textContent;
    else if (node.nodeType === 1 && !node.matches('button, [role="button"], .help-tip, svg')) words += node.textContent;
  }
  return words.replace(/\s+/g, ' ').trim();
}

/**
 * The element a section's link scrolls to: the marker itself, or, while the marker draws no box of
 * its own (display: contents, as .rail-mark and the home's block slots do), its first child.
 * @param {Element|null} el
 */
function targetOf(el) {
  let box = el;
  while (box && getComputedStyle(box).display === 'contents') box = box.firstElementChild;
  return box;
}

/**
 * What the root holds right now, in document order.
 * @param {Element} root
 * @returns {Array<{ key: string, label: string, count: string, el: Element }>}
 */
export function readSections(root) {
  const out = [];
  for (const el of root.querySelectorAll('[data-rail]')) {
    // A section inside another section (a block inside a group of the home) is part of that one.
    const outer = el.parentElement?.closest('[data-rail]');
    if (outer && root.contains(outer)) continue;
    const target = targetOf(el);
    // Nothing drawn, or drawn with no box (a block that answered null, a panel still empty).
    if (!target || !el.firstElementChild || target.getClientRects().length === 0) continue;
    const heading = el.querySelector('h2, h3');
    const label = el.getAttribute('data-rail-label') || (heading ? headingWords(heading) : '');
    if (!label) continue;
    const counted = el.hasAttribute('data-rail-count') ? el : el.querySelector('[data-rail-count]');
    const count = counted ? String(counted.getAttribute('data-rail-count') ?? '') : '';
    out.push({ key: el.getAttribute('data-rail') || label, label, count, el: target });
  }
  return out;
}

const same = (a, b) => a.length === b.length
  && a.every((s, i) => s.key === b[i].key && s.label === b[i].label && s.count === b[i].count && s.el === b[i].el);

/**
 * The sections drawn under `root`, kept current as the page draws. The root is an element held in
 * state (a callback ref), not a ref object: the page mounts it only once its data has answered,
 * after the first render, and a ref object's change would not run the effect again.
 * @param {Element|null} root
 */
export function useRailSections(root) {
  const [sections, setSections] = useState(/** @type {ReturnType<typeof readSections>} */ ([]));
  useEffect(() => {
    if (!root) { setSections([]); return undefined; }
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = readSections(root);
      setSections((was) => (same(was, next) ? was : next));
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    const watch = new MutationObserver(later);
    watch.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-rail-count', 'data-rail-label', 'hidden', 'class'] });
    return () => { watch.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [root]);
  return sections;
}

/**
 * The rail as data for Rail and RailFold: the drawn sections, then the sibling pages. Null while no
 * section has drawn, so the page shows no empty box while its parts load.
 * @param {{ title: string, sections: ReturnType<typeof readSections>, pagesLabel?: string,
 *   pages?: Array<{ key: string, label: string, onClick?: () => void, href?: string }|null|false> }} props
 */
export function contentsRail({ title, sections, pagesLabel, pages }) {
  if (!sections.length) return null;
  const own = sections.map((s, i) => ({
    key: s.key,
    mark: String(i + 1).padStart(2, '0'),
    label: s.label,
    count: s.count || undefined,
    onClick: () => scrollToElement(s.el),
  }));
  const links = (pages || []).filter(Boolean).map((p) => ({ mark: '→', count: '→', ...p }));
  return {
    title,
    groups: [
      { label: title, items: own },
      links.length ? { label: pagesLabel, items: links } : null,
    ].filter(Boolean),
  };
}
