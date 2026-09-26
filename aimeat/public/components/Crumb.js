/**
 * @file public/components/Crumb.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The crumb over a page's title (component plan C9, page parts): the mono path from
 *   Settings down to the page you are on, a step you can go back to as a coral link, the page you
 *   are on in ink, a slash between the steps. A page passes the steps as data and never writes a
 *   class. Its look is css/components/crumb-trail.css (.og-crumb, shared with the admin).
 *
 *   A step is one of:
 *   - a string: a plain word (grey). The LAST step, when it is a string, is the page you are on.
 *   - { label, onClick } or { label, href }: a step you can go back to (a coral link).
 *   - { label, here: true }: a page you are on, wherever it stands (Discover, Contacts and
 *     Knowledge mark every step after their own name so).
 *   - { label }: a plain word, also when it is the last step.
 *   Empty steps (null, false, '') are left out, so a page can write `cond && step`.
 * @structure Crumb({ steps })
 * @usage html`<${Crumb} steps=${[t('nav.profile'), t('profile.landing.menuBuildShare'), t('skills.tabLabel')]} />`
 *        html`<${Crumb} steps=${[t('nav.profile'), { label: t('contacts.title'), onClick: back }, { label: name, here: true }]} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the crumb every Settings page wrote by hand (crumb() in each
 *     views/profile/<page>/frame.js), as data (component plan C9).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

const present = (s) => s !== null && s !== undefined && s !== false && s !== '';

/** One step. `last` makes a bare string the page you are on. */
function Step({ step, last }) {
  if (typeof step === 'string' || typeof step === 'number') {
    return last ? html`<span class="og-crumb-here">${step}</span>` : html`<span>${step}</span>`;
  }
  const { label, onClick, href, here, title } = step;
  if (href) return html`<a class="og-crumb-link" href=${href} title=${title} onClick=${onClick}>${label}</a>`;
  if (onClick) return html`<button type="button" class="og-crumb-link" title=${title} onClick=${onClick}>${label}</button>`;
  if (here) return html`<span class="og-crumb-here" title=${title}>${label}</span>`;
  return html`<span title=${title}>${label}</span>`;
}

/** @param {{ steps: Array<string|number|{ label: any, onClick?: Function, href?: string, here?: boolean, title?: string }> }} props */
export function Crumb({ steps }) {
  const list = (steps || []).filter(present);
  const lastAt = list.length - 1;
  return html`
    <div class="og-crumb">
      ${list.map((step, i) => [
        i > 0 ? html`<span key=${'s' + i}>/</span>` : null,
        html`<${Step} key=${'c' + i} step=${step} last=${i === lastAt} />`,
      ])}
    </div>`;
}

export default Crumb;
