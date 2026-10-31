/**
 * @file public/components/Credit.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who actually answers here: the open-source agent's wordmark as a link to its source.
 *   Its look is css/components/credit.css; the catalogue entry is `credit`.
 * @structure GooseCredit({ model, open })
 * @usage html`<${GooseCredit} model=${status.model} />`
 * @version-history
 *   v1.2.0 — 2026-10-31 — The credit and the model name sit behind one "What answers here" toggle
 *     (v27 P7); the model left the status line for it.
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
/** @param {{ model?: string, open?: boolean }} [props] */
export function GooseCredit({ model, open = false } = {}) {
    // Behind one toggle, with the model that answers (v27 P7, 2026-10-31): a buyer's first screen read
    // "Moottorina goose" and a model id before anything they asked about. Still one press away.
    return html`
        <details class="poster-credit" open=${open}>
            <summary class="poster-action poster-action--more poster-credit-toggle">${tr('chat.aboutEngine', 'What answers here')}</summary>
            <div class="poster-credit-body">
                ${model && html`<span class="poster-turn-model" title=${tr('chat.modelTitle', 'The model that answered this turn')}>${model}</span>`}
                <a class="poster-action poster-action--more poster-credit-link" href="https://github.com/block/goose" target="_blank" rel="noopener noreferrer">
                    <span class="poster-credit-mark" aria-hidden="true">🪿</span>
                    <span>${tr('chat.poweredBy', 'Powered by goose')}</span>
                </a>
            </div>
        </details>
    `;
}

export default GooseCredit;
