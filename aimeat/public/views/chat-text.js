/**
 * @file public/views/chat-text.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chat's text helpers: the words without tool markers, the conversation as plain
 *   text, the session's token ceiling, and which conversations get a row. Moved out of views/chat.js
 *   unchanged when it reached 800 lines (max-file-lines).
 * @structure withoutToolMarkers · conversationAsText · sessionTokenCap · sessionTokensOf · spokenThreads
 * @usage import { withoutToolMarkers, conversationAsText } from './chat-text.js';
 * @version-history
 *   v1.0.0 — 2026-11-01 — Moved from views/chat.js unchanged (max-file-lines).
 */
import { t } from '/js/i18n.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * The words without the "[Calling: <tool>]" lines a model writes as text when it means a tool call.
 * The work log shows the calls that ran; such a line is a duplicate or a call that never happened.
 * The node strips the same patterns from what it keeps (services/chat-session.ts withoutToolMarkers),
 * the pieces of a tool call the model wrote in its own syntax included (v31 K36).
 */
export function withoutToolMarkers(text) {
    return text
        .replace(/^[ \t]*\[Calling: [^\]\n]*\][ \t]*(\r?\n)?/gm, '')
        .replace(/<\/?｜?DSML｜[^>\n]*>?/g, '')
        .replace(/(?:[^\s"]*="[^"\n]*"|[^\s"]+")\s+string="[^\n]*/g, '')
        .replace(/\n{3,}/g, '\n\n');
}

/**
 * The conversation as plain text, in the order it happened.
 *
 * Who said what, and nothing else: no tool log, no timestamps to the second, no markdown fences
 * around the whole thing. This is the shape that pastes into a document or another chat and still
 * reads as a conversation.
 */
export function conversationAsText(title, turns) {
    const head = title ? `# ${title}\n\n` : '';
    const body = (turns ?? []).map((turn) => {
        const who = turn.role === 'user' ? tr('chat.youLabel', 'You') : tr('chat.agentLabel', 'Agent');
        return `## ${who}\n\n${(turn.text || '').trim()}`;
    }).join('\n\n');
    return `${head}${body}\n`;
}

/**
 * The free ride has a ceiling. A chat turn runs on the node's own key (status.pays === 'node'),
 * and an uncapped session on somebody else's money is an invoice with no top. The ceiling is
 * enforced HERE, at request level: past it the composer stands down and the person is offered
 * the two honest ways forward — their own key, or their own place. Never a silent cutoff.
 *
 * TODO(server): the authoritative cap belongs next to the payer — a config setting (e.g.
 * AIMEAT_CHAT_SESSION_TOKEN_CAP, with a CONFIG_FIELDS row) read by POST /v1/chat/threads/:id/turn
 * in src/routes/chat.ts — and the cheapest-capable-model choice with it: the session model is
 * AIMEAT_GOOSE_MODEL, operator-set, and this file cannot pick it. Until that lands, this
 * request-level guard is the cap.
 *
 * Four characters per token is the coarse rule of thumb; the job is a ceiling with a managed
 * landing, not billing-grade accounting. The sessionStorage override exists so the landing can
 * be VERIFIED in a browser without first spending 50k tokens of somebody's money.
 */
const SESSION_TOKEN_CAP = 50_000;
export function sessionTokenCap() {
    try {
        const t = parseInt(sessionStorage.getItem('aimeat.chat.cap') ?? '', 10);
        if (Number.isFinite(t) && t > 0) return t;
    } catch (err) { console.warn('[chat] cap override not readable:', err.message); }
    return SESSION_TOKEN_CAP;
}
export const sessionTokensOf = (turns) =>
    Math.ceil((turns ?? []).reduce((n, turn) => n + (turn.text || '').length, 0) / 4);

/**
 * The conversations worth a row: the ones with a message. An empty one says nothing a person can
 * go back to, and the ones stored before New stopped creating them stay on the node, out of the list.
 */
export const spokenThreads = (threads) => (threads ?? []).filter((th) => (th.turns ?? 0) > 0);
