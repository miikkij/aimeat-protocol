/**
 * @file public/components/WorkLog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The work log under one turn: what the agent did, in the person's words and folded by
 *   default. The summary names each kind of step once ("Reading the instructions ✓ · Publishing ✓"); the
 *   fold lists every tool call with its status as a word. Its look is css/components/work-log.css;
 *   the catalogue entry is `work-log`.
 *
 *   WHY FOLDED AND IN WORDS. Grok's walk of a store-bought node (2026-10-31, v31 K33 and K37): the
 *   log showed "aimeat handbook get" five times and lines reading "failed error", and the buyer could
 *   not tell whether anything had worked. A call that failed and was tried again is the agent's
 *   business; a kind of step that never succeeded is said once, in a sentence.
 * @structure WorkLog({ tools, ended }) · WorkLine({ tool, ended }) · stepKind(title) · workSummary(tools, ended)
 * @usage html`<${WorkLog} tools=${turn.tools} />`
 * @version-history
 *   v2.1.0 — 2026-10-31 — `ended`: a saved turn shows a call whose finished status never arrived with
 *     no running mark and no "starting" word (crew32 check turn: "Haen pohjan…" after the app was published).
 *   v2.0.0 — 2026-10-31 — Folded by default, with a summary in the person's words: one entry per kind
 *     of step, ✓ when one of them finished, and one sentence when a kind never did. The lines name the
 *     step in words, the tool's own name stays as the line's title (v31 K33, K37).
 *   v1.0.0 — 2026-09-23 — Moved out of views/chat/parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The kinds a tool call is shown as, in the order a summary lists them when they tie. */
const KIND_WORDS = {
    guide: 'Reading the instructions',
    template: 'Getting a starting point',
    publish: 'Publishing',
    propose: 'Proposing an agent',
    schedule: 'Setting the schedule',
    find: 'Looking for a tool',
    read: 'Looking up your information',
    write: 'Saving',
    work: 'Doing a step',
};

/**
 * Which kind of step a tool call is, from its title ("aimeat: aimeat handbook get",
 * "aimeat__aimeat_app_publish"). null for goose's own bookkeeping (its todo tool), which the person
 * does not need to see.
 * @param {string} title
 * @returns {keyof typeof KIND_WORDS | null}
 */
export function stepKind(title) {
    const s = String(title || '').toLowerCase().replace(/[_:]+/g, ' ');
    if (/^\s*todo\b/.test(s)) return null;
    if (/\b(handbook|skill get|skill list|prompt)\b/.test(s)) return 'guide';
    if (/\b(template|designbook|design book|genre)\b/.test(s)) return 'template';
    if (/\bpublish\b/.test(s)) return 'publish';
    if (/\bagent propose\b/.test(s)) return 'propose';
    if (/\bschedule\b/.test(s)) return 'schedule';
    if (/\btools find\b/.test(s)) return 'find';
    if (/\b(write|save|create|update|delete|send|install|set|append|replace|upload|post|approve)\b/.test(s)) return 'write';
    if (/\b(list|get|read|search|discover|overview|inbox|status|history|members|query|rows)\b/.test(s)) return 'read';
    return 'work';
}

/** A kind of step in the person's language. */
function kindWords(kind) {
    return tr(`chat.work.step.${kind}`, KIND_WORDS[kind]);
}

/**
 * The summary of a turn's calls: each kind once, in the order first seen, with whether one of them
 * finished, and whether a kind ended with none finished.
 * @param {Array<{ title?: string, status?: string }>} tools
 * @returns {{ kinds: Array<{ kind: string, done: boolean, running: boolean }>, stuck: boolean }}
 */
export function workSummary(tools, ended = false) {
    const byKind = new Map();
    for (const tool of tools || []) {
        const kind = stepKind(tool.title);
        if (!kind) continue;
        const k = byKind.get(kind) || { kind, done: false, running: false, failed: false };
        const status = String(tool.status || 'pending');
        if (status === 'completed') k.done = true;
        else if (status === 'failed') k.failed = true;
        // In a turn that has ended nothing runs: a call whose last word never reached the stream
        // is shown with no mark, not as still going.
        else if (!ended) k.running = true;
        byKind.set(kind, k);
    }
    const kinds = [...byKind.values()];
    return {
        kinds: kinds.map(({ kind, done, running }) => ({ kind, done, running })),
        stuck: kinds.some((k) => k.failed && !k.done && !k.running),
    };
}

/**
 * One tool call, as a line in the fold.
 *
 * The status is a word rather than a colour alone: a person who cannot see the difference between
 * two greens still has to be able to tell a call that finished from one that failed.
 */
export function WorkLine({ tool, ended = false }) {
    const status = String(tool.status || 'pending');
    const settled = status === 'completed' || status === 'failed';
    const label = ended && !settled ? '' : tr(`chat.work.${status}`, status);
    const kind = stepKind(tool.title);
    return html`
        <li class="poster-worklog-line poster-worklog-line--${status}" title=${tool.title || ''}>
            <span class="poster-worklog-status">${label}</span>
            <span class="poster-worklog-title">${kind ? kindWords(kind) : tr('chat.work.untitled', 'a tool call')}</span>
        </li>
    `;
}

/**
 * The work log for one turn: the summary in words, and every call behind the fold. `ended`: the turn
 * is over (a saved turn), so nothing in it is still running.
 */
export function WorkLog({ tools, ended = false }) {
    const shown = (tools || []).filter((tool) => stepKind(tool.title) !== null);
    if (shown.length === 0) return null;
    const { kinds, stuck } = workSummary(shown, ended);
    return html`
        <details class="poster-worklog">
            <summary class="poster-worklog-summary">
                <span class="poster-day-title poster-day-title--quiet poster-worklog-head">${tr('chat.work.title', 'What was done')}</span>
                <span class="poster-worklog-steps">
                    ${kinds.map((k, i) => html`${i > 0 ? ' · ' : ''}${kindWords(k.kind)}${k.done ? ' ✓' : k.running ? '…' : ''}`)}
                </span>
                ${stuck && html`<span class="poster-worklog-stuck">${tr('chat.work.stuck', 'One step did not go through.')}</span>`}
            </summary>
            <ul class="poster-worklog-list">
                ${shown.map((tool, i) => html`<${WorkLine} key=${i} tool=${tool} ended=${ended} />`)}
            </ul>
        </details>
    `;
}

export default WorkLog;
