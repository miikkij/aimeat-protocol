/**
 * @file public/components/ConversationFrame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The frame of a conversation page: the rail beside it (ThreadList), the column with
 *   its head, the scrolling turns, the jump-to-latest button, the ceiling note when the free share
 *   is spent, and the parts of the rail that describe this conversation. Its look is
 *   css/components/conversation-frame.css; the catalogue entry is `conversation-frame`.
 * @structure
 *   - ConversationFrame({ list, signin, children }) — the whole page; `list` opens the rail on a phone
 *   - ConversationAbout({ label, name, children }) — this conversation's name, in the rail
 *   - ConversationFoot({ children }) — the rail's foot
 *   - ConversationMain({ children }) — the column
 *   - ConversationHead({ backHref, backLabel, title, children }) — the phone's head row
 *   - ConversationIcon({ label, onClick, children }) — a square icon button in the head
 *   - ConversationScroll({ onScroll, children }) — the scrolling turns
 *   - ConversationWelcome({ title, body, trust, children }) — the empty conversation's first words
 *   - ConversationJump({ onClick, children }) — back to the latest turn
 *   - ConversationCap({ title, body, children }) — the free share is spent, and the ways on
 * @usage html`<${ConversationFrame} list=${open}><${ThreadList} …/><${ConversationMain}>…<//><//>`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/chat.js with its markup unchanged (UI consolidation
 *     phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function ConversationFrame({ list = false, signin = false, children }) {
    return html`
        <div class=${'poster-conversation' + (signin ? ' poster-conversation--signin' : '') + (list ? ' poster-conversation--list' : '')}>
            ${children}
        </div>`;
}

export function ConversationAbout({ label, name, children }) {
    return html`
                <div class="poster-conversation-about">
                    <h2 class="poster-conversation-label">${label}</h2>
                    <p class="poster-conversation-name">${name}</p>
                    ${children}
                </div>`;
}

export function ConversationFoot({ children }) {
    return html`
                <div class="poster-conversation-foot">
                    ${children}
                </div>`;
}

export function ConversationMain({ children }) {
    return html`
            <section class="poster-conversation-main">
                ${children}
            </section>`;
}

/**
 * The head row. On a phone the page owns the whole screen and the site nav is hidden, so without
 * the back link there is NO way back to anything. The whole row is phone-only via CSS: on a desktop
 * the rail carries the name and the actions.
 */
export function ConversationHead({ backHref, backLabel, title, children }) {
    return html`
                <header class="poster-conversation-head">
                    <a class="poster-conversation-back" href=${backHref}
                        aria-label=${backLabel}>← ${backLabel}</a>
                    <h1 class="poster-conversation-title">${title}</h1>
                    ${children}
                </header>`;
}

export function ConversationIcon({ label, onClick, children }) {
    return html`
                    <button type="button" class="poster-conversation-icon poster-conversation-toggle"
                        aria-label=${label}
                        title=${label}
                        onClick=${onClick}>${children}</button>`;
}

export function ConversationScroll({ onScroll, children }) {
    return html`
                <div class="poster-conversation-scroll" onScroll=${onScroll}>
                    ${children}
                </div>`;
}

export function ConversationWelcome({ title, body, trust, children }) {
    return html`
                        <div class="poster-conversation-welcome">
                            <h2 class="poster-section-title">${title}</h2>
                            <p>${body}</p>
                            <p class="poster-conversation-welcome-trust">${trust}</p>
                            ${children}
                        </div>`;
}

export function ConversationJump({ onClick, children }) {
    return html`
                    <button type="button" class="btn-outline poster-conversation-jump"
                        onClick=${onClick}>
                        ${children}
                    </button>`;
}

export function ConversationCap({ title, body, children }) {
    return html`
                    <div class="poster-conversation-cap">
                        <p class="poster-conversation-cap-title">${title}</p>
                        <p class="poster-conversation-cap-body">${body}</p>
                        <div class="poster-conversation-cap-actions">
                            ${children}
                        </div>
                    </div>`;
}

export default ConversationFrame;
