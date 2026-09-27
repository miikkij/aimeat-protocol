/**
 * @file public/components/AskPage.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A page that asks the person one thing, in a narrow column in the middle of the window
 *   (it often opens as a small popup): a consent to an app, an invitation to an organism. The
 *   question stands in the Object box: who asks (their picture or first letter, their name, their
 *   address and a mark at the right), a tag over the question, the question as the page's headline,
 *   what the person needs to know, the ways to answer at the foot, and, under a word such as "or",
 *   other ways in. While there is nothing to ask yet, one quiet sentence stands in the box's place.
 *   A page passes the words, the parts and what each way does; it never writes a class. Its look is
 *   css/components/ask-page.css, the Object box of Box.js and the Avatar of Avatar.js.
 * @structure AskPage({ message, who, tag, title, doors, or, ways, children })
 * @usage html`<${AskPage} title=${t('x.title')}
 *     who=${{ name, meta: origin, text: 'A', mark: html`<${Mark} kind="status" tone="fine">…<//>` }}
 *     doors=${html`<${Action} onClick=${no}>…<//><${Loud} onClick=${yes}>…<//>`}>…<//>`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the app-grant consent card (views/app-grant.js, .agr-*) and the
 *     invitation card (views/invite-accept.js, .inv-*) as one component (page group G9).
 */
import { h } from 'preact';
import htm from 'htm';
import { Box } from '/components/Box.js';
import { Avatar } from '/components/Avatar.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/**
 * `who`: { name, meta, text, picture, label, mark } — `picture` a node (an <img>) or `text` one
 * sign or a first letter; `meta` the typewriter line under the name (an address); `mark` stands at
 * the right. `tag`: a node over the headline (a Mark). `doors`: the ways to answer, at the right of
 * the foot (under each other on a phone, the first one lowest). `or` + `ways`: other ways in under
 * that word, each on its own line. `message`: the quiet sentence while there is nothing to ask.
 */
export function AskPage({ message, who, tag, title, doors, or, ways, children }) {
  if (message) return html`<div class="ask-page"><div class="ask-page-message"><${Note} kind="quiet">${message}<//></div></div>`;
  return html`
    <div class="ask-page">
      <${Box}>
        ${who ? html`
          <div class="ask-page-who">
            ${who.picture
              ? html`<${Avatar} size="large" label=${who.label}>${who.picture}<//>`
              : html`<${Avatar} size="large" text=${who.text} label=${who.label} />`}
            <div class="ask-page-who-words">
              <b class="ask-page-who-name">${who.name}</b>
              ${who.meta ? html`<span class="ask-page-who-meta">${who.meta}</span>` : null}
            </div>
            ${who.mark ? html`<span class="ask-page-who-mark">${who.mark}</span>` : null}
          </div>` : null}
        ${tag ? html`<div class="ask-page-tag">${tag}</div>` : null}
        ${title ? html`<h1 class="ask-page-title">${title}</h1>` : null}
        ${children}
        ${doors ? html`<div class="ask-page-doors">${doors}</div>` : null}
        ${ways ? html`
          ${or ? html`<div class="ask-page-or">${or}</div>` : null}
          <div class="ask-page-ways">${ways}</div>` : null}
      <//>
    </div>`;
}

export default AskPage;
