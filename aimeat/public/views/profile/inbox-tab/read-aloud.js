/**
 * @file public/views/profile/inbox-tab/read-aloud.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read-aloud controls for the profile Inbox thread — the same "listen instead of read"
 *   affordance the (L)AIMEAT Sanomat app gives its articles, brought to direct messages. Two
 *   self-contained components (they own their own hooks, so the pure ThreadPanel stays hook-free):
 *   BubbleSpeakButton (a 🔊 in a message bubble's action pill — play / click again to stop) and
 *   ThreadReadAloud (the thread-head button that reads the whole open conversation, sender by sender,
 *   with pause/resume). Both drive the shared /js/services/speech-reader.js engine, which keeps ONE
 *   reader active at a time — starting a message stops the thread reader and vice versa.
 * @structure useSpeechPhase (subscribe to the engine for one id) · BubbleSpeakButton · ThreadReadAloud
 *   · threadParagraphs (thread → speakable paragraphs, each message prefixed by its sender).
 * @usage import { BubbleSpeakButton, ThreadReadAloud } from './inbox-tab/read-aloud.js';
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial version: per-message and whole-thread read-aloud in the Inbox tab.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import {
  isSpeechSupported, subscribeSpeech, getSpeechState, speak, stop, pause, resume, textToParagraphs,
} from '/js/services/speech-reader.js';

/** The reader phase for ONE id: '' when this id isn't the active reader, else 'speaking' | 'paused'.
 *  Every control subscribes independently; the engine only notifies on real phase changes (start /
 *  stop / pause / resume — never per spoken chunk), and an unchanged string is a no-op re-render. */
export function useSpeechPhase(id) {
  const [phase, setPhase] = useState(() => (getSpeechState().id === id ? getSpeechState().phase : ''));
  useEffect(() => {
    setPhase(getSpeechState().id === id ? getSpeechState().phase : '');
    return subscribeSpeech((s) => setPhase(s.id === id ? s.phase : ''));
  }, [id]);
  // Leaving the view (thread switch, tab change) must not leave a voice reading into an empty room.
  useEffect(() => () => { if (getSpeechState().id === id) stop(); }, [id]);
  return phase;
}

/** 🔊 on a message bubble: reads that one message. Clicking it while it reads stops it. Rendered only
 *  when the browser can speak AND the message has something speakable (an attachment-only message has
 *  no body to read — we hide the button instead of offering one that does nothing). */
export function BubbleSpeakButton({ msgId, body }) {
  const id = `msg:${msgId}`;
  const phase = useSpeechPhase(id);
  if (!isSpeechSupported()) return null;
  const paragraphs = textToParagraphs(body);
  if (!paragraphs.length) return null;
  const on = phase === 'speaking' || phase === 'paused';
  return html`
    <button class=${`inbox-bubble-act${on ? ' inbox-bubble-act--on' : ''}`}
      title=${on ? t('inbox.speak.stop') : t('inbox.speak.message')}
      aria-label=${on ? t('inbox.speak.stop') : t('inbox.speak.message')} aria-pressed=${on}
      onClick=${() => (on ? stop() : speak(id, paragraphs))}>${on ? '⏹' : '🔊'}</button>`;
}

/** The open thread as speakable paragraphs: each message announces its sender, then its body. Messages
 *  with no speakable body (attachment-only) are skipped rather than announced into silence. */
export function threadParagraphs(thread, youLabel, peerLabelText) {
  const out = [];
  for (const m of thread || []) {
    const body = textToParagraphs(m.body);
    if (!body.length) continue;
    out.push(`${m.direction === 'outbound' ? youLabel : peerLabelText}:`);
    out.push(...body);
  }
  return out;
}

/** Thread-head "Listen": reads the whole open conversation. Idle → Listen, speaking → Pause,
 *  paused → Continue (the Sanomat header model). A ✕ next to it stops and resets.
 *  The reader id carries the conversation id: this component is NOT remounted when you switch threads
 *  (same position in the head), so without that the reader would keep reading the conversation you just
 *  left. Changing the id re-runs useSpeechPhase's cleanup, which stops the old reading. */
export function ThreadReadAloud({ thread, peerLabelText, convId }) {
  const id = `thread:${convId || ''}`;
  const phase = useSpeechPhase(id);
  if (!isSpeechSupported()) return null;
  const label = phase === 'speaking' ? t('inbox.speak.pause')
    : phase === 'paused' ? t('inbox.speak.resume')
      : t('inbox.speak.listen');
  const onClick = () => {
    if (phase === 'speaking') { pause(); return; }
    if (phase === 'paused') { resume(); return; }
    speak(id, threadParagraphs(thread, t('inbox.quoteYou'), peerLabelText));
  };
  return html`
    <span class="inbox-speak-group">
      <button class=${`btn-ghost btn-sm inbox-speak-btn${phase ? ' inbox-speak-btn--on' : ''}`}
        onClick=${onClick} title=${t('inbox.speak.thread')} aria-label=${t('inbox.speak.thread')}>
        <span class="inbox-speak-ico">${phase === 'speaking' ? '⏸' : '🔊'}</span>
        <span class="inbox-ai-btn-label">${label}</span>
      </button>
      ${phase ? html`<button class="btn-ghost btn-sm inbox-speak-stop" onClick=${() => stop()}
        title=${t('inbox.speak.stop')} aria-label=${t('inbox.speak.stop')}>✕</button>` : null}
    </span>`;
}
