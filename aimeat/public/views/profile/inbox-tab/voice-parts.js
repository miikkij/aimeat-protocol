/**
 * @file public/views/profile/inbox-tab/voice-parts.js
 * @description The voice-message pieces of a message bubble: the in-place audio player and the
 *   transcript row under it. Extracted from components.js purely to keep that file under the
 *   max-file-lines rule; behaviour is unchanged.
 *
 *   Two rules live here. Only one player runs at a time (and starting one silences the read-aloud
 *   engine, so a synthetic voice never talks over a human one). And transcription is never automatic:
 *   it spends the owner's own AI budget, so it is always a click, and the button says what it will do.
 * @structure fmtClock · stopOtherAudio · AudioAttachment · TranscriptPanel
 * @usage import { AudioAttachment } from './voice-parts.js';
 * @version-history
 *   v1.0.0 — 2026-08-01 — Extracted from components.js (voice messages).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { stop as stopSpeech } from '/js/services/speech-reader.js';

/** Seconds → "0:14". */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** One voice message at a time. Two playing at once is noise, and a screen reader talking over a
 *  recording is worse — so starting one stops every other player AND the read-aloud engine. */
export function stopOtherAudio(current) {
  document.querySelectorAll('audio.inbox-audio').forEach((el) => {
    const player = /** @type {HTMLAudioElement} */ (el);
    if (player !== current && !player.paused) player.pause();
  });
  stopSpeech();
}

/**
 * The text of a voice message, and the button that produces it.
 *
 * Three states, none of them hidden: a transcript that came WITH the message (the sender wrote it,
 * so reading it costs nothing), a transcript this reader produced, or an offer to produce one. With
 * no transcription model configured the row says so and points at the settings instead of quietly
 * rendering nothing — an empty space reads as broken.
 */
export function TranscriptPanel({ att, msgId, onTranscribe, canTranscribe }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const tr = att.transcript;

  async function run() {
    setBusy(true); setError(null);
    try {
      await onTranscribe(msgId, att.id);
      setOpen(true);
    } catch (e) {
      // Shown in place, not as a toast: "no model configured" and "daily budget spent" are both
      // things the reader can act on, and they belong next to the button that produced them.
      setError(e?.message || t('inbox.transcribeFailed'));
    }
    setBusy(false);
  }

  if (tr?.text) {
    return html`
      <div class="inbox-transcript">
        <button class="inbox-transcript-toggle" onClick=${() => setOpen((v) => !v)} aria-expanded=${open}>
          ${open ? '▾' : '▸'} ${t('inbox.transcript')}
          <span class="inbox-transcript-src">
            ${tr.by === 'sender' ? t('inbox.transcriptBySender') : t('inbox.transcriptByYou', { model: tr.model || '' })}
          </span>
        </button>
        ${open ? html`<div class="inbox-transcript-text">${escHtml(tr.text)}</div>` : null}
      </div>`;
  }

  if (!onTranscribe) return null;

  return html`
    <div class="inbox-transcript">
      ${canTranscribe === false
        ? html`<span class="inbox-transcript-hint">${t('inbox.transcribeNoModel')}</span>`
        : html`
          <button class="inbox-transcript-btn" onClick=${run} disabled=${busy}>
            ${busy ? t('inbox.transcribing') : t('inbox.transcribe')}
          </button>`}
      ${error ? html`<span class="inbox-transcript-err">${error}</span>` : null}
    </div>`;
}

/**
 * A voice message in a bubble: it plays here rather than opening in a browser tab, which is a
 * download and not a conversation.
 *
 * preload="metadata" is deliberate — a thread with ten voice messages must not fetch all ten on
 * open. The duration is all that is needed until someone presses play.
 */
export function AudioAttachment({ a, url, name, download, msgId, onTranscribe, canTranscribe }) {
  return html`<div class="inbox-attach-audio">
    <audio class="inbox-audio" controls preload="metadata" src=${url}
           onPlay=${(e) => stopOtherAudio(e.currentTarget)}></audio>
    <div class="inbox-attach-cap">
      <span class="inbox-attach-name">${escHtml(name)}</span>
      ${a.durationSeconds ? html`<span class="inbox-audio-dur">${fmtClock(a.durationSeconds)}</span>` : null}
      ${download}
    </div>
    <${TranscriptPanel} att=${a} msgId=${msgId} onTranscribe=${onTranscribe} canTranscribe=${canTranscribe} />
  </div>`;
}
