/**
 * @file public/components/AgentStatus.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is answering, on whose money, and on which model, as a line of text with the
 *   session reset beside it. Its look is css/components/agent-status.css (the reset button's is
 *   css/components/rail-action.css); the catalogue entry is `agent-status`.
 * @structure StatusBar({ status, onReset })
 * @usage html`<${StatusBar} status=${status} onReset=${reset} />`
 * @version-history
 *   v1.1.0 — 2026-09-24 — "Use your own key →" is the action link's more tone (Jouni's decision
 *     "Small link").
 *   v1.0.0 — 2026-09-23 — Moved out of views/chat/parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * Who is answering, on whose money, and on which model.
 *
 * The payer is READ from the server (`status.pays`) rather than worked out here. This component used
 * to decide it from whether the person had a key stored, and told them "running on your own
 * OpenRouter key" while the node's key paid for every turn — a sentence about their own money that
 * described somebody else's. Only the node knows which key a turn is actually spent from, so only
 * the node gets to say.
 *
 * It is a line of text, not a gauge: this is not the thing they came here to look at.
 */
export function StatusBar({ status, onReset }) {
    if (!status) return null;
    const remaining = Number(status.allowance_remaining_usd ?? 0);
    const payer = {
        own: () => tr('chat.ownKey', 'Running on your own OpenRouter key.'),
        allowance: () => tr('chat.allowance', '{n} USD left of your allowance.').replace('{n}', remaining.toFixed(2)),
        node: () => tr('chat.nodeKey', 'The house pays for this conversation, on its own key.'),
    }[status.pays] ?? null;
    // What the person's OWN money is doing while the node pays for this conversation. Shown only
    // when it is not already the subject of the payer line, and worded so it cannot be read as a
    // limit on the chat: it is the allowance for everything else on the node, and a person who is
    // about to run out of it deserves to have seen it coming somewhere they actually look.
    const elsewhere = status.pays === 'node' && !status.has_own_key && remaining > 0
        ? tr('chat.allowanceElsewhere', '{n} USD of your allowance left, for everything outside this chat.')
            .replace('{n}', remaining.toFixed(2))
        : null;
    // The technical identity (a raw GAII like chat#alice@node-id) stays one hover away in the
    // title; a person new to all of this reads "Your agent", which is what it is. The full string
    // remains visible on the Agents tab, where identities are the subject.
    const ownKeyLink = status.pays === 'node' && !status.has_own_key
        ? tr('chat.useOwnKeyLink', 'Use your own key')
        : null;
    return html`
        <div class="poster-agent-status">
            <span class="poster-agent-status-who" title=${status.agent_name}>${tr('chat.statusYourAgent', 'Your agent')}</span>
            ${payer && html`<span>${payer()}</span>`}
            ${elsewhere && html`<span class="poster-agent-status-note">${elsewhere}</span>`}
            ${ownKeyLink && html`<a class="poster-action poster-action--more poster-agent-status-link" href="/v1/profile?tab=ai">${ownKeyLink} →</a>`}
            ${status.model && html`<span class="poster-turn-model poster-agent-status-model"
                title=${tr('chat.modelTitle', 'The model that answered this turn')}>${status.model}</span>`}
            ${onReset && html`
                <button type="button" class="poster-action poster-action--quiet poster-rail-action"
                    title=${tr('chat.resetTitle', 'Start a fresh agent session for this conversation. Needed after changing what the agent may do.')}
                    onClick=${onReset}>${tr('chat.reset', 'Reset session')}</button>`}
        </div>
    `;
}

export default StatusBar;
