/**
 * @file log-timestamps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Put a local date and time in front of every line a long-running process prints, by
 *   wrapping the streams themselves rather than the logging calls.
 *
 *   THE PROBLEM. The serve daemon's own window is the first place anyone looks to find out what
 *   just happened, and until this it could not answer: the only timestamp on the screen was the
 *   BINARY'S BUILD TIME. Reconnect and token-refresh lines are exactly the ones read when something
 *   is wrong, and nothing said whether they were five seconds or five hours old, or how often the
 *   tunnel had been renewing. crewaimeat reported it on 2026-09-07 against a 62-agent fleet.
 *
 *   WHY THE STREAM AND NOT THE LOG CALLS. A wrapper PROCESS was tried on the caller's side first
 *   and did not survive contact with a detached daemon: the wrapper takes the child's stdout for
 *   itself, and when nobody is holding the wrapper's own stdout the lines go nowhere — an empty
 *   console and one extra process. Patching `console.error` inside the daemon would have covered
 *   this file's own lines and missed every line a dependency writes straight to the stream, which
 *   in a daemon is where the surprises come from. `write` is the one place every line passes.
 *
 *   WHAT IS LEFT ALONE. A blank line stays blank, a line that already begins with a timestamp is
 *   not stamped twice (winston's dev format writes its own), and a line that begins with `{` is
 *   left intact because a prefix would stop it parsing as the JSON log line it is. Partial writes
 *   are tracked per stream, so a chunk that does not end in a newline continues the same line and
 *   the stamp lands only where a line actually starts.
 * @structure
 *   - localStamp(): the `2026-09-07 18:42:38` form, local time, matching the serve watchdog's
 *   - LineStamper: line-boundary state for one stream
 *   - timestampsEnabled(): reads AIMEAT_LOG_TIMESTAMPS (on unless it says otherwise)
 *   - installTimestampedOutput(): wraps the streams' `write`, returns the restore function
 * @usage
 *   import { installTimestampedOutput } from '../utils/log-timestamps.js';
 *   installTimestampedOutput();   // first thing in a daemon's entry point
 * @version-history
 *   v1.0.0 — 2026-09-07 — Initial, for the serve daemon's console.
 */

/** Streams are patched at most once; a second install would stamp the stamp. */
const PATCHED = Symbol.for('aimeat.log-timestamps.patched');

/**
 * A line already stamped in THIS format, and nothing else. Deliberately narrow: winston's own line
 * opens with a UTC ISO instant, and leaving that as the line's only clock would put two different
 * clocks in one window — in Helsinki in summer, three hours apart. A reader asking "how long ago"
 * would have to know which format they were looking at, which is the question this whole thing
 * exists to answer. So an ISO line gets a local stamp in front of it and keeps its own; only our
 * own prefix is recognised, so a re-entrant install cannot stamp the stamp.
 */
const ALREADY_STAMPED = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /;

/**
 * A JSON log line (winston under NODE_ENV=production). A prefix would make it unparseable.
 *
 * An OBJECT only. Extending this to `[` for the sake of a JSON array cost every line this feature
 * exists for: `[serve] discovery: …` and `[tunnel:https://aimeat.io] Reconnecting …` both open with
 * a bracket, and both went out unstamped until the test caught it.
 */
const STRUCTURED_LINE = /^\s*\{/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Local wall-clock time, `2026-09-07 18:42:38`. Local rather than UTC and space-separated rather
 * than ISO on purpose: this is the format the serve watchdog writes, and the two logs are read side
 * by side. Machine consumers read the discovery file and the API, not this stream.
 */
export function localStamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Stamps line starts inside a stream of chunks. One instance per stream: `atLineStart` is the
 * only state, and it is what keeps a stamp out of the middle of a line that arrived in pieces.
 */
export class LineStamper {
  private atLineStart = true;

  constructor(private readonly now: () => Date = () => new Date()) {}

  stamp(text: string): string {
    if (text === '') return text;
    const prefix = `${localStamp(this.now())} `;
    let out = '';
    let i = 0;
    while (i < text.length) {
      const nl = text.indexOf('\n', i);
      const end = nl === -1 ? text.length : nl + 1;
      const chunk = text.slice(i, end);
      const body = nl === -1 ? chunk : chunk.slice(0, -1);
      if (this.atLineStart && body.trim() !== '' && !ALREADY_STAMPED.test(body) && !STRUCTURED_LINE.test(body)) {
        out += prefix;
      }
      out += chunk;
      this.atLineStart = nl !== -1;
      i = end;
    }
    return out;
  }
}

/**
 * On unless the environment says otherwise. A log line with no clock is the one nobody misses until
 * they need it, so the useful default is the one that costs nothing to turn off:
 * `AIMEAT_LOG_TIMESTAMPS=0` (or `false`, `off`, `no`) for a caller that stamps the lines itself.
 */
export function timestampsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.AIMEAT_LOG_TIMESTAMPS;
  if (raw === undefined) return true;
  return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
}

export interface TimestampedOutputOptions {
  /** Defaults to stdout and stderr. A caller whose stdout carries a protocol passes stderr alone. */
  streams?: NodeJS.WriteStream[];
  /** Overrides the environment; the tests use it, callers should not need it. */
  enabled?: boolean;
  /** Clock seam for the tests. */
  now?: () => Date;
}

/** `write` with its overloads flattened — we forward the arguments we were given, unchanged. */
type RawWrite = (this: NodeJS.WritableStream, ...args: unknown[]) => boolean;

/**
 * Wrap the given streams so every line they carry starts with a local timestamp. Returns the
 * function that puts the original `write` back; installing twice is a no-op on an already-wrapped
 * stream, so an entry point calling this and a test calling it again cannot double-stamp.
 */
export function installTimestampedOutput(opts: TimestampedOutputOptions = {}): () => void {
  if (!(opts.enabled ?? timestampsEnabled())) return () => { /* disabled — nothing to restore */ };

  const streams = opts.streams ?? [process.stdout, process.stderr];
  const restores: Array<() => void> = [];

  for (const stream of streams) {
    const marked = stream as unknown as Record<symbol, boolean>;
    if (marked[PATCHED]) continue;

    const original = stream.write as unknown as RawWrite;
    const stamper = new LineStamper(opts.now);

    const patched = function patchedWrite(this: unknown, chunk: unknown, ...rest: unknown[]): boolean {
      if (typeof chunk === 'string') {
        return original.call(stream, stamper.stamp(chunk), ...rest);
      }
      if (chunk instanceof Uint8Array) {
        // Log bytes are utf-8. The encoding argument does not apply to a buffer, so only a
        // callback can be in `rest`, and it is the one thing that must survive.
        const cb = rest.find(a => typeof a === 'function');
        const text = stamper.stamp(Buffer.from(chunk).toString('utf-8'));
        return original.call(stream, Buffer.from(text, 'utf-8'), cb);
      }
      return original.call(stream, chunk, ...rest);
    };

    stream.write = patched as unknown as typeof stream.write;
    marked[PATCHED] = true;
    restores.push(() => {
      stream.write = original as unknown as typeof stream.write;
      delete marked[PATCHED];
    });
  }

  return () => { for (const restore of restores) restore(); };
}
