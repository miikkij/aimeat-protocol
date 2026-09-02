/**
 * @file assets/sound.js
 * @description Turning a synth voice into a file a pack can carry.
 *
 *   A GAME THAT SYNTHESISES ITS SOUND EFFECTS has none to load, which is fine until the same game
 *   wants a trailer, an app icon that beeps, or a sound designer who can open the coin pickup in an
 *   editor. record() renders any Web Audio graph through an OfflineAudioContext (as fast as the
 *   machine can, never in real time and never audible) and toWav() writes what came out as a
 *   16-bit PCM WAV, which every browser, every editor and every uploader understands.
 *
 *   WAV, NOT MP3 OR OGG. Encoding those in a browser needs a codec this node does not ship, and a
 *   WAV is what an app hands to whatever converts it. A short effect is a few kilobytes; a whole
 *   music bed belongs in mp3 and ogg, uploaded as a pair, not rendered here.
 *
 *   NOTHING PLAYS. This module makes bytes. Playing them is the audio bus's job (AIMEAT.phaser.audio)
 *   or an <audio> element's, and both need a person's gesture first.
 * @structure toWav(samples, sampleRate) · record(synthFn, seconds, sampleRate, channels)
 * @usage
 *   const wav = await AIMEAT.assets.sound.record(function (ctx, out) {
 *     const osc = ctx.createOscillator();
 *     const gain = ctx.createGain();
 *     osc.frequency.setValueAtTime(880, 0);
 *     gain.gain.setValueAtTime(0.3, 0);
 *     gain.gain.exponentialRampToValueAtTime(0.001, 0.25);
 *     osc.connect(gain).connect(out);
 *     osc.start(0);
 *     osc.stop(0.25);
 *   }, 0.25);
 *   const put = await AIMEAT.assets.upload(wav, { app: 'ridge', key: 'ridge/coin.wav' });
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the WAV writer and the offline render.
 */
import { refuse } from './manifest.js';

/** What a rendered voice is sampled at when nothing says otherwise. */
const SAMPLE_RATE = 44100;

/** Write ASCII into a WAV header, one byte per character. */
function tag(view, at, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
}

/**
 * Interleave an AudioBuffer's channels into one stream, which is what a WAV file holds. A mono
 * buffer comes out unchanged.
 * @param {any} buffer
 * @returns {Float32Array}
 */
function interleave(buffer) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  if (channels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(length * channels);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i * channels + c] = data[i];
  }
  return out;
}

/**
 * Write samples as a 16-bit PCM WAV.
 *
 * A Float32Array is taken as one mono channel at `sampleRate`. An AudioBuffer brings its own
 * sample rate and channel count, and those win over the argument, because the buffer knows.
 *
 * @param {Float32Array|any} samples   a Float32Array, or an AudioBuffer
 * @param {number} [sampleRate]        44100 by default; ignored for an AudioBuffer
 * @returns {Blob}
 */
export function toWav(samples, sampleRate) {
  let data;
  let channels = 1;
  let rate = sampleRate && sampleRate > 0 ? Math.floor(sampleRate) : SAMPLE_RATE;

  if (samples && typeof samples === 'object' && typeof samples.getChannelData === 'function') {
    data = interleave(samples);
    channels = samples.numberOfChannels;
    rate = samples.sampleRate;
  } else if (samples instanceof Float32Array) {
    data = samples;
  } else if (Array.isArray(samples)) {
    data = Float32Array.from(samples);
  } else {
    refuse('toWav() takes a Float32Array of samples or an AudioBuffer.');
  }

  const frames = /** @type {Float32Array} */ (data).length;
  const bytes = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(bytes);

  tag(view, 0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  tag(view, 8, 'WAVE');
  tag(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // the size of this chunk
  view.setUint16(20, 1, true);           // 1 is uncompressed PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);   // bytes per second
  view.setUint16(32, channels * 2, true);          // bytes per frame
  view.setUint16(34, 16, true);                    // bits per sample
  tag(view, 36, 'data');
  view.setUint32(40, frames * 2, true);

  let at = 44;
  for (let i = 0; i < frames; i++) {
    // Clamp first: a synth graph can overshoot 1.0, and an unclamped overshoot wraps around into
    // the opposite polarity, which is heard as a crack rather than as loudness.
    const s = Math.max(-1, Math.min(1, /** @type {Float32Array} */ (data)[i]));
    view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    at += 2;
  }

  return new Blob([bytes], { type: 'audio/wav' });
}

/**
 * Render a Web Audio graph into a WAV, offline.
 *
 * The callback is handed a live OfflineAudioContext and the destination to connect to. It builds
 * whatever it likes and starts its own sources; nothing is scheduled on its behalf, because a synth
 * voice is exactly the timing the caller wrote.
 *
 * @param {(ctx: any, destination: any) => void} synthFn
 * @param {number} seconds
 * @param {number} [sampleRate]   44100 by default
 * @param {number} [channels]     1 by default: an effect is mono and half the bytes
 * @returns {Promise<Blob>}
 */
export async function record(synthFn, seconds, sampleRate, channels) {
  if (typeof synthFn !== 'function') {
    refuse('record() takes a function (ctx, destination) that builds the sound.');
  }
  const length = Number(seconds);
  if (!(length > 0)) refuse('record() needs a length in seconds.');

  const Offline = /** @type {any} */ (window).OfflineAudioContext
    || /** @type {any} */ (window).webkitOfflineAudioContext;
  if (!Offline) {
    refuse('this browser has no OfflineAudioContext, so a sound cannot be rendered here. Upload a '
      + 'file made elsewhere instead.');
  }

  const rate = sampleRate && sampleRate > 0 ? Math.floor(sampleRate) : SAMPLE_RATE;
  const count = channels && channels > 0 ? Math.floor(channels) : 1;
  const ctx = new Offline(count, Math.ceil(length * rate), rate);
  synthFn(ctx, ctx.destination);
  const rendered = await ctx.startRendering();
  return toWav(rendered);
}

/** The two calls that turn a synth voice into a file. */
export const sound = { toWav, record };
