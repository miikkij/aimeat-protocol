/**
 * @file VoiceRecorder.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Record-a-voice-clip control, shared by the inbox composer and the OpenRouter
 *   settings' transcription test. Wraps /js/services/audio-recorder.js in a Preact button that
 *   shows what is happening: elapsed time, a live input level so a dead microphone is obvious
 *   immediately, and separate stop-and-keep versus cancel-and-discard actions.
 *
 *   Press to start, press again to stop. Not press-and-hold: on a touch screen that loses the
 *   recording to any accidental lift, and it makes a long message physically tiring.
 * @structure VoiceRecorder (control) · useRecorder (state machine)
 * @usage <${VoiceRecorder} maxSeconds=${300} onRecorded=${(file, seconds) => …} />
 * @version-history
 *   v1.0.0 — 2026-08-01 — Initial version (voice messages + STT settings test).
 */
import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { startRecording, isRecordingSupported, fmtDuration } from '/js/services/audio-recorder.js';

/**
 * @param {object} props
 * @param {(file: File, durationSeconds: number) => void} props.onRecorded
 * @param {number} [props.maxSeconds]   hard stop (the node's AIMEAT_VOICE_MSG_MAX_SECONDS)
 * @param {boolean} [props.disabled]
 * @param {string} [props.label]        text next to the icon; omitted = icon only
 * @param {string} [props.className]    extra class on the idle button (host styling)
 */
export function VoiceRecorder({ onRecorded, maxSeconds = 300, disabled = false, label, className = '' }) {
  const [state, setState] = useState('idle');   // idle | starting | recording | finishing
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);
  const [capped, setCapped] = useState(false);
  const recRef = useRef(null);

  // Leaving the view mid-recording must release the microphone. Without this the browser's recording
  // indicator stays lit after the user has navigated away, which reads as an app still listening.
  useEffect(() => () => { try { recRef.current?.cancel(); } catch { /* gone already */ } }, []);   // eslint-disable-line aimeat/no-silent-catch -- teardown of an already-torn-down recorder

  if (!isRecordingSupported()) return null;

  async function begin() {
    setError(null); setCapped(false); setSeconds(0); setLevel(0); setState('starting');
    try {
      recRef.current = await startRecording({
        maxSeconds,
        onTick: setSeconds,
        onLevel: setLevel,
        onAutoStop: () => { setCapped(true); finish(); },
      });
      setState('recording');
    } catch (e) {
      setState('idle');
      // Say which of the three it was: a denied permission, no microphone, or a browser that cannot.
      const name = e?.name || '';
      setError(
        name === 'NotAllowedError' || name === 'SecurityError' ? t('voice.errDenied')
          : name === 'NotFoundError' ? t('voice.errNoMic')
          : e?.message === 'unsupported' ? t('voice.errUnsupported')
          : (e?.message || t('voice.errFailed')),
      );
    }
  }

  async function finish() {
    const rec = recRef.current;
    if (!rec) return;
    setState('finishing');
    try {
      const { file, durationSeconds } = await rec.stop();
      recRef.current = null;
      setState('idle'); setSeconds(0); setLevel(0);
      onRecorded(file, durationSeconds);
    } catch (e) {
      recRef.current = null;
      setState('idle');
      setError(e?.message || t('voice.errFailed'));
    }
  }

  function discard() {
    try { recRef.current?.cancel(); } catch { /* already stopped */ }   // eslint-disable-line aimeat/no-silent-catch -- cancel is best-effort; the state reset below is what matters
    recRef.current = null;
    setState('idle'); setSeconds(0); setLevel(0); setCapped(false);
  }

  if (state === 'recording' || state === 'finishing') {
    const near = maxSeconds > 0 && seconds >= maxSeconds - 10;
    return html`
      <span class="vr-active" role="group" aria-label=${t('voice.recording')}>
        <span class="vr-dot" aria-hidden="true"></span>
        <span class=${`vr-time${near ? ' vr-time--near' : ''}`}>${fmtDuration(seconds)}</span>
        <span class="vr-meter" aria-hidden="true">
          <span class="vr-meter-fill" style=${`width:${Math.round(Math.min(1, level * 1.6) * 100)}%`}></span>
        </span>
        <button type="button" class="btn-primary btn-sm vr-stop" disabled=${state === 'finishing'}
                onClick=${finish} title=${t('voice.stop')} aria-label=${t('voice.stop')}>
          ${state === 'finishing' ? '…' : t('voice.stop')}
        </button>
        <button type="button" class="btn-ghost btn-sm vr-cancel" disabled=${state === 'finishing'}
                onClick=${discard} title=${t('voice.cancel')} aria-label=${t('voice.cancel')}>✕</button>
        ${capped ? html`<span class="vr-note">${t('voice.capped', { n: maxSeconds })}</span>` : null}
      </span>`;
  }

  return html`
    <span class="vr-wrap">
      <button type="button" class=${`vr-btn ${className}`} disabled=${disabled || state === 'starting'}
              onClick=${begin} title=${t('voice.record')} aria-label=${t('voice.record')}>
        <span class="vr-ico" aria-hidden="true">🎤</span>${label ? html`<span class="vr-label">${label}</span>` : null}
      </button>
      ${error ? html`<span class="vr-error">${error}</span>` : null}
    </span>`;
}
