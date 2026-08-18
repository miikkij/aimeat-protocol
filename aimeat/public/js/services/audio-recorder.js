/**
 * @file audio-recorder.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Microphone capture for voice messages and the transcription test. Plain JS, no
 *   framework: one function starts a recording and hands back the controls to stop or cancel it.
 *
 *   FORMAT: whatever the browser actually produces, negotiated with isTypeSupported — webm/opus in
 *   Chrome and Firefox, mp4/AAC in Safari. Not WAV. MediaRecorder cannot produce WAV without hand
 *   muxing PCM, and the result is roughly ten times the bytes for the same speech (a minute of 16 kHz
 *   mono WAV is ~2 MB against ~180 kB of Opus) with nothing gained: every browser plays these back,
 *   and OpenRouter's transcription endpoint lists webm, ogg, m4a and aac among its accepted formats.
 *   The extra megabytes would be paid for in the storage quota, the transfer and the federation copy.
 *
 *   The microphone track is stopped on every exit path. A forgotten track leaves the browser's
 *   recording indicator lit, which reads to a user as an application still listening to them.
 * @structure isRecordingSupported() · pickMimeType() · startRecording() · fmtDuration()
 * @usage const rec = await startRecording({ onLevel, maxSeconds }); const file = await rec.stop();
 * @version-history
 *   v1.0.0 — 2026-08-01 — Initial version for inbox voice messages + the settings STT test.
 */

/** Preference order: Opus where available (smallest for speech), then whatever the browser offers. */
const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',           // Safari
  'audio/aac',
];

export function isRecordingSupported() {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && !!navigator?.mediaDevices?.getUserMedia;
}

/** The first candidate this browser admits to supporting, or '' to let it choose its own default. */
export function pickMimeType() {
  if (typeof window === 'undefined' || !window.MediaRecorder?.isTypeSupported) return '';
  for (const type of CANDIDATES) {
    try { if (window.MediaRecorder.isTypeSupported(type)) return type; } catch { /* keep looking */ }  // eslint-disable-line aimeat/no-silent-catch -- a browser refusing to answer about a type IS the answer: try the next one
  }
  return '';
}

/** File extension for a recorded blob, from its mime type. */
function extFor(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('aac')) return 'aac';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

/** Seconds → "0:07" / "12:03". */
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Start recording from the default microphone.
 *
 * @param {object} [opts]
 * @param {(level: number) => void} [opts.onLevel]  0..1 input level, ~20/s while recording
 * @param {(seconds: number) => void} [opts.onTick] elapsed seconds, once a second
 * @param {number} [opts.maxSeconds]                hard stop; the recording is kept, not discarded
 * @param {() => void} [opts.onAutoStop]            fired when maxSeconds ended the recording
 * @returns {Promise<{ stop: () => Promise<{file: File, durationSeconds: number}>, cancel: () => void, mimeType: string }>}
 */
export async function startRecording(opts = {}) {
  if (!isRecordingSupported()) {
    throw new Error('unsupported');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    // Speech, not music: the browser's own cleanup is worth more than the fidelity it costs.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  const startedAt = Date.now();
  let stopped = false;

  // Level metering. Deliberately minimal: a number, not a waveform. Its whole job is to answer
  // "is the microphone hearing me", which a silent countdown cannot.
  let audioCtx = null;
  let rafId = 0;
  if (opts.onLevel && typeof window.AudioContext !== 'undefined') {
    try {
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
        opts.onLevel(peak);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } catch (err) {
      // Metering is decoration; a browser that refuses an AudioContext still records fine.
      audioCtx = null;
      if (typeof console !== 'undefined') console.warn('[audio-recorder] level meter unavailable:', err?.message || err);
    }
  }

  let tickTimer = 0;
  if (opts.onTick) {
    tickTimer = setInterval(() => opts.onTick(Math.floor((Date.now() - startedAt) / 1000)), 1000);
  }

  let autoStopTimer = 0;
  if (opts.maxSeconds > 0) {
    autoStopTimer = setTimeout(() => {
      if (!stopped && recorder.state === 'recording') {
        recorder.stop();               // the blob is KEPT — hitting the cap is not losing the take
        opts.onAutoStop?.();
      }
    }, opts.maxSeconds * 1000);
  }

  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const teardown = () => {
    stopped = true;
    if (tickTimer) clearInterval(tickTimer);
    if (autoStopTimer) clearTimeout(autoStopTimer);
    if (rafId) cancelAnimationFrame(rafId);
    if (audioCtx) audioCtx.close().catch(() => { /* already closing */ });   // eslint-disable-line aimeat/no-silent-catch -- closing a closed context is not an error worth reporting
    // The one line that must never be skipped: leave this out and the browser keeps showing the
    // user that something is recording them.
    stream.getTracks().forEach((tr) => tr.stop());
  };

  recorder.start();

  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    /** Stop and resolve with the recorded File plus its measured length. */
    stop() {
      return new Promise((resolve, reject) => {
        if (stopped) { reject(new Error('already stopped')); return; }
        recorder.onstop = () => {
          const durationSeconds = Math.max(0.1, (Date.now() - startedAt) / 1000);
          teardown();
          const type = recorder.mimeType || mimeType || 'audio/webm';
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const file = new File(chunks, `voice-${stamp}.${extFor(type)}`, { type });
          resolve({ file, durationSeconds });
        };
        recorder.onerror = (e) => { teardown(); reject(e?.error || new Error('recording failed')); };
        // Already inactive (an auto-stop at maxSeconds got there first): resolve from the chunks we
        // have instead of waiting for an onstop that will never fire.
        if (recorder.state === 'recording') recorder.stop();
        else recorder.onstop?.(new Event('stop'));
      });
    },
    /** Throw the take away and release the microphone. */
    cancel() {
      if (stopped) return;
      recorder.onstop = () => {};
      try { if (recorder.state === 'recording') recorder.stop(); } catch { /* already stopping */ }   // eslint-disable-line aimeat/no-silent-catch -- the goal is releasing the microphone below, which happens either way
      teardown();
    },
  };
}
