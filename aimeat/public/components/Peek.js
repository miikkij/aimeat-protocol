/**
 * @file public/components/Peek.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A text shown three ways, as one component: its first line only, its top under a fade
 *   (the peek), or all of it. Peek draws the text in the way the page holds; PeekToggle is the small
 *   icon button that takes it to the next way (line → peek → all → line), its mark saying which way
 *   it goes (⌄ opens more, ⌃ closes); nextPeek(view) is that order. A page passes the text and the
 *   way and never writes a class. The look is css/components/peek.css (the Notebook note's
 *   .pf-nb-note-text, its --peek fade and .pf-nb-note-line, moved out of css/views/notebook.css
 *   unchanged); the button is components/Action.js Icon.
 *
 *   - Peek({ view, line, children }): `view` = 'line' | 'peek' | 'full'; `line` the one line shown
 *     for 'line'; the children are the whole text (Markdown) for 'peek' and 'full'.
 *   - PeekToggle({ view, onToggle, label }): `label` names it (tooltip and screen reader).
 * @structure Peek({ view, line, children }) · PeekToggle({ view, onToggle, label }) · nextPeek(view)
 * @usage const [view, setView] = useState('peek');
 *        html`<${Peek} view=${view} line=${firstLine(text)}><${Markdown} text=${text} /><//>
 *          <${PeekToggle} view=${view} label=${t('profile.notebook.toggleView')} onToggle=${() => setView(nextPeek)} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Notebook note's three views as one component, with the look
 *     they had (page group G4, the notebook).
 */
import { h } from 'preact';
import htm from 'htm';
import { Icon } from '/components/Action.js';

const html = htm.bind(h);

/** The next way to show the text: line → peek → full → line. */
export function nextPeek(view) {
  return view === 'line' ? 'peek' : view === 'peek' ? 'full' : 'line';
}

export function Peek({ view = 'peek', line, children }) {
  if (view === 'line') return html`<div class="peek"><span class="peek-line">${line}</span></div>`;
  return html`<div class=${view === 'peek' ? 'peek peek--peek' : 'peek'}>${children}</div>`;
}

export function PeekToggle({ view, onToggle, label }) {
  return html`<${Icon} small title=${label} label=${label} onClick=${onToggle}>${view === 'full' ? '⌃' : '⌄'}<//>`;
}

export default Peek;
