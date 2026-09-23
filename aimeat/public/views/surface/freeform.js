/**
 * @file public/views/surface/freeform.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The block for whatever the registry does not cover: a passage the operator wrote, or
 *   asked their AI to write, shown on the node's front page or on its members' home.
 *
 *   IT IS MARKDOWN, AND IT IS RENDERED BY THE COMPONENT BUILT FOR UNTRUSTED TEXT. Markdown.js
 *   renders to Preact vnodes and never assigns innerHTML, so literal HTML in the source shows as
 *   text rather than running, and link schemes are sanitised. That matters most on the home, which
 *   renders inside the signed-in app where the DOM holds a live session — and it is why the write
 *   path refuses markup rather than trusting this component to be the only line.
 *
 *   The heading is the operator's own words when they set any, and otherwise nothing: a block with
 *   an invented title reads as a section of the product rather than as something a person wrote.
 * @structure FreeformBlock({ text, props, title })
 * @usage html`<${FreeformBlock} text=${passage} props=${block.props} title=${heading} />`
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { Markdown } from '/components/Markdown.js';

/** Nothing to say, nothing rendered — the rule every block on these pages follows. */
export function FreeformBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { text, props = {}, title = '' }) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return null;
  const tone = props.tone === 'plain' || props.tone === 'band' ? props.tone : 'card';
  return html`
    <section class=${`sf-free sf-free-${tone}`}>
      ${title ? html`<h2 class="sf-free-title">${title}</h2>` : ''}
      <${Markdown} text=${body} />
    </section>`;
}

export default FreeformBlock;
