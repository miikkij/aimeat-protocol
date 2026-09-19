/**
 * @file voice/segments.js
 * @description Incremental sentence segmentation with a bounded wait and cancellation.
 * @structure abortable, delay, segments
 * @usage for await (const text of segments(tokens, config.chunking, signal)) { ... }
 * @version-history v1.0.0 - 2026-09-19 - Flush without waiting for a whole model answer.
 */
/** @param {Promise<any>} promise @param {AbortSignal} signal */
export function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('Interrupted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
/** @param {number} ms @param {AbortSignal} signal */
export function delay(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(undefined); }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}
/** @param {AsyncIterable<string>} source @param {{mode?:string,minChars:number,maxChars:number,maxWaitMs:number}} opts @param {AbortSignal} signal */
export async function* segments(source, opts, signal) {
  const iterator = source[Symbol.asyncIterator]();
  let pending = iterator.next();
  let buffer = '';
  let since = Date.now();
  try {
    while (true) {
      signal.throwIfAborted();
      const sentence = [...buffer.matchAll(/[.!?…。！？](?:["')\]]*)(?:\s|$)|\n/g)].find(match => match.index + match[0].length >= opts.minChars);
      let cut = sentence && sentence.index + sentence[0].length <= opts.maxChars ? sentence.index + sentence[0].length : 0;
      if (!cut && buffer.length >= opts.maxChars) {
        cut = buffer.lastIndexOf(' ', opts.maxChars);
        if (cut < opts.minChars) cut = opts.maxChars;
      }
      if (!cut && opts.mode !== 'sentence' && buffer.trim() && Date.now() - since >= opts.maxWaitMs) cut = buffer.length;
      if (cut) {
        const part = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut); since = Date.now();
        if (part) yield part;
        continue;
      }
      let timer;
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.max(1, opts.maxWaitMs - (Date.now() - since))); });
      let result;
      try { result = await abortable(opts.mode !== 'sentence' && buffer.trim() ? Promise.race([pending, timeout]) : pending, signal); }
      finally { clearTimeout(timer); }
      if (!result) continue;
      if (result.done) { if (buffer.trim()) yield buffer.trim(); return; }
      if (!buffer.trim()) since = Date.now();
      buffer += result.value;
      pending = iterator.next();
      // A consumer may be playing audio when the provider fails. Observe the rejection now.
      pending.catch(() => {}); // Rethrown when the same pending promise is awaited.
    }
  } finally {
    // Never wait for a custom adapter that ignores cancellation before releasing the microphone.
    if (iterator.return) void iterator.return().catch(err => { if (!signal.aborted) console.warn('[voice] stream cleanup failed', err); });
  }
}
