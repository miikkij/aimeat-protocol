/**
 * @file test/unit/adoption-cutoff.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ADOPTION_CUTOFF, the release time of the first version whose connector keeps a record
 *   of trusted commands, is written once and never moved (scripts/lib/adoption-cutoff.mjs), and the
 *   line the release scripts rewrite is the line src/cli/connect/adoption-cutoff.ts holds
 *   (secaudit2026oct26 round 8c, connector-04).
 * @usage cd aimeat && pnpm exec vitest run test/unit/adoption-cutoff.test.ts
 * @version-history
 *   2026-10-30 -- Initial (secaudit2026oct26 round 8c, connector-04).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CUTOFF_FILE, readAdoptionCutoff, stampAdoptionCutoff } from '../../scripts/lib/adoption-cutoff.mjs';
import { ADOPTION_CUTOFF } from '../../src/cli/connect/adoption-cutoff.js';

const NULL_LINE = "export const ADOPTION_CUTOFF: string | null = null;\n";

describe('the adoption cut-off', () => {
  it('the scripts read the same value the connector imports', () => {
    expect(readAdoptionCutoff(readFileSync(CUTOFF_FILE, 'utf-8'))).toBe(ADOPTION_CUTOFF);
  });

  it('is written once, as an ISO time, when it is null', () => {
    const { text, changed } = stampAdoptionCutoff(NULL_LINE, Date.parse('2026-11-02T10:00:00Z'));
    expect(changed).toBe(true);
    expect(readAdoptionCutoff(text)).toBe('2026-11-02T10:00:00.000Z');
  });

  it('is never moved by a later release', () => {
    const first = stampAdoptionCutoff(NULL_LINE, Date.parse('2026-11-02T10:00:00Z')).text;
    const second = stampAdoptionCutoff(first, Date.parse('2027-01-01T00:00:00Z'));
    expect(second.changed).toBe(false);
    expect(readAdoptionCutoff(second.text)).toBe('2026-11-02T10:00:00.000Z');
  });

  it('refuses a file without the declaration line', () => {
    expect(() => readAdoptionCutoff('export const SOMETHING_ELSE = 1;\n')).toThrow(/ADOPTION_CUTOFF/);
  });
});
