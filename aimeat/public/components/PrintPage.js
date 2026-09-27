/**
 * @file public/components/PrintPage.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A page that prints as a document, as one component: on screen the page is the work,
 *   on paper only the document part stands, without the site's frame around it. A page passes its
 *   parts and never a class; the look is css/components/print-page.css.
 *
 *   WHY THE DOCUMENT IS ALWAYS IN THE PAGE, HIDDEN ON SCREEN. Composing it on the beforeprint event
 *   is a race: a state update scheduled there is not guaranteed to have painted before the browser
 *   takes its snapshot. Rendering both and letting the print sheet choose has no timing in it, so the
 *   printout is the same from a Print button or from the reader's own Ctrl+P.
 *
 *   WHY THE BODY IS MARKED. Every sheet is loaded on every page of the app, so an unscoped print rule
 *   would follow the reader onto every other page. PrintPage marks the body (print-page-active) while
 *   it is on screen, and every print rule is scoped to that mark. On paper everything that neither
 *   holds the page nor stands inside it is left out (the top bar, a side menu, a frame's bar, a
 *   toast), without the sheet naming any of them.
 *
 *   - PrintPage({ children }): the page's root.
 *   - ScreenOnly({ children }): what only the screen shows (the page's working parts, its toasts).
 *   - PrintOnly({ children }): the document, hidden on screen.
 *   The document's own parts, read on paper:
 *   - PrintHead({ title, line }): its heading and the stamp line under it (where, when, which version).
 *   - PrintHeading({ children }): a part's heading.
 *   - PrintEntry({ title, tag, desc, fields, answers, reasons, reasonsLabel, emptyAnswer }): one entry
 *     of a register: its title with its tag (a class) beside it, a description, the fields that
 *     have a value (`fields` [{ key, label, value }], a list value joined with commas, an empty one
 *     left out), the answers as two columns (`answers` [{ key, question, answer, source }]: an empty
 *     answer says `emptyAnswer` in italics, a source stands in brackets after the answer) and the
 *     reasons under `reasonsLabel` as a bulleted list; it is kept on one sheet.
 *   - PrintList({ items }): a numbered list [{ key, text, help }], the help on its own line in grey.
 * @structure PrintPage · ScreenOnly · PrintOnly · PrintHead · PrintHeading · PrintEntry · PrintList
 * @usage html`<${PrintPage}>
 *          <${ScreenOnly}>…the page…<//>
 *          <${PrintOnly}><${PrintHead} title=${t('x.printTitle')} line=${stamp} />…<//>
 *        <//>`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the Compliance page's printout (views/admin/compliance-tab.print.js
 *     markup and admin.css .adm-cmp-print-only, .adm-cmp-pr-*, the body.adm-compliance-active print
 *     block) as a component that any page can print with (admin group G1).
 */
import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);
const MARK = 'print-page-active';
const has = (x) => x !== undefined && x !== null && x !== false && x !== '';

/** The page's root; marks the body while it is on screen. */
export function PrintPage({ children }) {
  useEffect(() => {
    document.body.classList.add(MARK);
    return () => document.body.classList.remove(MARK);
  }, []);
  return html`<div class="print-page">${children}</div>`;
}

export function ScreenOnly({ children }) {
  return html`<div class="print-screen-only">${children}</div>`;
}

export function PrintOnly({ children }) {
  return html`<div class="print-only">${children}</div>`;
}

export function PrintHead({ title, line }) {
  return html`<div class="print-head"><h2>${title}</h2>${has(line) ? html`<p>${line}</p>` : null}</div>`;
}

export function PrintHeading({ children }) {
  return html`<h3 class="print-heading">${children}</h3>`;
}

/**
 * @param {{ title: any, tag?: any, desc?: any, fields?: Array<{ key?: any, label: any, value: any }>,
 *   answers?: Array<{ key?: any, question: any, answer?: any, source?: any }>, reasons?: Array<any>,
 *   reasonsLabel?: any, emptyAnswer?: any }} props
 */
export function PrintEntry({ title, tag, desc, fields = [], answers = [], reasons = [], reasonsLabel, emptyAnswer }) {
  const shownFields = (fields || []).map((f) => ({ ...f, text: Array.isArray(f.value) ? f.value.join(', ') : f.value })).filter((f) => has(f.text));
  return html`
    <article class="print-entry">
      <h4>${title}${has(tag) ? html`<span class="print-entry-tag">${tag}</span>` : null}</h4>
      ${has(desc) ? html`<p class="print-entry-desc">${desc}</p>` : null}
      ${shownFields.map((f, i) => html`<div class="print-entry-field" key=${f.key ?? i}><span>${f.label}</span> ${f.text}</div>`)}
      <table class="print-entry-answers">
        <tbody>
          ${(answers || []).map((a, i) => html`
            <tr key=${a.key ?? i}>
              <td class="print-entry-q">${a.question}</td>
              <td class="print-entry-a">
                ${has(a.answer) ? a.answer : html`<em>${emptyAnswer}</em>`}
                ${has(a.answer) && has(a.source) ? html`<span class="print-entry-src">(${a.source})</span>` : null}
              </td>
            </tr>`)}
        </tbody>
      </table>
      ${reasons && reasons.length > 0 ? html`
        <div class="print-entry-why">
          <span>${reasonsLabel}</span>
          <ul>${reasons.map((r, i) => html`<li key=${i}>${r}</li>`)}</ul>
        </div>` : null}
    </article>`;
}

export function PrintList({ items = [] }) {
  return html`<ol class="print-list">
    ${(items || []).map((it, i) => html`<li key=${it.key ?? i}>${it.text}${has(it.help) ? html`<span class="print-list-help">${it.help}</span>` : null}</li>`)}
  </ol>`;
}

export default PrintPage;
