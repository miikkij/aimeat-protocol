/**
 * @file public/components/Suggestion.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Things a person can press instead of typing: the starter suggestions on an empty
 *   conversation, and the choices an agent offered in a fenced ```aimeat-choices block. Its look is
 *   css/components/suggestion.css; the catalogue entry is `suggestion`.
 * @structure Suggestions({ children }) · Suggestion({ disabled, onClick, children }) ·
 *   Choices({ options, onPick, disabled, question, chosen, other }) · choicesIn(text) · stripChoices(text)
 * @usage html`<${Choices} options=${choicesIn(text)} onPick=${send} />`
 *        html`<${Choices} question=${p.question} options=${p.options} onPick=${answer} disabled=${locked}
 *          chosen=${answered} other=${{ label: t('x.other'), onPick: writeOther, chosen: otherChosen }} />`
 *   `question`: the choices answer a question the agent asked (an agent's option-prompt in its
 *   Messages tab): its words stand over them, `chosen` is the answer already given (coral, pressed,
 *   still full while the others are greyed), `other` one more choice in italics that hands the
 *   question to the typing box, and `disabled` greys them once a newer message has locked the question.
 * @version-history
 *   v1.2.0 — 2026-09-26 — Choices takes `question`, `chosen` and `other` (an agent's option-prompt
 *     from its Messages tab), putting back main's markers the previous branch lost there: the chosen
 *     answer in coral, "Other" in italics, a locked question's choices greyed. Additive: without
 *     `question` the chat's choices draw as before.
 *   v1.1.0 — 2026-09-24 — `caps` removed: every suggestion reads as a sentence (Jouni's decision
 *     "Suggestion").
 *   v1.0.0 — 2026-09-23 — Choices, choicesIn and stripChoices moved out of views/chat/parts.js, and
 *     the starter row out of views/chat.js, with their markup unchanged (UI consolidation phase 1,
 *     a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * The fork an agent named, as data and as text.
 *
 * One definition for both halves: the buttons are drawn from the block and the block is taken OUT of
 * the prose, because a person who is looking at three buttons should not also be reading the same
 * three lines as a code fence above them. Two copies of this pattern in two files is how those two
 * halves come to disagree.
 */
const CHOICE_BLOCK = /```aimeat-choices\s*\n([\s\S]*?)```/;

/** The options an agent offered, at most six, each already trimmed of its bullet. */
export function choicesIn(text) {
    const m = CHOICE_BLOCK.exec(text || '');
    if (!m) return [];
    return m[1].split('\n')
        .map((line) => line.replace(/^\s*[-*\d.)\s]+/, '').trim())
        .filter((line) => line.length > 0 && line.length <= 120)
        .slice(0, 6);
}

/** The same answer with the block removed, which is what a person reads. */
export function stripChoices(text) {
    return (text || '').replace(CHOICE_BLOCK, '').trimEnd();
}

/** A row of suggestions to press. */
export function Suggestions({ children }) {
    return html`
                            <div class="poster-suggestions">
                                ${children}
                            </div>`;
}

/** One suggestion, read as a sentence (Jouni's decision "Suggestion": the starters' capitals went). */
export function Suggestion({ disabled, onClick, children }) {
    return html`
                                    <button type="button" class="btn-outline poster-suggestion"
                                        disabled=${disabled}
                                        onClick=${onClick}>
                                        ${children}
                                    </button>`;
}

/**
 * The choices an agent offered, as buttons.
 *
 * Asking a clarifying question in prose puts the work back on the person: they have to invent the
 * answer, type it, and guess which words the agent will understand. Naming the options and letting
 * one be pressed is how every good assistant handles a fork — and the box stays open underneath,
 * because a list of three is never the whole space and pretending otherwise is worse than not
 * asking.
 *
 * The convention is the agent's, not the protocol's: a fenced ```aimeat-choices block, one option
 * per line. It survives any model and any version of goose, and a client that has never heard of it
 * shows a code block rather than breaking.
 */
export function Choices({ options, onPick, disabled, question, chosen, other }) {
    if (question !== undefined && question !== null) {
        return html`<${AskedChoices} question=${question} options=${options} onPick=${onPick}
            disabled=${disabled} chosen=${chosen} other=${other} />`;
    }
    if (!options || options.length === 0) return null;
    return html`
        <div class="poster-choices">
            ${options.map((opt, i) => html`
                <button type="button" class="btn-outline poster-suggestion" key=${i}
                    disabled=${disabled} onClick=${() => onPick(opt)}>${opt}</button>`)}
            <span class="poster-choices-note">${tr('chat.choicesNote', 'or say something else')}</span>
        </div>
    `;
}

/**
 * The choices under a question the agent asked: its words over them, the answer already given in
 * coral and pressed, "Other" in italics (it hands the question to the typing box), all of them greyed
 * once a newer message has locked the question.
 */
function AskedChoices({ question, options, onPick, disabled, chosen, other }) {
    const cls = (on, extra) => ['btn-outline', 'poster-suggestion', extra, on && 'poster-suggestion--chosen'].filter(Boolean).join(' ');
    return html`
        <div class="poster-choices poster-choices--asked">
            <p class="poster-choices-q">${question}</p>
            ${(options || []).map((opt) => html`
                <button type="button" class=${cls(chosen === opt)} key=${opt}
                    aria-pressed=${chosen === opt ? 'true' : undefined}
                    disabled=${disabled} onClick=${() => onPick(opt)}>${opt}</button>`)}
            ${other ? html`
                <button type="button" class=${cls(other.chosen, 'poster-suggestion--other')}
                    aria-pressed=${other.chosen ? 'true' : undefined}
                    disabled=${disabled} onClick=${() => other.onPick?.()}>${other.label}</button>` : null}
        </div>
    `;
}

export default Suggestion;
