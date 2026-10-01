/**
 * @file atelier/shell-motion.js
 * @description The app bar's less-motion switch: its words, its mark and its pressed state. Moved
 *   out of shell.js unchanged so that file stays under the 800-line limit; app() in shell.js is the
 *   only caller.
 * @structure motionLabel() · motionIcon() · motionIsLess()
 * @usage  import { motionLabel, motionIcon, motionIsLess } from './shell-motion.js';
 * @version-history
 *   v0.67.0 — 2026-10-01 — Initial: a pure move out of shell.js (the tab row's scroll-into-view
 *     pushed shell.js past 800 lines).
 */
import { t } from './i18n.js';

/** The namespace SVG is drawn in: an icon is a shape, never a character from a font. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The mark on the root that says the viewer asked for less motion (dom.js writes it). */
const MOTION_ATTR = 'data-ak-motion';

/**
 * The less-motion switch's words. The kit's dictionary has no key of its own for this yet, so a
 * host that supplies one wins and English is the floor, never the bare key on screen.
 * @returns {string}
 */
export function motionLabel() {
  const said = t('lessMotion');
  return said === 'lessMotion' ? 'Less motion' : said;
}

/**
 * The switch's mark: three speed lines, and a stroke through them the stylesheet reveals when
 * the switch is pressed. Drawn in currentColor, so it is the bar's own ink in every look.
 * @returns {SVGElement}
 */
export function motionIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const lines = document.createElementNS(SVG_NS, 'path');
  lines.setAttribute('class', 'ak-app__motion-lines');
  lines.setAttribute('d', 'M4 7h15M4 12h11M4 17h7');
  const slash = document.createElementNS(SVG_NS, 'path');
  slash.setAttribute('class', 'ak-app__motion-slash');
  slash.setAttribute('d', 'M20 4 5 20');
  svg.appendChild(lines);
  svg.appendChild(slash);
  return svg;
}

/** Is the kit's own less-motion switch on right now? (The OS setting is a separate voice, and
 *  the switch reports itself, not the operating system.) @returns {boolean} */
export function motionIsLess() {
  return document.documentElement.getAttribute(MOTION_ATTR) === 'less';
}
