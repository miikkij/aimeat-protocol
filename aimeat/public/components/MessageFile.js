/**
 * @file public/components/MessageFile.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A file that came with a message, as part of the Message component (component plan
 *   C2, "Thread and Composer"): a picture as a thumbnail that opens full size, a voice message that
 *   plays where it sits with its transcript, a text file (Markdown) that opens in the reader, any
 *   other file that opens in a new tab, and every ready file with its download mark. A file not yet
 *   copied to the reader, or one that expired, says so in a word, and the tooltip says the rest. The
 *   page passes the file as data and the ways it can be opened; it never writes a class. The look is
 *   css/components/message.css (.message-file*, .message-audio, .message-transcript*).
 *
 *   Two rules live here. Only one player runs at a time (starting one silences every other player
 *   and the read-aloud engine), and a transcript always says who produced it: the sender's own
 *   transcript and one the reader paid for are not the same claim.
 * @structure MessageFiles({ files, onOpenText, onTranscribe, canTranscribe }) ·
 *   MessageFile({ file, onOpenText, onTranscribe, canTranscribe }) · VoicePlayer({ src, small }) ·
 *   TranscriptPanel({ file, onTranscribe, canTranscribe }) · fmtClock(seconds) ·
 *   stopOtherAudio(current) · attachKind(attachment)
 * @usage html`<${MessageFiles} files=${[{ id, name, url, kind, state, durationSeconds, transcript }]}
 *          onOpenText=${(url, name) => …} onTranscribe=${(fileId) => …} canTranscribe=${true} />`
 *   `file.state`: 'expired' (the file is gone), 'pending' (not copied to you yet), or nothing.
 *   A file with no `url` or in the expired state is drawn as its unavailable chip.
 * @version-history
 *   v1.0.0 — 2026-09-26 — Moved out of views/profile/inbox-tab (AttachmentItem in message-turn.js,
 *     AudioAttachment, TranscriptPanel, fmtClock and stopOtherAudio in voice-parts.js, attachKind and
 *     ATTACH_ICO in helpers.js) into the Message component with the same behaviour; the inbox- class
 *     names became the component's own (message-file*, message-audio, message-transcript*).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { stop as stopSpeech } from '/js/services/speech-reader.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/** The mark before a file's name, by what the file is. */
const FILE_MARK = { image: '🖼', pdf: '📄', markdown: '📄', audio: '🎵', video: '🎬', file: '📎' };

