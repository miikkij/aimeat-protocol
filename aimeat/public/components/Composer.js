/**
 * @file public/components/Composer.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The box a person types into: Enter sends, Shift+Enter opens a line, the field grows
 *   with what is in it, attachments wait above it until sent, and a recorder and a file button sit
 *   beside it. Its look is css/components/composer.css; the catalogue entry is `composer`.
 *
 *   Two tones of one component (component plan C2):
 *   - the chat's (the default): one row, the field, the tools and Send; the page keeps the words
 *     (`value`, `onInput`) and the files.
 *   - `tone="message"` (Messages): the field over the whole width with its tools under it, the loud
 *     action at the end of that line, the bigger editor behind ⤢; it keeps its own draft per
 *     conversation and its own files (components/MessageComposer.js has the whole API).
 * @structure Composer({ tone, …}) · ChatComposer({ value, onInput, onSend, onStop, onSpeak, onAttach,
 *   attachments, onDropAttachment, busy, disabled, note, listening, voiceMaxSeconds, placeholder,
 *   sendLabel, sending, inputRef, suggest, suggestLabel }) ·
 *   MessageComposer (components/MessageComposer.js)
 *   The chat's row, named options for a page that talks to one agent (an agent's Messages tab):
 *   `placeholder` and `sendLabel` (its own words), `sending` (Send is held and Enter does not send
 *   twice while a message goes), `inputRef` (the page puts the cursor in the field), `suggest` =
 *   [{ key, name, desc, onPick }] (what the typed words can become, an agent's slash commands, in a
 *   list over the field; a press takes one and gives the field the cursor back; `suggestLabel` names
 *   the list).
 * @usage html`<${Composer} value=${draft} onInput=${setDraft} onSend=${send} onStop=${stop} busy=${busy} />`
 *        html`<${Composer} tone="message" recipient=${peer} sendLabel=${t('inbox.reply')} sending=${sending}
 *          onSend=${(recipient, markdown, files, reset) => …} draftKey=${key} focusNonce=${n} />`
 * @version-history
 *   v1.3.0 — 2026-09-26 — The chat's row takes `placeholder`, `sendLabel`, `sending`, `inputRef` and
 *     `suggest` (the slash commands over the field, from an agent's Messages tab, where main drew them
 *     as .pf-agd-autocomplete); additive, the chat's row is unchanged without them.
 *   v1.2.0 — 2026-09-26 — `tone="message"`: Messages' composer (components/MessageComposer.js) is a
 *     tone of this component; the chat's row is unchanged.
 *   v1.1.0 — 2026-09-24 — Attach and the microphone are the large icon button (Jouni's decision
 *     "Icon button").
 *   v1.0.0 — 2026-09-23 — Moved out of views/chat/parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';
import { MessageComposer } from '/components/MessageComposer.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The Composer: the chat's row, or with `tone="message"` Messages' composer. */
export function Composer({ tone, ...props }) {
  return tone === 'message'
    ? html`<${MessageComposer} ...${props} />`
    : html`<${ChatComposer} ...${props} />`;
}

/**
 * The chat's box.
 *
 * Enter sends and Shift+Enter opens a line, which is what every chat does and therefore what a
 * person's hands already expect. The field grows with what is in it up to a ceiling, so a long ask
 * is readable while being written without the composer eating the conversation.
 */
export function ChatComposer({ value, onInput, onSend, onStop, onSpeak, onAttach, attachments = [], onDropAttachment,
    busy, disabled, note, listening, voiceMaxSeconds = 300,
    placeholder, sendLabel, sending, inputRef, suggest, suggestLabel }) {
    const ref = useRef(null);
    const fileRef = useRef(null);
    // A page that must put the cursor in the field (an agent's "Other") holds the element too.
    useEffect(() => { if (inputRef) inputRef.current = ref.current; });

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
            if (!busy && !disabled && !sending && value.trim()) onSend();
        }
    };

    return html`
        <div class=${'poster-composer poster-row--thing' + (suggest ? ' poster-composer--suggest' : '')}>
            ${/* What the typed words can become (an agent's slash commands), over the field; a press
                  takes one and puts the cursor back in the field. */''}
            ${suggest && suggest.length > 0 ? html`
                <ul class="composer-suggest" aria-label=${suggestLabel}>
                    ${suggest.map((s) => html`
                        <li key=${s.key ?? s.name}>
                            <button type="button" class="composer-suggest-item"
                                onClick=${() => { s.onPick?.(); ref.current?.focus(); }}>
                                <span class="composer-suggest-name">${s.name}</span>
                                <span class="composer-suggest-desc">${s.desc || ''}</span>
                            </button>
                        </li>`)}
                </ul>` : ''}
            ${note ? html`<p class="poster-composer-note">${note}</p>` : ''}
            ${listening ? html`<p class="poster-composer-note">${tr('chat.hearing', 'Working out what you said…')}</p>` : ''}
            ${/* Attached and not yet sent. Each one is removable: a picture picked by mistake should
                  cost one press, not a reload. */''}
            ${attachments.length > 0 && html`
                <div class="poster-attachments">
                    ${attachments.map((att) => html`
                        <span class=${'poster-attachment' + (att.state === 'error' ? ' poster-attachment--error' : '')} key=${att.id}>
                            ${att.preview && html`<img class="poster-attachment-thumb" src=${att.preview} alt="" />`}
                            <span class="poster-attachment-name">${att.name}</span>
                            ${att.state === 'uploading' && html`<span class="poster-attachment-state">${tr('chat.attachUploading', 'uploading…')}</span>`}
                            ${att.state === 'error' && html`<span class="poster-attachment-state">${att.error || tr('chat.attachFailed', 'failed')}</span>`}
                            <button type="button" class="btn-ghost poster-attachment-drop"
                                title=${tr('chat.attachRemove', 'Remove')}
                                onClick=${() => onDropAttachment(att.id)}>×</button>
                        </span>`)}
                </div>`}
            <div class="poster-composer-row">
                <textarea ref=${ref} class="poster-composer-input" rows="1"
                    value=${value}
                    disabled=${disabled}
                    placeholder=${placeholder || (disabled
                        ? tr('chat.disabledPlaceholder', 'There is no chat agent here yet.')
                        : tr('chat.placeholder', 'Ask for something, or describe what you want built.'))}
                    onInput=${(e) => onInput(e.target.value)}
                    onKeyDown=${keydown}></textarea>
                ${onAttach && !busy ? html`
                    <input type="file" multiple ref=${fileRef} class="poster-composer-file"
                        onChange=${(e) => { onAttach([...e.target.files]); e.target.value = ''; }} />
                    <button type="button" class="poster-icon poster-composer-tool" disabled=${disabled}
                        title=${tr('chat.attachTitle', 'Attach a file')}
                        onClick=${() => fileRef.current?.click()}>📎</button>` : ''}
                ${onSpeak && !busy ? html`
                    <${VoiceRecorder} maxSeconds=${voiceMaxSeconds} disabled=${disabled || listening}
                        className="poster-icon poster-composer-tool" plain=${true} onRecorded=${(file) => onSpeak(file)} />` : ''}
                ${busy
                    ? html`<button type="button" class="btn-outline poster-slab poster-slab--control poster-composer-send" onClick=${onStop}>${tr('chat.stop', 'Stop')}</button>`
                    : html`<button type="button" class="poster-slab poster-slab--control poster-composer-send"
                        disabled=${disabled || sending || !value.trim()}
                        onClick=${onSend}>${sendLabel || tr('chat.send', 'Send')}</button>`}
            </div>
        </div>
    `;
}

export default Composer;
