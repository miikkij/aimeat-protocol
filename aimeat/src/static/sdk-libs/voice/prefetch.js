/**
 * @file voice/prefetch.js
 * @description Read speech ahead of playback with bounded memory and cancellation.
 * @structure prefetchAudio
 * @usage const stream = prefetchAudio(adapter.speak(text, ctx), ctx.signal)
 * @version-history v1.1.0 - 2026-09-19 - Overlap provider latency with the previous sentence.
 */
import { abortable } from './segments.js';

/** @param {AsyncIterable<Uint8Array>} source @param {AbortSignal} signal */
export function prefetchAudio(source, signal) {
  const queue = [];
  const iterator = source[Symbol.asyncIterator]();
  let bytes = 0, done = false, error, wake, space;
  const notify = () => { if (wake) { wake(); wake = null; } };
  // A producer may not honor cancellation. Observe its promise, but do not wait for it to stop.
  const producer = (async () => {
    try {
      while (true) {
        while (bytes >= 1_000_000) await abortable(new Promise(resolve => { space = resolve; }), signal);
        const result = await abortable(iterator.next(), signal);
        if (result.done) break;
        if (!(result.value instanceof Uint8Array) || result.value.byteLength > 8_000_000) throw new Error('Invalid or oversized speech chunk');
        queue.push(result.value); bytes += result.value.byteLength; notify();
      }
    } catch (err) { error = err; }
    finally {
      done = true; notify();
      if (iterator.return) void iterator.return().catch(err => { if (!signal.aborted) console.warn('[voice] speech cleanup failed', err); });
    }
  })();
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        signal.throwIfAborted();
        if (error) throw error;
        if (queue.length) {
          const chunk = queue.shift(); bytes -= chunk.byteLength;
          if (space) { space(); space = null; }
          yield chunk;
        } else if (done) { await producer; return; }
        else await abortable(new Promise(resolve => { wake = resolve; }), signal);
      }
    },
  };
}
