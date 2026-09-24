/**
 * @file public/components/Credit.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who actually answers here: the open-source agent's wordmark as a link to its source.
 *   Its look is css/components/credit.css; the catalogue entry is `credit`.
 * @structure GooseCredit()
 * @usage html`<${GooseCredit} />`
 * @version-history
 *   v1.1.0 — 2026-09-24 — The link is the action link's more tone (Jouni's decision "Small link").
 *   v1.0.0 — 2026-09-23 — Moved out of views/chat/parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * Who actually answers here.
 *
 * The agent in this chat is goose (block/goose), an open-source project this node did not write and
 * could not have shipped this page without. Attribution is not decoration on somebody else's work:
 * a person watching an answer arrive should be able to see whose agent wrote it and go and read the
 * source. The mark is their wordmark as a link, not a copy of their logo file, because we do not
 * ship an asset we were not given.
 */
export function GooseCredit() {
    return html`
        <div class="poster-credit">
            <a class="poster-action poster-action--more poster-credit-link" href="https://github.com/block/goose" target="_blank" rel="noopener noreferrer">
                <span class="poster-credit-mark" aria-hidden="true">🪿</span>
                <span>${tr('chat.poweredBy', 'Powered by goose')}</span>
            </a>
        </div>
    `;
}

export default GooseCredit;
