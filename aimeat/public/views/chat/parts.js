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
 *   v1.2.0 — 2026-08-17 — StatusBar speaks human: "Your agent" with the raw GAII in the tooltip
 *     (the technical identity was the FIRST thing on a new person's screen), and when the node is
 *     paying with no own key stored, a small door to Profile › OpenRouter sits on the same line —
 *     the sentence about money is where a person actually reads about money.
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
import { AiInteractionNotice } from '/components/ai-label.js';
import { Modal } from '/components/Modal.js';
import { ImageView } from '/components/ImageDeliverable.js';

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
                ${/* An attachment is PRIVATE, and a private file is not something an <img src> can
                      fetch: the tag carries no Authorization header, so the picture the person just
                      sent renders as a broken frame in their own conversation. ImageView is the
                      component that already solves this — it fetches with the session and shows the
                      bytes as a blob — and reusing it keeps one answer to "how does an authed image
                      get on screen" rather than a second one living here. */''}
                ${(() => {
                    // `images` is what this field was called for a day; a record written then still
                    // renders.
                    const keys = turn.attachments ?? turn.images ?? [];
                    if (keys.length === 0) return null;
                    const isPicture = (k) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(k);
                    return html`
                        <div class="chat-turn-images">
                            ${keys.map((key) => (isPicture(key)
                                ? html`<${ImageView} key=${key}
                                    desc=${{ url: `/v1/storage/${encodeURIComponent(key)}`, alt: key }} />`
                                : html`<a class="chat-turn-file" key=${key} target="_blank" rel="noopener noreferrer"
                                    href=${`/v1/storage/${encodeURIComponent(key)}`}>📄 ${key.split('/').pop()}</a>`))}
                        </div>`;
                })()}
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

/**
 * That a machine is on the other end, said where a person is looking.
 *
 * Article 50(1) of the AI Act is about CONVERSING with a machine, and it is owed the moment the
 * conversation opens rather than when something is published — so this is never gated on a
 * provenance record and never suppressed by the operator's content-labelling switch. The shared
 * `AiInteractionNotice` carries the wording; the button opens the rest of it.
 *
 * WHY THE OFFICIAL EU ICON IS NOT ON IT. The icon set is for labelling CONTENT, and a chat turn on
 * this node carries no provenance record: the agent calls the model directly, outside the path that
 * mints one. Putting a content label on a turn we have no record for would be a legal claim nobody
 * made — the opposite of the honesty the label exists for. The icon belongs on an answer the day
 * these turns carry records, and this comment is the note to add it then.
 */
export function AiNotice({ compact = false }) {
    const [open, setOpen] = useState(false);
    return html`
        <div class=${'chat-ai-notice' + (compact ? ' chat-ai-notice--compact' : '')}>
            ${/* FULL the first time, one line after that. The duty is to make sure a person knows a
                  machine is on the other end, and somebody twenty messages into their fourth
                  conversation knows. Two lines and a button at the top of every screen from then on
                  is not more honest, it is the best space on the page spent on something already
                  read — and a notice people scroll past has stopped being a notice.

                  It is never removed, and it stays a control: the sentence still says what this is,
                  and the whole explanation is one press away wherever you are. */''}
            ${compact
                ? html`<span class="chat-ai-notice-line chat-ai-notice-short">${t('aiLabel.interactionTitle')}</span>`
                : html`<!-- The shared wording says "on your own API key", which is the app SDK's case
                             and not this one: here the node's own key pays. A true sentence in the
                             person's own context beats a shared one that is nearly right. -->
                       <${AiInteractionNotice} class="chat-ai-notice-line" bodyKey="chat.aiNoticeBody" />`}
            <button type="button" class="btn-ghost chat-ai-more" onClick=${() => setOpen(true)}>
                ${tr('chat.aiMore', 'What does that mean?')}
            </button>
            <${Modal} open=${open} onClose=${() => setOpen(false)}
                title=${tr('chat.aiDialogTitle', 'You are talking to an AI')}>
                <p>${tr('chat.aiDialogWhat', 'Every answer here is generated by a language model. It is written fresh each time, it is not looked up, and it can be wrong in ways that read as confident.')}</p>
                <p>${tr('chat.aiDialogCheck', 'Check anything that matters. The work log under each answer lists every tool call the agent made, so what it says it did can be verified rather than believed.')}</p>
                <p>${tr('chat.aiDialogLaw', 'This notice is the EU AI Act, Article 50(1): a person has the right to know they are dealing with a machine. Content published from here carries its own label, with the official EU icon, whenever a record of how it was made exists.')}</p>
            </${Modal}>
        </div>
    `;
}

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
        <div class="chat-nudge" role="note">
            <span class="chat-nudge-text">
                <strong>${tr('chat.nudgeMobileTitle', 'Put this on your phone')}</strong>
                ${' '}
                ${tr('chat.nudgeMobileBody', 'It installs as an app, and with notifications on I can tell you when something finishes instead of you coming back to check.')}
            </span>
            <button type="button" class="btn-ghost chat-nudge-dismiss" onClick=${onDismiss}>
                ${tr('chat.nudgeDismiss', 'Not now')}
            </button>
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
export function Composer({ value, onInput, onSend, onStop, onSpeak, onAttach, attachments = [], onDropAttachment,
    busy, disabled, note, listening, voiceMaxSeconds = 300 }) {
    const ref = useRef(null);
    const fileRef = useRef(null);

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
            ${/* Attached and not yet sent. Each one is removable: a picture picked by mistake should
                  cost one press, not a reload. */''}
            ${attachments.length > 0 && html`
                <div class="chat-attachments">
                    ${attachments.map((att) => html`
                        <span class=${'chat-attachment' + (att.state === 'error' ? ' chat-attachment--error' : '')} key=${att.id}>
                            ${att.preview && html`<img class="chat-attachment-thumb" src=${att.preview} alt="" />`}
                            <span class="chat-attachment-name">${att.name}</span>
                            ${att.state === 'uploading' && html`<span class="chat-attachment-state">${tr('chat.attachUploading', 'uploading…')}</span>`}
                            ${att.state === 'error' && html`<span class="chat-attachment-state">${att.error || tr('chat.attachFailed', 'failed')}</span>`}
                            <button type="button" class="btn-ghost chat-attachment-drop"
                                title=${tr('chat.attachRemove', 'Remove')}
                                onClick=${() => onDropAttachment(att.id)}>×</button>
                        </span>`)}
                </div>`}
            <div class="chat-composer-row">
                <textarea ref=${ref} class="chat-input" rows="1"
                    value=${value}
                    disabled=${disabled}
                    placeholder=${disabled
                        ? tr('chat.disabledPlaceholder', 'There is no chat agent here yet.')
                        : tr('chat.placeholder', 'Ask for something, or describe what you want built.')}
                    onInput=${(e) => onInput(e.target.value)}
                    onKeyDown=${keydown}></textarea>
                ${onAttach && !busy ? html`
                    <input type="file" multiple ref=${fileRef} class="chat-file-input"
                        onChange=${(e) => { onAttach([...e.target.files]); e.target.value = ''; }} />
                    <button type="button" class="btn-outline chat-attach" disabled=${disabled}
                        title=${tr('chat.attachTitle', 'Attach a file')}
                        onClick=${() => fileRef.current?.click()}>📎</button>` : ''}
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
        <div class="chat-status">
            <span class="chat-status-agent" title=${status.agent_name}>${tr('chat.statusYourAgent', 'Your agent')}</span>
            ${payer && html`<span class="chat-status-key">${payer()}</span>`}
            ${elsewhere && html`<span class="chat-status-elsewhere">${elsewhere}</span>`}
            ${ownKeyLink && html`<a class="chat-status-ownkey" href="/v1/profile?tab=generator">${ownKeyLink} →</a>`}
            ${status.model && html`<span class="chat-model chat-status-model"
                title=${tr('chat.modelTitle', 'The model that answered this turn')}>${status.model}</span>`}
            ${onReset && html`
                <button type="button" class="btn-ghost chat-status-reset"
                    title=${tr('chat.resetTitle', 'Start a fresh agent session for this conversation. Needed after changing what the agent may do.')}
                    onClick=${onReset}>${tr('chat.reset', 'Reset session')}</button>`}
        </div>
    `;
}
