/**
 * @file public/components/SignedOutDoor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The signed-out door of a page that opens only for its owner (Settings & Controls,
 *   /v1/profile without a session): the address the visitor arrived at and a coral word beside it,
 *   the headline and its accent line, where the address leads (a path of steps, → between them) with
 *   the "owner only" tag, the lead, the loud action and the action link, the line after them, and
 *   the aside that says what this is with its link. Showroom face, since the visitor is outside. A
 *   page passes the words and what each way on does; it never writes a class. Its look is
 *   css/components/signed-out-door.css (.signed-out-door-*).
 * @structure SignedOutDoor({ address, kicker, title, titleAccent, targetLabel, path, tag, lead,
 *   action, second, after, aside })
 * @usage html`<${SignedOutDoor} address=${addr} kicker=${t('profile.door.kicker')}
 *   title=${t('profile.door.title')} titleAccent=${t('profile.door.titleAccent')}
 *   targetLabel=${t('profile.door.targetLabel')} path=${[profile, tabLabel]} tag=${t('profile.door.ownerOnly')}
 *   lead=${…} action=${{ label, onClick }} second=${{ label, onClick }} after=${…}
 *   aside=${{ label, title, text, link: { label, href, onClick } }} />`
 * @version-history
 *   v1.0.1 — 2026-09-27 — Draws its own class names: every .pf-door* is .signed-out-door* (a move,
 *     same look).
 *   v1.0.0 — 2026-09-26 — Initial: the markup of views/profile/door.js as a component, unchanged
 *     (page group G8).
 */
import { h } from 'preact';
import htm from 'htm';
import { Mark } from '/components/Mark.js';
import { Action } from '/components/Action.js';

const html = htm.bind(h);

/**
 * `path` is the steps of where the address leads: one step draws it alone, two or more draw the
 * first as the root, → between them.
 */
export function SignedOutDoor({ address, kicker, title, titleAccent, targetLabel, path = [], tag, lead, action, second, after, aside }) {
  const steps = (path || []).filter(Boolean);
  return html`
    <div class="signed-out-door">
      <div class="signed-out-door-kicker">
        <span class="signed-out-door-address">${address}</span>
        <span class="signed-out-door-label">${kicker}</span>
      </div>
      <h1 class="signed-out-door-title">
        <span>${title}</span>
        <span class="signed-out-door-title-accent">${titleAccent}</span>
      </h1>
      <div class="signed-out-door-target">
        <div class="signed-out-door-target-path">
          <span class="signed-out-door-label">${targetLabel}</span>
          ${steps.length > 1
            ? html`<span class="signed-out-door-crumb">
                <span class="signed-out-door-crumb-root">${steps[0]}</span>
                ${steps.slice(1).map((s, i) => html`<span class="signed-out-door-crumb-arrow" key=${'a' + i}>→</span><span key=${'s' + i}>${s}</span>`)}
              </span>`
            : html`<span class="signed-out-door-crumb">${steps[0]}</span>`}
        </div>
        ${tag ? html`<${Mark}>${tag}<//>` : null}
      </div>
      <div class="signed-out-door-cols">
        <div class="signed-out-door-say">
          <p class="signed-out-door-lead">${lead}</p>
          <div class="signed-out-door-actions">
            ${action ? html`<button type="button" class="poster-slab signed-out-door-slab" onClick=${action.onClick}>${action.label}</button>` : null}
            ${second ? html`<${Action} small onClick=${second.onClick}>${second.label}<//>` : null}
          </div>
          ${after ? html`<p class="signed-out-door-after">${after}</p>` : null}
        </div>
        ${aside ? html`
          <aside class="signed-out-door-what poster-aside">
            <div class="signed-out-door-what-head">
              <span class="signed-out-door-label">${aside.label}</span>
              <span class="signed-out-door-what-title">${aside.title}</span>
            </div>
            <p class="signed-out-door-what-text">${aside.text}</p>
            ${aside.link ? html`<a class="poster-action poster-action--small signed-out-door-more" href=${aside.link.href} onClick=${aside.link.onClick}>${aside.link.label}</a>` : null}
          </aside>` : null}
      </div>
    </div>`;
}

export default SignedOutDoor;
