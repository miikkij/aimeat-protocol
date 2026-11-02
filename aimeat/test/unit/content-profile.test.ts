/**
 * @file test/unit/content-profile.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fingerprint's pure parts (src/services/content/profile.ts): the text is cut into
 *   the same sections every time (at headings, small pieces merged, large ones split at blank lines,
 *   at most 24), and the tag says the genre and mark shares, the topics with their marks and the
 *   leaning in the three default views.
 * @structure segmentText · fingerprintTag
 * @usage cd aimeat && pnpm exec vitest run test/unit/content-profile.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { segmentText, fingerprintTag, PROFILE_PROMPT } from '../../src/services/content/profile.js';
import type { ContentProfile } from '../../src/services/content/types.js';

const words = (n: number, w = 'sana') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

describe('segmentText', () => {
  it('cuts at headings and takes the first heading as the title', () => {
    const t = `# Raportti\n\n## Hinnat\n${words(60)}\n\n## Päätös\n${words(50)}`;
    const s = segmentText(t);
    expect(s.title).toBe('Raportti');
    expect(s.sections.map((x) => x.heading)).toEqual(['Hinnat', 'Päätös']);
    expect(s.sections.map((x) => x.words)).toEqual([60, 50]);
    expect(segmentText(t)).toEqual(s);
  });

  it('merges a piece under 40 words into the next one', () => {
    const s = segmentText(`## Lyhyt\n${words(10)}\n\n## Pitkä\n${words(60)}`);
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0].heading).toBe('Lyhyt');
    expect(s.sections[0].text).toContain('Pitkä');
  });

  it('splits a piece over 380 words at its blank lines', () => {
    const body = Array.from({ length: 6 }, () => words(120)).join('\n\n');
    const s = segmentText(`## Iso\n${body}`);
    expect(s.sections.length).toBeGreaterThan(1);
    expect(s.sections[1].heading).toBe('Iso (jatkuu)');
    expect(s.sections.every((x) => x.words <= 380)).toBe(true);
  });

  it('keeps at most 24 sections', () => {
    const t = Array.from({ length: 40 }, (_, i) => `## Osa ${i}\n${words(45)}`).join('\n\n');
    const s = segmentText(t);
    expect(s.sections).toHaveLength(24);
    // Every word stays; the 16 headings merged into a neighbour become words of its text.
    expect(s.sections.reduce((a, x) => a + x.words, 0)).toBe(40 * 45 + 16 * 2);
    expect(s.sections.map((x) => x.n)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });
});

describe('fingerprintTag', () => {
  const profile: ContentProfile = {
    v: 1, prompt: PROFILE_PROMPT, model: 'test/model', at: '2026-11-02T10:00:00.000Z', kind: 'tutkimusraportti',
    topics: [
      { name: 'Hintakehitys', share: 0.75, genre: 'F', mark: '+', axes: { fakta: 0.8, konkr: 0.7, aika: -0.5, toim: -0.5, yks: 0.6, varm: 0.8 } },
      { name: 'Suositukset', share: 0.25, genre: 'P', mark: '?', axes: { fakta: -0.2, konkr: 0.2, aika: 0.7, toim: 0.8, yks: -0.3, varm: 0.1 } },
    ],
    sections: [['F', 300, 0.9, '+', 0], ['F', 300, 0.9, '+', 0], ['P', 200, 0.5, '?', 1]],
    axes: { fakta: 0.5, konkr: 0.6, aika: -0.2, toim: -0.1, yks: 0.4, varm: 0.6 },
  };

  it('writes the shares, the topics with their marks and the leaning', () => {
    const t = fingerprintTag(profile);
    expect(t.lines[0]).toBe('Kind: tutkimusraportti. Fact 75 %, Decision or plan 25 %');
    expect(t.lines[1]).toBe('Topics: Hintakehitys +, Suositukset ?');
    expect(t.lines[2].startsWith('Trust: + 75 %  ? 25 %')).toBe(true);
    expect(t.lines[3]).toBe('Leaning: Measured fact · History and reporting · Precise knowledge');
    expect(t.lines[4]).toBe('Profiled by test/model on 2026-11-02');
    expect([...t.squares].filter((c) => c === '🟦').length).toBe(14);
    expect(t.text.split('\n')).toHaveLength(6);
  });

  it('says when only the beginning of a long text was profiled', () => {
    expect(fingerprintTag({ ...profile, truncatedAt: 48000 }).lines[4]).toContain('from the first 48000 characters');
  });
});
