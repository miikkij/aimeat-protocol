/**
 * @file public/components/Nudge.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A one-line suggestion with a way to say not now: today the nudge to put the chat on a
 *   phone. Its look is css/components/nudge.css; the catalogue entry is `nudge`.
 * @structure MobileNudge({ onDismiss })
 * @usage html`<${MobileNudge} onDismiss=${dismiss} />`
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
 * The one thing that turns this from a website into an assistant: being reachable.
 *
 * Shown when the node says nobody's device is subscribed AND this browser is a desktop one. Both
 * halves matter. The device count is the node's answer, not this browser's, because a desktop that
 * has never subscribed knows nothing about the phone in somebody's pocket — and telling a person to
 * set up something they set up last week is how a product teaches people to ignore it. The desktop
 * test is a pointer test rather than a user-agent string: what is being asked is "is this the device
 * you carry", and a fine pointer with no touch answers that better than a name that lies.
 *
 * Dismissal is permanent and stored with the person, not with the browser, for the same reason.
 */
export function MobileNudge({ onDismiss }) {
    return html`
        <div class="poster-nudge" role="note">
            <span class="poster-nudge-text">
                <strong>${tr('chat.nudgeMobileTitle', 'Put this on your phone')}</strong>
                ${' '}
                ${tr('chat.nudgeMobileBody', 'It installs as an app, and with notifications on I can tell you when something finishes instead of you coming back to check.')}
            </span>
            <button type="button" class="btn-ghost poster-nudge-dismiss" onClick=${onDismiss}>
                ${tr('chat.nudgeDismiss', 'Not now')}
            </button>
        </div>
    `;
}

export default MobileNudge;
