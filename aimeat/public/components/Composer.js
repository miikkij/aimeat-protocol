/**
 * @file public/components/Composer.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The box a person types into: Enter sends, Shift+Enter opens a line, the field grows
 *   with what is in it, attachments wait above it until sent, and a recorder and a file button sit
 *   beside it. Its look is css/components/composer.css; the catalogue entry is `composer`.
 * @structure Composer({ value, onInput, onSend, onStop, onSpeak, onAttach, attachments,
 *   onDropAttachment, busy, disabled, note, listening, voiceMaxSeconds })
 * @usage html`<${Composer} value=${draft} onInput=${setDraft} onSend=${send} onStop=${stop} busy=${busy} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/chat/parts.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

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
        <div class="poster-composer poster-row--thing">
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
                    placeholder=${disabled
                        ? tr('chat.disabledPlaceholder', 'There is no chat agent here yet.')
                        : tr('chat.placeholder', 'Ask for something, or describe what you want built.')}
                    onInput=${(e) => onInput(e.target.value)}
                    onKeyDown=${keydown}></textarea>
                ${onAttach && !busy ? html`
                    <input type="file" multiple ref=${fileRef} class="poster-composer-file"
                        onChange=${(e) => { onAttach([...e.target.files]); e.target.value = ''; }} />
                    <button type="button" class="btn-outline poster-composer-tool" disabled=${disabled}
                        title=${tr('chat.attachTitle', 'Attach a file')}
                        onClick=${() => fileRef.current?.click()}>📎</button>` : ''}
                ${onSpeak && !busy ? html`
                    <${VoiceRecorder} maxSeconds=${voiceMaxSeconds} disabled=${disabled || listening}
                        className="btn-outline poster-composer-tool" onRecorded=${(file) => onSpeak(file)} />` : ''}
                ${busy
                    ? html`<button type="button" class="btn-outline poster-slab poster-slab--control poster-composer-send" onClick=${onStop}>${tr('chat.stop', 'Stop')}</button>`
                    : html`<button type="button" class="btn-primary poster-slab poster-slab--control poster-composer-send"
                        disabled=${disabled || !value.trim()}
                        onClick=${onSend}>${tr('chat.send', 'Send')}</button>`}
            </div>
        </div>
    `;
}

export default Composer;
