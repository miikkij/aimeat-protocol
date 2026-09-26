/**
 * @file public/components/DocView.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A document as a person reads it: its bar (the title, and the tools after it: which
 *   version to show, edit, publish, open in its own window), the facts about it (created, saved,
 *   published), and the text. Inside a workspace page the text stands on the page itself; alone
 *   (the document's own window) it stands in the raised Object box (`framed`). DocSplit is the
 *   editor's fallback: the Markdown field and its preview side by side, one under the other on a
 *   phone. A page passes the parts; it never writes a class. The look is css/components/doc-view.css
 *   and the raised box of poster.css. A heading inside the text is found by its id under
 *   `.doc-view-body` (a wiki link to a heading scrolls to it).
 * @structure DocView({ title, tools, facts, framed, onClick, children }) · DocSplit({ children })
 * @usage html`<${DocView} title=${doc.title} tools=${tools} facts=${facts} framed onClick=${openFile}><${Markdown} text=${md} /><//>`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the document view and the Markdown fallback of
 *     views/profile/organisms/document.js as a component; the look inside a workspace page and in the
 *     document's own window unchanged (page migration G2b).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

export function DocView({ title, tools, facts, framed, onClick, children }) {
  return html`
    <div class="doc-view">
      <div class="doc-view-bar"><span class="doc-view-title">${title}</span>${tools}</div>
      ${facts ? html`<div class="doc-view-facts">${facts}</div>` : null}
      <div class=${cx('doc-view-body', framed && 'poster-box poster-box--raised doc-view-body--framed')} onClick=${onClick}>${children}</div>
    </div>`;
}

export function DocSplit({ children }) {
  return html`<div class="doc-split">${children}</div>`;
}

export default DocView;
