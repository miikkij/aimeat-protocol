/**
 * @file voice/capture.js
 * @description Microphone capture with manual turns or energy-based voice activity detection.
 * @structure wav, createCapture
 * @usage createCapture(config, { utterance, interrupt, busy, level }).start()
 * @version-history v1.0.0 - 2026-09-19 - Bounded PCM capture, pre-roll and explicit microphone lifecycle.
 */
/** @param {Float32Array[]} chunks @param {number} rate */
export function wav(chunks, rate) {
  const frames = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const data = new ArrayBuffer(44 + frames * 2); const view = new DataView(data);
  const word = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  word(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, frames * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const value of chunk) { view.setInt16(offset, Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767), true); offset += 2; }
  return new Blob([data], { type: 'audio/wav' });
}
/** @param {any} config @param {any} hooks */
export function createCapture(config, hooks) {
  let context, stream, source, processor, silent;
  let closed = false, held = false, active = false, voiced = 0, quiet = 0, duration = 0;
  let chunks = [], preRoll = [], preRollMs = 0;
  const reset = () => { active = false; chunks = []; voiced = 0; quiet = 0; duration = 0; };
  const finish = () => {
    const saved = chunks; const valid = duration >= config.turn.minSpeechMs;
    reset(); held = false;
    if (saved.length && valid) hooks.utterance(wav(saved, context.sampleRate));
  };
  return {
    async start() {
      if (closed) throw new Error('Microphone capture is closed');
      // ScriptProcessor avoids a blob: worklet URL that many hosted apps' CSP cannot load.
      // This captures PCM once for VAD and WAV; adapters can supply an AudioWorklet capture instead.
      context = new AudioContext(); await context.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: config.input.echoCancellation,
        noiseSuppression: config.input.noiseSuppression, autoGainControl: config.input.autoGainControl, channelCount: 1 } });
      if (closed) { stream.getTracks().forEach(track => track.stop()); if (context.state !== 'closed') await context.close(); return; }
      source = context.createMediaStreamSource(stream); processor = context.createScriptProcessor(2048, 1, 1);
      silent = context.createGain(); silent.gain.value = 0;
      source.connect(processor); processor.connect(silent); silent.connect(context.destination);
      processor.onaudioprocess = event => {
        if (closed) return;
        const samples = new Float32Array(event.inputBuffer.getChannelData(0));
        const ms = samples.length / context.sampleRate * 1000;
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        hooks.level(rms);
        if (config.input.mode === 'manual') {
          if (held) { chunks.push(samples); duration += ms; if (duration >= config.turn.maxSpeechMs) finish(); }
          return;
        }
        if (hooks.busy() && !config.turn.bargeIn) { reset(); preRoll = []; preRollMs = 0; return; }
        if (!active) {
          preRoll.push(samples); preRollMs += ms;
          while (preRollMs > Math.max(config.turn.preRollMs, config.turn.minSpeechMs, config.turn.interruptMs) + ms) {
            preRollMs -= preRoll.shift().length / context.sampleRate * 1000;
          }
          voiced = rms >= config.turn.threshold ? voiced + ms : 0;
          const minimum = hooks.busy() ? config.turn.interruptMs : config.turn.minSpeechMs;
          if (voiced < minimum || rms < config.turn.threshold) return;
          active = true; chunks = preRoll; duration = preRollMs; preRoll = []; preRollMs = 0;
          if (hooks.busy()) hooks.interrupt();
        } else { chunks.push(samples); duration += ms; }
        quiet = rms < config.turn.threshold ? quiet + ms : 0;
        if (quiet >= config.turn.silenceMs || duration >= config.turn.maxSpeechMs) finish();
      };
    },
    begin() { if (!context || closed) throw new Error('Start the session before recording'); reset(); held = true; },
    commit() { if (held || active) finish(); },
    async close() {
      closed = true; reset(); preRoll = [];
      if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
      if (source) source.disconnect(); if (silent) silent.disconnect();
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') await context.close();
    },
  };
}