/** How a file is shown: as a thumbnail, played in place, read in the reader, or opened in a tab. */
export function attachKind(a) {
  const mime = a.mime || '';
  const name = a.name || a.storageKey || '';
  if (a.kind === 'image' || /^image\//.test(mime)) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/markdown/.test(mime) || /\.(md|markdown|mdx)$/i.test(name)) return 'markdown';
  if (a.kind === 'audio' || /^audio\//.test(mime)) return 'audio';
  if (a.kind === 'video' || /^video\//.test(mime)) return 'video';
  return 'file';
}

/** Seconds → "0:14". */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** One voice message at a time. Two playing at once is noise, and a screen reader talking over a
 *  recording is worse — so starting one stops every other player AND the read-aloud engine. */
export function stopOtherAudio(current) {
  document.querySelectorAll('audio.message-audio').forEach((el) => {
    const player = /** @type {HTMLAudioElement} */ (el);
    if (player !== current && !player.paused) player.pause();
  });
  stopSpeech();
}

/**
 * The player. preload="metadata" is deliberate — a thread with ten voice messages must not fetch all
 * ten on open. The length is all that is needed until someone presses play. `small` is the player in
 * a file waiting to be sent (the Composer's chip).
 */
export function VoicePlayer({ src, small }) {
  return html`<audio class=${`message-audio${small ? ' message-audio--small' : ''}`} controls preload="metadata" src=${src}
    onPlay=${(e) => stopOtherAudio(e.currentTarget)}></audio>`;
}

/**
 * The text of a voice message, and the button that produces it.
 *
 * Three states, none of them hidden: a transcript that came WITH the message (the sender wrote it,
 * so reading it costs nothing), a transcript this reader produced, or an offer to produce one. With
 * no transcription model configured the row says so and points at the settings instead of quietly
 * rendering nothing — an empty space reads as broken.
 */
export function TranscriptPanel({ file, onTranscribe, canTranscribe }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const tr = file.transcript;

  async function run() {
    setBusy(true); setError(null);
    try {
      await onTranscribe(file.id);
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
      <div class="message-transcript">
        <button type="button" class="message-transcript-toggle" onClick=${() => setOpen((v) => !v)} aria-expanded=${open}>
          ${open ? '▾' : '▸'} ${t('inbox.transcript')}
          <span class="message-transcript-src">
            ${tr.by === 'sender' ? t('inbox.transcriptBySender') : t('inbox.transcriptByYou', { model: tr.model || '' })}
          </span>
        </button>
        ${open ? html`<div class="message-transcript-text">${String(tr.text)}</div>` : null}
      </div>`;
  }

  if (!onTranscribe) return null;

  return html`
    <div class="message-transcript">
      ${canTranscribe === false
        ? html`<${Note} inline>${t('inbox.transcribeNoModel')}<//>`
        : html`
          <button type="button" class="message-transcript-btn" onClick=${run} disabled=${busy}>
            ${busy ? t('inbox.transcribing') : t('inbox.transcribe')}
          </button>`}
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
    </div>`;
}

/**
 * One file. Images render as a thumbnail (click → full size in a new tab); audio plays in place;
 * PDF, video and other files open natively in a new tab; Markdown opens in the reader the page gives
 * (`onOpenText(url, name)`). Every ready file gets a download mark. A file not yet copied to the
 * reader, or expired, shows its state.
 */
export function MessageFile({ file, onOpenText, onTranscribe, canTranscribe }) {
  const kind = file.kind || attachKind(file);
  const name = String(file.name || file.storageKey || '');
  const url = file.url;
  const ready = !!url && file.state !== 'expired';

  if (!ready) {
    // What the reader needs is not the machine's word for the state ("pending") but what happened to
    // them and whose move it is next. The chip carries the short form and the title the whole
    // sentence, because a chip is four words wide and the answer is longer than that.
    const status = file.state === 'expired' ? t('inbox.attachmentExpired') : (file.state === 'pending' ? t('inbox.attachmentPending') : null);
    const help = file.state === 'expired' ? t('inbox.attachmentExpiredHelp') : (file.state === 'pending' ? t('inbox.attachmentPendingHelp') : null);
    return html`<div class="message-file message-file--pending" title=${help || undefined}>
      <span class="message-file-mark">${FILE_MARK[kind]}</span>
      <span class="message-file-name">${name}</span>
      ${status ? html`<span class="message-file-state">${status}</span>` : null}
    </div>`;
  }

  const download = html`<a class="message-file-get" href=${url} download=${name} title=${t('inbox.attachmentDownload')}>⬇</a>`;

  if (kind === 'image') {
    return html`<div class="message-file-picture">
      <a class="message-file-thumb-link" href=${url} target="_blank" rel="noopener" title=${t('inbox.attachmentOpen')}>
        <img class="message-file-thumb" src=${url} alt=${name} loading="lazy" />
      </a>
      <div class="message-file-cap"><span class="message-file-name">${name}</span>${download}</div>
    </div>`;
  }
  if (kind === 'markdown') {
    return html`<div class="message-file">
      <button type="button" class="message-file-open" onClick=${() => onOpenText?.(url, name)} title=${t('inbox.attachmentView')}>
        <span class="message-file-mark">📄</span><span class="message-file-name">${name}</span>
      </button>${download}
    </div>`;
  }
  if (kind === 'audio') {
    return html`<div class="message-file-voice">
      <${VoicePlayer} src=${url} />
      <div class="message-file-cap">
        <span class="message-file-name">${name}</span>
        ${file.durationSeconds ? html`<span class="message-file-length">${fmtClock(file.durationSeconds)}</span>` : null}
        ${download}
      </div>
      <${TranscriptPanel} file=${file} onTranscribe=${onTranscribe} canTranscribe=${canTranscribe} />
    </div>`;
  }
  // pdf / video / file — let the browser open it in a new tab.
  return html`<div class="message-file">
    <a class="message-file-open" href=${url} target="_blank" rel="noopener" title=${t('inbox.attachmentOpen')}>
      <span class="message-file-mark">${FILE_MARK[kind]}</span><span class="message-file-name">${name}</span>
    </a>${download}
  </div>`;
}

/** The files of one message, in a row that wraps. */
export function MessageFiles({ files, onOpenText, onTranscribe, canTranscribe }) {
  if (!files || files.length === 0) return null;
  return html`<div class="message-files">
    ${files.map((f) => html`<${MessageFile} key=${f.id || f.name} file=${f}
      onOpenText=${onOpenText} onTranscribe=${onTranscribe} canTranscribe=${canTranscribe} />`)}
  </div>`;
}

export default MessageFile;
