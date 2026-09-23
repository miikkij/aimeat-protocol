/**
 * @file public/components/ThingLink.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A thing a person has, as a link that opens it: an optional coral count before its
 *   name (ThingLink), or the name then its count with a star beside it that keeps it always
 *   visible (ThingChip). `named` is the cut for a row of names. Its look is
 *   css/components/thing-link.css; the catalogue entry is `thing-link`.
 * @structure ThingLink({ href, n, label, named, newTab }) · ThingChip({ href, label, n, starred, starTitle, onStar })
 * @usage
 *   html`<${ThingLink} href="/v1/profile?tab=apps" n=${38} label=${t('home.things.apps')} />`
 *   html`<${ThingChip} href=${url} label=${org.name} n=${3} starred=${on} starTitle=${t('…')} onStar=${flip} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { StarToggle } from '/components/StarToggle.js';

const html = htm.bind(h);

/**
 * @param {{ href: string, n?: number, label: any, named?: boolean, newTab?: boolean }} props
 */
export function ThingLink({ href, n, label, named = false, newTab = false }) {
  return html`
    <a class=${named ? 'poster-thing poster-thing--named' : 'poster-thing'} href=${href}
      target=${newTab ? '_blank' : undefined} rel=${newTab ? 'noopener' : undefined}>
      ${typeof n === 'number' ? html`<span class="poster-thing-n">${n}</span>` : ''}
      <span class="poster-thing-label">${label}</span>
    </a>`;
}

/**
 * @param {{ href: string, label: any, n?: number, starred: boolean, starTitle?: string, onStar: () => void }} props
 */
export function ThingChip({ href, label, n, starred, starTitle, onStar }) {
  return html`
    <span class="poster-thing poster-thing--named">
      <a class="poster-thing-door" href=${href}>
        <span class="poster-thing-label">${label}</span>
        ${typeof n === 'number' && n > 0 && html`<span class="poster-thing-n">${n}</span>`}
      </a>
      <${StarToggle} on=${starred} title=${starTitle} onClick=${onStar} />
    </span>`;
}

export default ThingLink;
