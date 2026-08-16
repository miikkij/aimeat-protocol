/**
 * @file public/views/chat/parts.js
 * @description What the chat page is made of: the conversation list, one turn, the work log, and
 *   the box a person types into.
 *
 *   Two registers share one column. The conversation is what was said; the work log is what was
 *   actually done, one line per tool call, and it is shown by default rather than folded away. A
 *   chat that reports "done" without showing the calls asks to be believed; this one can be checked.
 * @structure
 *   - ThreadList — the person's conversations
 *   - Turn — one thing said, with the tools that ran while it was said
 *   - WorkLine — one tool call, its status, and what it was
 *   - Composer — the box, Enter to send, Shift+Enter for a newline, and a recorder beside it
 *   - StatusBar — which agent, what is left to spend, and what is wrong when something is
 * @usage import { ThreadList, Turn, Composer, StatusBar } from './chat/parts.js';
 * @version-history
 *   v1.1.0 — 2026-08-16 — Speech both ways: a recording becomes text in the box, which the person
 *     reads before sending, and an agent turn can be read aloud.
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { h } from 'preact';
import { useRef, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';
import { speak, stop as stopSpeaking, isSpeechSupported, textToParagraphs } from '/js/services/speech-reader.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** hh:mm in the reader's own locale, which is all a turn needs. */
function timeShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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
        <li class="chat-work-line chat-work-line--${status}">
            <span class="chat-work-status">${label}</span>
            <span class="chat-work-title">${tool.title || tr('chat.work.untitled', 'a tool call')}</span>
        </li>
    `;
}

/** The work log for one turn: every tool call it made, in the order it made them. */
export function WorkLog({ tools }) {
    if (!tools || tools.length === 0) return null;
    return html`
        <div class="chat-work">
            <div class="chat-work-head">${tr('chat.work.title', 'What was done')}</div>
            <ul class="chat-work-list">
                ${tools.map((tool, i) => html`<${WorkLine} key=${i} tool=${tool} />`)}
            </ul>
        </div>
    `;
}

/**
 * One turn.
 *
 * The agent's words go through the markdown renderer because the agent writes markdown; the
 * person's do not, because what they typed is what they meant.
 */
export function Turn({ turn, id }) {
    const mine = turn.role === 'user';
    const [reading, setReading] = useState(false);
    // A turn that failed before the agent said anything leaves an empty record, and an empty bubble
    // on screen reads as a message that arrived blank. Nothing was said, so nothing is drawn; the
    // error above it is what happened.
    if (!mine && !turn.text && !(turn.tools && turn.tools.length)) return null;

    const listen = () => {
        if (reading) { stopSpeaking(); setReading(false); return; }
        setReading(speak(id, textToParagraphs(turn.text || '')));
    };

    return html`
        <div class="chat-turn chat-turn--${mine ? 'user' : 'agent'}">
            <div class="chat-bubble">
                ${mine
                    ? html`<p class="chat-said">${turn.text}</p>`
                    : html`<${Markdown} text=${turn.text || ''} />`}
                <${WorkLog} tools=${turn.tools} />
            </div>
            <div class="chat-meta">
                <span>${timeShort(turn.at)}</span>
                ${turn.model ? html`<span class="chat-model" title=${tr('chat.modelTitle', 'The model that answered this turn')}>${turn.model}</span>` : ''}
                ${!mine && turn.text && isSpeechSupported() ? html`
                    <button type="button" class="btn-ghost chat-listen" onClick=${listen}>
                        ${reading ? tr('chat.stopListening', 'Stop') : tr('chat.listen', 'Listen')}
                    </button>` : ''}
            </div>
        </div>
    `;
}

/**
 * What the agent is doing right now, before the turn is over.
 *
 * A person watching a spinner for four minutes cannot tell work from a hang, so the live turn shows
 * the words as they are written and each tool call as it starts.
 */
export function LiveTurn({ text, thought, tools, busy }) {
    if (!busy && !text && (!tools || tools.length === 0)) return null;
    return html`
        <div class="chat-turn chat-turn--agent chat-turn--live">
            <div class="chat-bubble">
                ${text ? html`<${Markdown} text=${text} />` : ''}
                ${!text && thought ? html`<p class="chat-thinking">${thought}</p>` : ''}
                ${!text && !thought && busy ? html`<p class="chat-thinking">${tr('chat.working', 'Working…')}</p>` : ''}
                <${WorkLog} tools=${tools} />
            </div>
        </div>
    `;
}

/** A turn that could not run, with the reason and a way to try again. */
export function TurnError({ message, onRetry }) {
    if (!message) return null;
    return html`
        <div class="chat-error" role="alert">
            <p class="chat-error-msg">${message}</p>
            ${onRetry && html`
                <button type="button" class="btn-outline chat-error-retry" onClick=${onRetry}>
                    ${tr('chat.retry', 'Try again')}
                </button>`}
        </div>
    `;
}

/**
 * The person's conversations.
 *
 * `onClose` is the way back on a phone, where this list covers the conversation and the header that
 * would otherwise carry the control is hidden. Without it, opening the list is a room with no door:
 * the only exit is picking a different conversation than the one you were reading.
 */
export function ThreadList({ threads, activeId, onOpen, onNew, onDelete, onClose }) {
    return html`
        <aside class="chat-threads">
            <button type="button" class="btn-ghost chat-threads-close" onClick=${onClose}>
                ↩ ${tr('chat.backToChat', 'Back to the conversation')}
            </button>
            <button type="button" class="btn-primary chat-new" onClick=${onNew}>
                ${tr('chat.new', 'New conversation')}
            </button>
            ${threads.length === 0
                ? html`<p class="chat-threads-empty">${tr('chat.noThreads', 'Nothing here yet. Say something and this is where it will be.')}</p>`
                : html`
                    <ul class="chat-thread-list">
                        ${threads.map((thread) => html`
                            <li key=${thread.id} class="chat-thread ${thread.id === activeId ? 'chat-thread--active' : ''}">
                                <button type="button" class="chat-thread-open" onClick=${() => onOpen(thread.id)}>
                                    <span class="chat-thread-title">${thread.title}</span>
                                    <span class="chat-thread-sub">${tr('chat.turnCount', '{n} messages').replace('{n}', String(thread.turns ?? 0))}</span>
                                </button>
                                <button type="button" class="btn-ghost chat-thread-del"
                                    aria-label=${tr('chat.delete', 'Delete conversation')}
                                    onClick=${() => onDelete(thread.id)}>✗</button>
                            </li>
                        `)}
                    </ul>`}
        </aside>
    `;
}

/**
 * The box.
 *
 * Enter sends and Shift+Enter opens a line, which is what every chat does and therefore what a
 * person's hands already expect. The field grows with what is in it up to a ceiling, so a long ask
 * is readable while being written without the composer eating the conversation.
 */
export function Composer({ value, onInput, onSend, onStop, onSpeak, busy, disabled, note, listening, voiceMaxSeconds = 300 }) {
    const ref = useRef(null);

    // Re-measured on a resize as well as on every keystroke. Height depends on WIDTH: a line that
    // fits on a desktop wraps on a phone, and a height measured before the turn left the field
    // scrolling by two pixels behind a scrollbar nobody wanted.
    useEffect(() => {
        const fit = () => {
            const el = ref.current;
            if (!el) return;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
        };
        fit();
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
    }, [value]);

    const keydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!busy && !disabled && value.trim()) onSend();
        }
    };

    return html`
        <div class="chat-composer">
            ${note ? html`<p class="chat-composer-note">${note}</p>` : ''}
            ${listening ? html`<p class="chat-composer-note">${tr('chat.hearing', 'Working out what you said…')}</p>` : ''}
            <div class="chat-composer-row">
                <textarea ref=${ref} class="chat-input" rows="1"
                    value=${value}
                    disabled=${disabled}
                    placeholder=${disabled
                        ? tr('chat.disabledPlaceholder', 'This node has no chat agent yet.')
                        : tr('chat.placeholder', 'Ask for something, or describe what you want built.')}
                    onInput=${(e) => onInput(e.target.value)}
                    onKeyDown=${keydown}></textarea>
                ${onSpeak && !busy ? html`
                    <${VoiceRecorder} maxSeconds=${voiceMaxSeconds} disabled=${disabled || listening}
                        className="btn-outline chat-voice" onRecorded=${(file) => onSpeak(file)} />` : ''}
                ${busy
                    ? html`<button type="button" class="btn-outline chat-send" onClick=${onStop}>${tr('chat.stop', 'Stop')}</button>`
                    : html`<button type="button" class="btn-primary chat-send"
                        disabled=${disabled || !value.trim()}
                        onClick=${onSend}>${tr('chat.send', 'Send')}</button>`}
            </div>
        </div>
    `;
}

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
        node: () => tr('chat.nodeKey', 'This node pays for the conversation, on its own key.'),
    }[status.pays] ?? null;
    return html`
        <div class="chat-status">
            <span class="chat-status-agent">${status.agent_name}</span>
            ${payer && html`<span class="chat-status-key">${payer()}</span>`}
            ${status.model && html`<span class="chat-model chat-status-model"
                title=${tr('chat.modelTitle', 'The model that answered this turn')}>${status.model}</span>`}
            ${onReset && html`
                <button type="button" class="btn-ghost chat-status-reset"
                    title=${tr('chat.resetTitle', 'Start a fresh agent session for this conversation. Needed after changing what the agent may do.')}
                    onClick=${onReset}>${tr('chat.reset', 'Reset session')}</button>`}
        </div>
    `;
}
