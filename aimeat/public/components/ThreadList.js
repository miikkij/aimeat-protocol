/**
 * @file public/components/ThreadList.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person's conversations, as the rail beside the conversation (a drawer on a
 *   phone): a way back, a New button, one row per conversation with a delete, and whatever the page
 *   puts under the list. Its look is css/components/thread-list.css; the catalogue entry is
 *   `thread-list`.
 * @structure ThreadList({ threads, activeId, onOpen, onNew, onDelete, onClose, children })
 * @usage html`<${ThreadList} threads=${threads} activeId=${id} onOpen=${…} onNew=${…} onDelete=${…} onClose=${…}>…<//>`
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
 * The person's conversations.
 *
 * `onClose` is the way back on a phone, where this list covers the conversation and the header that
 * would otherwise carry the control is hidden. Without it, opening the list is a room with no door:
 * the only exit is picking a different conversation than the one you were reading.
 */
export function ThreadList({ threads, activeId, onOpen, onNew, onDelete, onClose, children }) {
    return html`
        <aside class="poster-conversation-rail">
            <button type="button" class="btn-ghost poster-conversation-rail-close" onClick=${onClose}>
                ↩ ${tr('chat.backToChat', 'Back to the conversation')}
            </button>
            <button type="button" class="poster-slab poster-slab--control poster-conversation-new" onClick=${onNew}>
                ${tr('chat.new', 'New conversation')}
            </button>
            ${threads.length === 0
                ? html`<p class="poster-quiet poster-conversation-empty">${tr('chat.noThreads', 'Nothing here yet. Say something and this is where it will be.')}</p>`
                : html`
                    <ul class="poster-thread-list">
                        ${threads.map((thread) => html`
                            <li key=${thread.id} class="poster-thread ${thread.id === activeId ? 'poster-thread--active' : ''}">
                                <button type="button" class="poster-thread-open" onClick=${() => onOpen(thread.id)}>
                                    <span class="poster-thread-title">${thread.title}</span>
                                    <span class="poster-thread-sub">${tr('chat.turnCount', '{n} messages').replace('{n}', String(thread.turns ?? 0))}</span>
                                </button>
                                <button type="button" class="btn-ghost poster-thread-del"
                                    aria-label=${tr('chat.delete', 'Delete conversation')}
                                    onClick=${() => onDelete(thread.id)}>✗</button>
                            </li>
                        `)}
                    </ul>`}
            ${children}
        </aside>
    `;
}

export default ThreadList;
