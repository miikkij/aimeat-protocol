/**
 * @file public/components/WorkLog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The work log under one turn: every tool call it made, in the order it made them, one
 *   line each with its status as a word. Its look is css/components/work-log.css; the catalogue
 *   entry is `work-log`.
 * @structure WorkLog({ tools }) · WorkLine({ tool })
 * @usage html`<${WorkLog} tools=${turn.tools} />`
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
 * One tool call, as a line in the work log.
 *
 * The status is a word rather than a colour alone: a person who cannot see the difference between
 * two greens still has to be able to tell a call that finished from one that failed.
 */
export function WorkLine({ tool }) {
    const status = String(tool.status || 'pending');
    const label = tr(`chat.work.${status}`, status);
    return html`
        <li class="poster-worklog-line poster-worklog-line--${status}">
            <span class="poster-worklog-status">${label}</span>
            <span class="poster-worklog-title">${tool.title || tr('chat.work.untitled', 'a tool call')}</span>
        </li>
    `;
}

/** The work log for one turn: every tool call it made, in the order it made them. */
export function WorkLog({ tools }) {
    if (!tools || tools.length === 0) return null;
    return html`
        <div class="poster-worklog">
            <div class="poster-day-title poster-day-title--quiet poster-worklog-head">${tr('chat.work.title', 'What was done')}</div>
            <ul class="poster-worklog-list">
                ${tools.map((tool, i) => html`<${WorkLine} key=${i} tool=${tool} />`)}
            </ul>
        </div>
    `;
}

export default WorkLog;
