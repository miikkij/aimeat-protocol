/**
 * @file public/components/Timeline.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What has happened: time first, a category dot, one line (a link when it leads
 *   somewhere), one rule per row. Timeline is the whole block with its headline, an optional
 *   quiet-days nudge and a door to the whole record; `band` makes it one of the page's bands.
 *   TimelineList is the ruled list alone and TimelineRow one row; the row happening now pulses.
 *   Its look is css/components/timeline.css; the catalogue entry is `timeline`.
 * @structure Timeline({ title, band, quiet, more, children }) · TimelineList({ children }) ·
 *   TimelineRow({ category, live, href, text, when })
 * @usage
 *   html`<${Timeline} title=${t('home.feed.title')} band=${true} more=${{ href, text }}>
 *     <${TimelineRow} category="made" href=${link} text=${line} when=${ago} />
 *   <//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/feed.js and history.js with its markup unchanged
 *     (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ title: any, band?: boolean, quiet?: { href: string, text: any } | null,
 *   more?: { href: string, text: any } | null, children?: any }} props
 */
export function Timeline({ title, band = false, quiet, more, children }) {
  return html`
    <section class="poster-timeline ${band ? 'poster-band' : ''}">
      <h2 class="poster-section-title poster-section-title--large">${title}</h2>
      ${quiet && html`
        <a class="poster-timeline-quiet" href=${quiet.href}>
          ${quiet.text}
        </a>`}
      <${TimelineList}>${children}<//>
      ${more && html`
        <a class="poster-timeline-more" href=${more.href}>
          ${more.text}
        </a>`}
    </section>`;
}

/** The ruled list of rows, alone (a day of the record uses it under its own heading). */
export function TimelineList({ children }) {
  return html`<ul class="poster-timeline-list">${children}</ul>`;
}

/**
 * @param {{ category: string, live?: boolean, href?: string|null, text: any, when: any }} props
 */
export function TimelineRow({ category, live = false, href, text, when }) {
  return html`
    <li class="poster-timeline-item poster-timeline-item--${category} ${live ? 'poster-timeline-item--live' : ''}">
      <span class="poster-timeline-dot" aria-hidden="true"></span>
      <div class="poster-timeline-body">
        ${href
          ? html`<a class="poster-timeline-line" href=${href}>${text}</a>`
          : html`<span class="poster-timeline-line">${text}</span>`}
        <span class="poster-time poster-timeline-when">${when}</span>
      </div>
    </li>`;
}

export default Timeline;
