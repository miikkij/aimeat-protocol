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
import { CopyButton } from '/components/CopyButton.js';

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
        <div class="chat-cards">
            ${cards.map((card, i) => html`
                <div class=${'chat-card chat-card--' + (card.kind || 'page')} key=${card.url || card.ref || i}>
                    ${card.image && html`
                        <img class="chat-card-img" src=${card.image} alt=${card.title || ''} loading="lazy" />`}
                    <div class="chat-card-body">
                        <div class="chat-card-kind">${tr('chat.card.' + (card.kind || 'page'), card.kind || '')}</div>
                        <div class="chat-card-title">${card.title}</div>
                        ${card.ref && !card.url && html`<code class="chat-card-ref">${card.ref}</code>`}
                    </div>
                    ${card.url && html`
                        <a class="btn-outline chat-card-open" href=${card.url} target="_blank" rel="noopener noreferrer">
                            ${tr('chat.card.open', 'Open')}
                        </a>`}
                </div>`)}
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
                    : html`<${Markdown} text=${stripChoices(turn.text)} />`}
                <${ResultCards} cards=${turn.cards} />
                <${WorkLog} tools=${turn.tools} />
            </div>
            <div class="chat-meta">
                <span>${timeShort(turn.at)}</span>
                ${turn.model ? html`<span class="chat-model" title=${tr('chat.modelTitle', 'The model that answered this turn')}>${turn.model}</span>` : ''}
                <!-- The RAW markdown, which is what pastes usefully into an editor or another chat.
                     Same control and same behaviour as the message bubbles in the inbox. -->
                ${turn.text ? html`<${CopyButton} text=${String(turn.text)} className="btn-ghost chat-copy"
                    label="⧉" copiedLabel="✓"
                    title=${tr('chat.copyTurn', 'Copy this message')} copiedTitle=${t('common.copied')}
                    ariaLabel=${tr('chat.copyTurn', 'Copy this message')} />` : ''}
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
export function LiveTurn({ text, thought, tools, cards, busy }) {
    if (!busy && !text && (!tools || tools.length === 0)) return null;
    return html`
        <div class="chat-turn chat-turn--agent chat-turn--live">
            <div class="chat-bubble">
                ${text ? html`<${Markdown} text=${stripChoices(text)} />` : ''}
                ${!text && thought ? html`<p class="chat-thinking">${thought}</p>` : ''}
                ${!text && !thought && busy ? html`<p class="chat-thinking">${tr('chat.working', 'Working…')}</p>` : ''}
                <${ResultCards} cards=${cards} />
                <${WorkLog} tools=${tools} />
                ${busy && html`<${LiveStatus} tools=${tools} hasText=${!!text} />`}
            </div>
        </div>
    `;
}

/**
 * Proof that the turn is still alive.
 *
 * A turn takes minutes when the agent is building something, and the only signals the page had were
 * text arriving and the work log growing — both of which stop for long stretches while a model
 * thinks. With nothing moving, a working turn and a hung one look identical, and the honest reading
 * of a still screen is that something broke. So: what it is doing right now, and how long it has
 * been at it, ticking. The number is the part that cannot be faked by a spinner that would keep
 * spinning after the connection died.
 */
function LiveStatus({ tools, hasText }) {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        const started = Date.now();
        const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
        return () => clearInterval(id);
    }, []);

    const running = (tools ?? []).filter(t => t.status !== 'completed' && t.status !== 'failed');
    const what = running.length > 0
        ? tr('chat.busyTool', 'running {t}').replace('{t}', running[running.length - 1].title)
        : hasText
            ? tr('chat.busyWriting', 'writing the answer')
            : tr('chat.busyThinking', 'thinking');
    const clock = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

    return html`
        <div class="chat-live-status" role="status" aria-live="polite">
            <span class="chat-live-dot" aria-hidden="true"></span>
            <span>${what}</span>
            <span class="chat-live-clock">${clock}</span>
        </div>
    `;
}

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
        <div class="chat-credit">
            <a class="chat-credit-link" href="https://github.com/block/goose" target="_blank" rel="noopener noreferrer">
                <span class="chat-credit-mark" aria-hidden="true">🪿</span>
                <span>${tr('chat.poweredBy', 'Powered by goose')}</span>
            </a>
        </div>
    `;
}

/**
 * The fork an agent named, as data and as text.
 *
 * One definition for both halves: the buttons are drawn from the block and the block is taken OUT of
 * the prose, because a person who is looking at three buttons should not also be reading the same
 * three lines as a code fence above them. Two copies of this pattern in two files is how those two
 * halves come to disagree.
 */
const CHOICE_BLOCK = /```aimeat-choices\s*\n([\s\S]*?)```/;

/** The options an agent offered, at most six, each already trimmed of its bullet. */
export function choicesIn(text) {
    const m = CHOICE_BLOCK.exec(text || '');
    if (!m) return [];
    return m[1].split('\n')
        .map((line) => line.replace(/^\s*[-*\d.)\s]+/, '').trim())
        .filter((line) => line.length > 0 && line.length <= 120)
        .slice(0, 6);
}

/** The same answer with the block removed, which is what a person reads. */
export function stripChoices(text) {
    return (text || '').replace(CHOICE_BLOCK, '').trimEnd();
}

/**
 * The choices an agent offered, as buttons.
 *
 * Asking a clarifying question in prose puts the work back on the person: they have to invent the
 * answer, type it, and guess which words the agent will understand. Naming the options and letting
 * one be pressed is how every good assistant handles a fork — and the box stays open underneath,
 * because a list of three is never the whole space and pretending otherwise is worse than not
 * asking.
 *
 * The convention is the agent's, not the protocol's: a fenced ```aimeat-choices block, one option
 * per line. It survives any model and any version of goose, and a client that has never heard of it
 * shows a code block rather than breaking.
 */
export function Choices({ options, onPick, disabled }) {
    if (!options || options.length === 0) return null;
    return html`
        <div class="chat-choices">
            ${options.map((opt, i) => html`
                <button type="button" class="btn-outline chat-choice" key=${i}
                    disabled=${disabled} onClick=${() => onPick(opt)}>${opt}</button>`)}
            <span class="chat-choices-note">${tr('chat.choicesNote', 'or say something else')}</span>
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
    // What the person's OWN money is doing while the node pays for this conversation. Shown only
    // when it is not already the subject of the payer line, and worded so it cannot be read as a
    // limit on the chat: it is the allowance for everything else on the node, and a person who is
    // about to run out of it deserves to have seen it coming somewhere they actually look.
    const elsewhere = status.pays === 'node' && !status.has_own_key && remaining > 0
        ? tr('chat.allowanceElsewhere', '{n} USD of your allowance left, for everything outside this chat.')
            .replace('{n}', remaining.toFixed(2))
        : null;
    return html`
        <div class="chat-status">
            <span class="chat-status-agent">${status.agent_name}</span>
            ${payer && html`<span class="chat-status-key">${payer()}</span>`}
            ${elsewhere && html`<span class="chat-status-elsewhere">${elsewhere}</span>`}
            ${status.model && html`<span class="chat-model chat-status-model"
                title=${tr('chat.modelTitle', 'The model that answered this turn')}>${status.model}</span>`}
            ${onReset && html`
                <button type="button" class="btn-ghost chat-status-reset"
                    title=${tr('chat.resetTitle', 'Start a fresh agent session for this conversation. Needed after changing what the agent may do.')}
                    onClick=${onReset}>${tr('chat.reset', 'Reset session')}</button>`}
        </div>
    `;
}
