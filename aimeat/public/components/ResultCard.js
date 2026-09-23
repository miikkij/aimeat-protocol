/**
 * @file public/components/ResultCard.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a turn produced, as things rather than as sentences about things: one card per
 *   result, with its kind, its title, a picture when there is one, and an Open button when it has an
 *   address. Its look is css/components/result-card.css; the catalogue entry is `result-card`.
 * @structure ResultCards({ cards })
 * @usage html`<${ResultCards} cards=${turn.cards} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/chat/parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * What a turn produced, as things rather than as sentences about things.
 *
 * The work log says a tool ran; this hands the result over. An address that only appears inside the
 * agent's prose is an address that scrolls away, and one that only exists in the live stream is a
 * link the person had a single chance to click — so cards are stored on the turn and drawn again
 * every time the conversation is opened.
 */
export function ResultCards({ cards }) {
    if (!cards || cards.length === 0) return null;
    return html`
        <div class="poster-results">
            ${cards.map((card, i) => html`
                <div class=${'poster-result poster-result--' + (card.kind || 'page')} key=${card.url || card.ref || i}>
                    ${card.image && html`
                        <img class="poster-result-img" src=${card.image} alt=${card.title || ''} loading="lazy" />`}
                    <div class="poster-result-body">
                        <div class="poster-result-kind">${tr('chat.card.' + (card.kind || 'page'), card.kind || '')}</div>
                        <div class="poster-result-title">${card.title}</div>
                        ${card.ref && !card.url && html`<code class="poster-result-ref">${card.ref}</code>`}
                    </div>
                    ${card.url && html`
                        <a class="btn-outline poster-result-open" href=${card.url} target="_blank" rel="noopener noreferrer">
                            ${tr('chat.card.open', 'Open')}
                        </a>`}
                </div>`)}
        </div>
    `;
}

export default ResultCards;
