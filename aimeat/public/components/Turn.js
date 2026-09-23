/**
 * @file public/components/Turn.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One thing said in a conversation, with what it produced and the tools that ran while
 *   it was said; the live turn while an answer is still being written; and a turn that could not
 *   run. Its look is css/components/turn.css; the catalogue entry is `turn`.
 * @structure Turn({ turn, id }) · LiveTurn({ text, thought, tools, cards, busy }) ·
 *   TurnError({ message, onRetry })
 * @usage html`<${Turn} key=${i} id=${`${thread.id}-${i}`} turn=${turn} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/chat/parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { speak, stop as stopSpeaking, isSpeechSupported, textToParagraphs } from '/js/services/speech-reader.js';
import { CopyButton } from '/components/CopyButton.js';
import { ImageView } from '/components/ImageDeliverable.js';
import { time as fmtTime } from '/js/format.js';
import { WorkLog } from '/components/WorkLog.js';
import { ResultCards } from '/components/ResultCard.js';
import { stripChoices } from '/components/Suggestion.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** hh:mm in the reader's own locale, which is all a turn needs. */
function timeShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : fmtTime(d, { hour: '2-digit', minute: '2-digit' });
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
        <div class="poster-turn poster-turn--${mine ? 'user' : 'agent'}">
            <div class="poster-turn-body">
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
                        <div class="poster-turn-images">
                            ${keys.map((key) => (isPicture(key)
                                ? html`<${ImageView} key=${key}
                                    desc=${{ url: `/v1/storage/${encodeURIComponent(key)}`, alt: key }} />`
                                : html`<a class="poster-turn-file" key=${key} target="_blank" rel="noopener noreferrer"
                                    href=${`/v1/storage/${encodeURIComponent(key)}`}>📄 ${key.split('/').pop()}</a>`))}
                        </div>`;
                })()}
                ${mine
                    ? html`<p class="poster-turn-said">${turn.text}</p>`
                    : html`<${Markdown} text=${stripChoices(turn.text)} />`}
                <${ResultCards} cards=${turn.cards} />
                <${WorkLog} tools=${turn.tools} />
            </div>
            <div class="poster-time poster-turn-meta">
                <span>${timeShort(turn.at)}</span>
                ${turn.model ? html`<span class="poster-turn-model" title=${tr('chat.modelTitle', 'The model that answered this turn')}>${turn.model}</span>` : ''}
                <!-- The RAW markdown, which is what pastes usefully into an editor or another chat.
                     Same control and same behaviour as the message bubbles in the inbox. -->
                ${turn.text ? html`<${CopyButton} text=${String(turn.text)} className="btn-ghost poster-turn-copy"
                    label="⧉" copiedLabel="✓"
                    title=${tr('chat.copyTurn', 'Copy this message')} copiedTitle=${t('common.copied')}
                    ariaLabel=${tr('chat.copyTurn', 'Copy this message')} />` : ''}
                ${!mine && turn.text && isSpeechSupported() ? html`
                    <button type="button" class="btn-ghost poster-turn-listen" onClick=${listen}>
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
        <div class="poster-turn poster-turn--agent poster-turn--live">
            <div class="poster-turn-body">
                ${text ? html`<${Markdown} text=${stripChoices(text)} />` : ''}
                ${!text && thought ? html`<p class="poster-turn-thinking">${thought}</p>` : ''}
                ${!text && !thought && busy ? html`<p class="poster-turn-thinking">${tr('chat.working', 'Working…')}</p>` : ''}
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
        <div class="poster-live-status" role="status" aria-live="polite">
            <span class="poster-live-dot" aria-hidden="true"></span>
            <span>${what}</span>
            <span class="poster-live-clock">${clock}</span>
        </div>
    `;
}

/** A turn that could not run, with the reason and a way to try again. */
export function TurnError({ message, onRetry }) {
    if (!message) return null;
    return html`
        <div class="poster-turn-error" role="alert">
            <p class="poster-turn-error-msg">${message}</p>
            ${onRetry && html`
                <button type="button" class="btn-outline" onClick=${onRetry}>
                    ${tr('chat.retry', 'Try again')}
                </button>`}
        </div>
    `;
}

export default Turn;
