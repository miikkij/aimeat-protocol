/**
 * @file public/components/QuestionDesk.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The question desk: the one large search field a page is built around, the scope
 *   beside it (tabs, each with its count), and one grey line under both. Enter asks. A page passes
 *   the words, the scopes and what happens; it never writes a class. Its look is
 *   css/components/question-desk.css (.question-desk, .question-desk-field); the scope row is the
 *   Tabs component.
 * @structure QuestionDesk({ value, placeholder, label, onInput, onEnter, scopes, scope, onScope, scopeLabel, hint })
 * @usage html`<${QuestionDesk} value=${q} placeholder=${c('ask')} onInput=${setQ} onEnter=${submit}
 *   scopes=${[{ value: 'own', label: t('discover.scope.own'), count: '120' }]} scope=${scope} onScope=${setScope}
 *   hint=${c('hint')} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: Discover's search desk as a component (page group G8). The count
 *     in a scope tab is the tab's Count (the Count look, a unification per the page family's map).
 *   v1.1.0 — 2026-09-27 — Draws its own names: .dv-desk is .question-desk and .dv-field is
 *     .question-desk-field (a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { Tabs } from '/components/Tabs.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/** `onInput(value, e)`; `onEnter(e)` on Enter; a scope's `count` '' draws none. */
export function QuestionDesk({ value, placeholder, label, onInput, onEnter, scopes, scope, onScope, scopeLabel, hint }) {
  return html`
    <div class="question-desk poster-row--thing">
      <input type="search" class="question-desk-field"value=${value} placeholder=${placeholder} aria-label=${label || placeholder}
        onInput=${(e) => onInput?.(e.target.value, e)} onKeyDown=${(e) => { if (e.key === 'Enter') onEnter?.(e); }} />
      ${scopes && scopes.length ? html`<${Tabs} label=${scopeLabel} value=${scope} onSelect=${onScope}
        items=${scopes.map((s) => ({ ...s, count: s.count === '' || s.count === null ? undefined : s.count }))} />` : null}
      ${hint ? html`<${Note}>${hint}<//>` : null}
    </div>`;
}

export default QuestionDesk;
