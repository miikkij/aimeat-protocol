/**
 * @file test/unit/line-breaks.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description public/views/home/line-breaks.js keepLineBreaks: an agent's words drawn as Markdown
 *   keep their line breaks, and Markdown blocks keep their shape.
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (Claude Code's three-line answer read as one line on the work page).
 */
import { describe, it, expect } from 'vitest';
import { keepLineBreaks } from '../../public/views/home/line-breaks.js';

describe('keepLineBreaks', () => {
  it('puts a blank line between plain lines, so each stays its own paragraph', () => {
    expect(keepLineBreaks('IMvNuTmH\n8\n2026-10-17T00:47:26+03:00')).toBe('IMvNuTmH\n\n8\n\n2026-10-17T00:47:26+03:00');
  });

  it('leaves a list, a table and a heading as they are', () => {
    const list = '- one\n- two\n- three';
    expect(keepLineBreaks(list)).toBe(list);
    const table = '| a | b |\n|---|---|\n| 1 | 2 |';
    expect(keepLineBreaks(table)).toBe(table);
    expect(keepLineBreaks('# Title\nText')).toBe('# Title\nText');
  });

  it('leaves fenced code untouched', () => {
    const code = '```\nline one\nline two\n```';
    expect(keepLineBreaks(code)).toBe(code);
  });

  it('keeps existing blank lines and handles Windows line ends and nothing at all', () => {
    expect(keepLineBreaks('a\n\nb')).toBe('a\n\nb');
    expect(keepLineBreaks('a\r\nb')).toBe('a\n\nb');
    expect(keepLineBreaks(undefined)).toBe('');
  });
});
