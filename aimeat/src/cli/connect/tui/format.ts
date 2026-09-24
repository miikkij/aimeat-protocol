/**
 * @file cli/connect/tui/format.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Text helpers for `aimeat connect tui`: sizes, durations, rates, sparklines, and
 *   fitting a styled string into a column. Pure functions, no terminal access.
 * @structure bytes · rate · duration · ago · clock · spark · visibleLength · fit · style
 * @usage import { bytes, fit, style } from './format.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Created for `aimeat connect tui`.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 → "1.5 KB". Binary steps, one decimal from KB up. */
export function bytes(n: number): string {
  let v = Math.max(0, n);
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) { v /= 1024; u++; }
  return u === 0 ? `${Math.round(v)} B` : `${v.toFixed(1)} ${UNITS[u]}`;
}

export function rate(bytesPerSecond: number): string { return `${bytes(bytesPerSecond)}/s`; }

/** 93784 → "1d 2h 3m". Seconds only below a minute. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

/** How long ago an ISO time was, relative to `now`: "12s ago", "3h 4m ago", "–" for none. */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return '–';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '–';
  return `${duration((now - t) / 1000)} ago`;
}

/** Local HH:MM:SS of an ISO time. */
export function clock(iso: string | number): string {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const TICKS = '▁▂▃▄▅▆▇█';

/** The last `width` values as a bar per value, scaled to the largest of them. */
export function spark(values: number[], width: number): string {
  const v = values.slice(-width);
  const max = Math.max(...v, 0);
  const bars = v.map(x => (max <= 0 ? TICKS[0] : TICKS[Math.min(TICKS.length - 1, Math.round((x / max) * (TICKS.length - 1)))]));
  return bars.join('').padStart(width, ' ');
}

// eslint-disable-next-line no-control-regex -- matching the terminal's own escape sequences is the point
const ANSI = /\x1b\[[0-9;]*m/g;

/** Length of a string as the terminal shows it: escape sequences take no columns. */
export function visibleLength(s: string): number {
  return [...s.replace(ANSI, '')].length;
}

/**
 * Cut or pad a styled string to exactly `width` columns. A cut string ends in "…" and the style is
 * reset, so a colour never runs into the next column.
 */
export function fit(s: string, width: number): string {
  if (width <= 0) return '';
  const len = visibleLength(s);
  if (len <= width) return s + ' '.repeat(width - len);
  let out = '';
  let shown = 0;
  let i = 0;
  while (i < s.length && shown < width - 1) {
    if (s[i] === '\x1b') {
      const end = s.indexOf('m', i);
      if (end < 0) break;
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    out += ch;
    i += ch.length;
    shown++;
  }
  return s.includes('\x1b') ? `${out}…\x1b[0m` : `${out}…`;
}

const CODES = { bold: 1, dim: 2, inverse: 7, red: 31, green: 32, yellow: 33, cyan: 36 } as const;
export type Style = keyof typeof CODES;

/** Wrap text in SGR codes, or leave it plain when colour is off (NO_COLOR, or not a terminal). */
export function style(text: string, color: boolean, ...styles: Style[]): string {
  if (!color || styles.length === 0) return text;
  return `\x1b[${styles.map(s => CODES[s]).join(';')}m${text}\x1b[0m`;
}
