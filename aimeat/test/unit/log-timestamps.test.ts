/**
 * @file test/unit/log-timestamps.test.ts
 * @description The serve daemon's console gets a local clock on every line, and the cases that
 *   would have made it wrong.
 *
 *   THE THING BEING PROVED is not "a prefix appears". It is that the prefix lands where a LINE
 *   starts and nowhere else: a chunk carrying three lines gets three stamps, a chunk that ends
 *   mid-line is continued rather than stamped again, a blank line stays blank, and a line that
 *   already carries its own clock (winston's dev format) or is a JSON log line is left intact —
 *   the second of those would stop parsing if a prefix went in front of it.
 *
 *   THE FAKE IS A REAL STREAM. `installTimestampedOutput` is given a PassThrough rather than
 *   process.stderr, because what it patches is `write` itself, and the assertion worth making is
 *   what comes out the other end of the stream — including the callback a caller passed, which is
 *   the argument the buffer path could have dropped.
 * @version-history
 *   v1.0.0 — 2026-09-07 — Initial, with the change it exists to hold.
 */
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { LineStamper, localStamp, timestampsEnabled, installTimestampedOutput } from '../../src/utils/log-timestamps.js';

/** 2026-09-07 18:42:38 local time, whatever zone the test runs in. */
const AT = new Date(2026, 8, 7, 18, 42, 38);
const STAMP = '2026-09-07 18:42:38';
const clock = () => AT;

describe('localStamp', () => {
  it('is local wall-clock time in the serve watchdog\'s format', () => {
    expect(localStamp(AT)).toBe(STAMP);
  });

  it('pads every field to two digits', () => {
    expect(localStamp(new Date(2026, 0, 3, 4, 5, 6))).toBe('2026-01-03 04:05:06');
  });
});

describe('LineStamper', () => {
  it('stamps a single line', () => {
    expect(new LineStamper(clock).stamp('[serve] discovery: x\n')).toBe(`${STAMP} [serve] discovery: x\n`);
  });

  it('stamps every line of a multi-line chunk', () => {
    const out = new LineStamper(clock).stamp('one\ntwo\nthree\n');
    expect(out).toBe(`${STAMP} one\n${STAMP} two\n${STAMP} three\n`);
  });

  it('continues a line that arrived in pieces instead of stamping the middle of it', () => {
    const stamper = new LineStamper(clock);
    expect(stamper.stamp('Reconnecting in ')).toBe(`${STAMP} Reconnecting in `);
    expect(stamper.stamp('1231ms')).toBe('1231ms');
    expect(stamper.stamp(' (attempt 1)\n')).toBe(' (attempt 1)\n');
    expect(stamper.stamp('next line\n')).toBe(`${STAMP} next line\n`);
  });

  it('leaves a blank line blank', () => {
    expect(new LineStamper(clock).stamp('a\n\nb\n')).toBe(`${STAMP} a\n\n${STAMP} b\n`);
  });

  it('does not stamp a line already stamped in this format', () => {
    const line = `${STAMP} [serve] already stamped\n`;
    expect(new LineStamper(clock).stamp(line)).toBe(line);
  });

  it('does stamp winston\'s own line, whose clock is UTC and three hours off in summer', () => {
    const line = '2026-09-07T15:42:38.754Z info: tunnel attached\n';
    expect(new LineStamper(clock).stamp(line)).toBe(`${STAMP} ${line}`);
  });

  it('does not stamp a JSON log line, which a prefix would stop parsing', () => {
    const line = '{"level":"warn","message":"shutdown: ignore"}\n';
    expect(new LineStamper(clock).stamp(line)).toBe(line);
  });

  it('passes an empty write through untouched', () => {
    expect(new LineStamper(clock).stamp('')).toBe('');
  });

  it('handles CRLF without stamping the carriage return as its own line', () => {
    expect(new LineStamper(clock).stamp('one\r\ntwo\r\n')).toBe(`${STAMP} one\r\n${STAMP} two\r\n`);
  });
});

describe('timestampsEnabled', () => {
  it('is on when the variable is not set', () => {
    expect(timestampsEnabled({})).toBe(true);
  });

  it('is off for the four words that mean off', () => {
    for (const value of ['0', 'false', 'off', 'no', 'OFF', ' False ']) {
      expect(timestampsEnabled({ AIMEAT_LOG_TIMESTAMPS: value })).toBe(false);
    }
  });

  it('is on for anything else', () => {
    expect(timestampsEnabled({ AIMEAT_LOG_TIMESTAMPS: '1' })).toBe(true);
  });
});

describe('installTimestampedOutput', () => {
  /** A PassThrough is a real WritableStream, so `write` is patched exactly as it is on stderr. */
  function stream(): { s: PassThrough; read: () => string } {
    const s = new PassThrough();
    let buf = '';
    s.on('data', (d: Buffer) => { buf += d.toString('utf-8'); });
    return { s, read: () => buf };
  }

  it('stamps what console.error would write, and restores the original write', async () => {
    const { s, read } = stream();
    const restore = installTimestampedOutput({ streams: [s as unknown as NodeJS.WriteStream], enabled: true, now: clock });

    s.write('[serve] 62 agent(s)\n');
    restore();
    s.write('[serve] after restore\n');
    await new Promise(resolve => setImmediate(resolve));

    expect(read()).toBe(`${STAMP} [serve] 62 agent(s)\n[serve] after restore\n`);
  });

  it('stamps a Buffer write and still calls the callback it was given', async () => {
    const { s, read } = stream();
    const restore = installTimestampedOutput({ streams: [s as unknown as NodeJS.WriteStream], enabled: true, now: clock });

    const called = await new Promise<boolean>((resolve) => {
      s.write(Buffer.from('[tunnel] token refresh\n', 'utf-8'), () => resolve(true));
    });
    restore();

    expect(called).toBe(true);
    expect(read()).toBe(`${STAMP} [tunnel] token refresh\n`);
  });

  it('installs once, so a second call cannot stamp the stamp', async () => {
    const { s, read } = stream();
    const first = installTimestampedOutput({ streams: [s as unknown as NodeJS.WriteStream], enabled: true, now: clock });
    const second = installTimestampedOutput({ streams: [s as unknown as NodeJS.WriteStream], enabled: true, now: clock });

    s.write('once\n');
    second();
    first();
    await new Promise(resolve => setImmediate(resolve));

    expect(read()).toBe(`${STAMP} once\n`);
  });

  it('does nothing at all when the environment turns it off', async () => {
    const { s, read } = stream();
    installTimestampedOutput({ streams: [s as unknown as NodeJS.WriteStream], enabled: false, now: clock })();

    s.write('bare\n');
    await new Promise(resolve => setImmediate(resolve));

    expect(read()).toBe('bare\n');
  });
});
