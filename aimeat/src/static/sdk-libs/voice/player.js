/**
 * @file voice/player.js
 * @description Cancellable PCM16 streaming playback and bounded MP3 segment playback.
 * @structure createPlayer
 * @usage const player = createPlayer(config, onAudio); await player.open();
 * @version-history v1.0.0 - 2026-09-19 - Shared audio context, bounded scheduling and real completion.
 */
import { delay } from './segments.js';

/** @param {any} config @param {() => void} onAudio */
export function createPlayer(config, onAudio) {
  /** @type {AudioContext | null} */ let context = null;
  /** @type {GainNode | null} */ let gain = null;
  const sources = new Set();
  let next = 0;
  let tail = new Uint8Array();
  const api = {
    async open() {
      if (!context) {
        context = new AudioContext(); gain = context.createGain();
        gain.gain.value = config.playback.volume; gain.connect(context.destination);
      }
      await context.resume();
    },
    async write(bytes, signal) {
      signal.throwIfAborted();
      const joined = new Uint8Array(tail.length + bytes.length); joined.set(tail); joined.set(bytes, tail.length);
      const frame = 2 * config.tts.channels;
      const count = Math.floor(joined.length / frame);
      tail = joined.slice(count * frame);
      const view = new DataView(joined.buffer);
      const block = Math.max(1, Math.floor(config.tts.sampleRate / 10));
      for (let offset = 0; offset < count; offset += block) {
        while (next - context.currentTime > config.playback.maxBufferedMs / 1000) await delay(20, signal);
        signal.throwIfAborted();
        const frames = Math.min(block, count - offset);
        const audio = context.createBuffer(config.tts.channels, frames, config.tts.sampleRate);
        for (let channel = 0; channel < config.tts.channels; channel++) {
          const output = audio.getChannelData(channel);
          for (let i = 0; i < frames; i++) output[i] = view.getInt16(((offset + i) * config.tts.channels + channel) * 2, true) / 32768;
        }
        api.schedule(audio);
      }
    },
    schedule(audio) {
      const source = context.createBufferSource(); source.buffer = audio; source.connect(gain);
      sources.add(source); source.onended = () => { sources.delete(source); source.disconnect(); };
      // Buffer only a fresh start or a real underrun, never every frame or sentence.
      if (next <= context.currentTime) next = context.currentTime + config.playback.bufferMs / 1000;
      source.start(next); next += audio.duration; onAudio();
    },
    async enqueue(stream, signal) {
      tail = new Uint8Array();
      if (config.tts.format === 'pcm') {
        for await (const bytes of stream) await api.write(bytes, signal);
        if (tail.length) throw new Error('Incomplete PCM frame from speech provider');
      } else {
        const parts = []; let size = 0;
        for await (const bytes of stream) {
          signal.throwIfAborted(); size += bytes.length;
          if (size > 8_000_000) throw new Error('Speech segment exceeds 8 MB');
          parts.push(bytes);
        }
        const data = new Uint8Array(size); let offset = 0;
        for (const part of parts) { data.set(part, offset); offset += part.length; }
        const audio = await context.decodeAudioData(data.buffer);
        signal.throwIfAborted(); api.schedule(audio);
      }
      const end = next;
      const played = (async () => { while (context && context.currentTime < end) await delay(10, signal); signal.throwIfAborted(); })();
      // The next sentence can be scheduled before this one finishes. The caller still awaits
      // `played` before retaining it in history or reporting the completed turn.
      void played.catch(() => {}); // The session observes the same promise.
      return { played };
    },
    async play(stream, signal) { const queued = await api.enqueue(stream, signal); await queued.played; },
    async drain(signal) { while (sources.size) await delay(20, signal); },
    stop() { for (const source of sources) { source.stop(); source.disconnect(); } sources.clear(); next = 0; tail = new Uint8Array(); },
    async close() { api.stop(); if (context) await context.close(); context = null; gain = null; },
  };
  return api;
}
