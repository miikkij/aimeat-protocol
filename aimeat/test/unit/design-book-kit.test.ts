/**
 * @file test/unit/design-book-kit.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The kit kind's pure rules (services/design-book/kit.ts): what the bench takes and
 *   refuses, how a kit is stored, the status its reach gives it, and what taking it answers.
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa).
 */
import { describe, it, expect } from 'vitest';
import { validateKitBody, kitVisibility, kitStatusOnPropose, kitSnippet, kitReach } from '../../src/services/design-book/kit.js';
import { validatePartInput } from '../../src/services/design-book/validate.js';

const base = { reach: 'own', look: 'editorial' };

describe('the kit bench', () => {
  it('takes a whole kit and keeps what it was given', () => {
    const body = validateKitBody({ ...base, genre: 'genre-pressdrop', tokens: { '--ak-radius': '2px' }, ornament: { set: 'crystal' }, logo: '/v1/pub/alice/logo.png', from_app: 'habits.html' });
    expect(body).toEqual({ reach: 'own', look: 'editorial', genre: 'genre-pressdrop', tokens: { '--ak-radius': '2px' }, ornament: { set: 'crystal' }, logo: '/v1/pub/alice/logo.png', from_app: 'habits.html' });
  });
  it('is a part kind the validator knows', () => {
    expect(validatePartInput({ id: 'kit-test', kind: 'kit', title: 'T', summary: 'S', body: base }).kind).toBe('kit');
  });
  it('refuses a reach, a look, an organism, a set, a logo and a token outside its rules, in words', () => {
    expect(() => validateKitBody({ look: 'editorial' })).toThrow(/reach/);
    expect(() => validateKitBody({ ...base, look: 'nowhere' })).toThrow(/looks it has/);
    expect(() => validateKitBody({ reach: 'organism', look: 'editorial' })).toThrow(/organism/);
    expect(() => validateKitBody({ ...base, organism: 'org-1234' })).toThrow(/reach "organism" only/);
    expect(() => validateKitBody({ ...base, ornament: { set: 'baroque' } })).toThrow(/ornament/);
    expect(() => validateKitBody({ ...base, logo: 'http://example.com/a.png' })).toThrow(/logo/);
    expect(() => validateKitBody({ ...base, tokens: { '--ak-nowhere': '1px' } })).toThrow(/tokens/);
  });
});

describe('reach, storage and status', () => {
  const part = (reach: string, status = 'published') => ({ kind: 'kit', body: { reach }, proposed_by_owner: 'a@n', status });
  it('stores a kit narrower than the node private, whatever its status', () => {
    expect(kitVisibility(part('own'))).toBe('private');
    expect(kitVisibility(part('organism'))).toBe('private');
    expect(kitVisibility(part('node'))).toBe('public');
    expect(kitVisibility(part('node', 'proposed'))).toBe('members');
    expect(kitReach({ kind: 'look', body: {} })).toBe('node');
  });
  it('publishes a narrower kit at once, and a node kit only when earned or already earned there', () => {
    expect(kitStatusOnPropose({ reach: 'own', look: 'editorial' }, null, false)).toBe('published');
    expect(kitStatusOnPropose({ reach: 'node', look: 'editorial' }, null, false)).toBe('proposed');
    expect(kitStatusOnPropose({ reach: 'node', look: 'editorial' }, null, true)).toBe('published');
    // Widening an own kit to the node does not carry its narrower "published" along.
    expect(kitStatusOnPropose({ reach: 'node', look: 'editorial' }, { kind: 'kit', status: 'published', body: { reach: 'own' } }, false)).toBe('proposed');
    expect(kitStatusOnPropose({ reach: 'node', look: 'editorial' }, { kind: 'kit', status: 'aging', body: { reach: 'node' } }, false)).toBe('aging');
  });
});

describe('what taking a kit answers', () => {
  it('the fork, the head stylesheet with the accent pair per mode, the app line and the ornament line', () => {
    const s = kitSnippet({ reach: 'own', look: 'editorial', genre: 'genre-pressdrop', tokens: { '--ak-accent': '#111111/#eeeeee', '--ak-radius': '2px' }, ornament: { set: 'crystal', palette: 'look' }, logo: '/v1/pub/a/l.png' }, 'House');
    expect(s.fork).toBe('/v1/app-templates/genre-pressdrop');
    expect(s.css).toContain(':root { --ak-accent: #111111; --ak-radius: 2px; }');
    expect(s.css).toContain(':root[data-theme="dark"] { --ak-accent: #eeeeee; }');
    expect(s.app).toContain("look: 'editorial'");
    expect(s.app).toContain('logo: "/v1/pub/a/l.png"');
    expect(s.ornament).toContain("ornamentSet('crystal'");
    expect(s.ornament).toContain("palette: 'look'");
    expect(s.use).toContain('House');
  });
  it('leaves out what the kit does not carry', () => {
    const s = kitSnippet({ reach: 'own', look: 'editorial' }, 'Plain');
    expect(s.fork).toBeUndefined();
    expect(s.css).toBeUndefined();
    expect(s.ornament).toBeUndefined();
  });
});
