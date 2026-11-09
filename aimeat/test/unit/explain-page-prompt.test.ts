/**
 * @file explain-page-prompt.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Explain this page to me" (public/js/ask-ai-prompt.js buildPagePrompt, drawn by
 *   PageStart): the prompt carries the page's own explanation, so an AI with no connection answers
 *   from AIMEAT's words, and it carries who the person is from their profile.explain record; without
 *   one it asks the AI to ask them first. Every admin page has its PageStart words in all three
 *   languages, since the admin frame draws PageStart on each.
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (guidance audit 2026-11-09, items 2 and 3).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error -- a browser module with no types; it imports nothing.
import { buildPagePrompt, aboutLine, EXPLAIN_PROFILE_KEY } from '../../public/js/ask-ai-prompt.js';

const base = 'https://node.example';
const material = ['What the page is for: Connect the AI you already use.', 'What it is: A connection through MCP.'];

describe('buildPagePrompt', () => {
    it('carries the page title, its own explanation and the answer language', () => {
        const p = buildPagePrompt({ title: 'Connect your AI', explanation: material, locale: 'fi', base });
        expect(p).toContain('"Connect your AI"');
        expect(p).toContain('--- AIMEAT material ---');
        for (const line of material) expect(p).toContain(line);
        expect(p).toContain('in Finnish');
        expect(p).toContain(`${base}/v1/glossary.md`);
    });

    it('names the role and level from the record when there is one', () => {
        const p = buildPagePrompt({ title: 'Memory', explanation: material, about: { role: 'team lead of a sales team', level: 'daily' }, locale: 'en', base });
        expect(p).toContain('my role is team lead of a sales team.');
        expect(p).toContain('I am not technical');
        expect(p).not.toContain('I have not told AIMEAT my role');
    });

    it('asks the AI to ask first, and names the record to keep the answer in, when there is none', () => {
        const p = buildPagePrompt({ title: 'Memory', explanation: material, about: null, locale: 'en', base });
        expect(p).toContain('I have not told AIMEAT my role yet');
        expect(p).toContain(EXPLAIN_PROFILE_KEY);
        expect(p).toContain('visibility "owner"');
        expect(p).toContain('Write it only when I say yes.');
    });

    it('points a connected AI at the page\'s concept when it has one, and at the places tier always', () => {
        expect(buildPagePrompt({ title: 'Goals', explanation: material, concept: 'concept.goal', locale: 'en', base })).toContain('"settings/concept.goal"');
        const admin = buildPagePrompt({ title: 'Config', explanation: material, locale: 'en', base });
        expect(admin).toContain('"places/admin"');
        expect(admin).toContain('Change nothing while you explain.');
    });

    it('ignores an unknown level and a role that is not text', () => {
        expect(aboutLine({ role: 42, level: 'expert' })).toContain('I have not told AIMEAT my role');
        expect(aboutLine({ level: 'technical' })).toBe('About me: I am technical. Use the industry terms.');
    });
});

describe('the admin pages\' PageStart words', () => {
    const adminJs = readFileSync(new URL('../../public/views/admin.js', import.meta.url), 'utf8');
    const ids = [...adminJs.matchAll(/\{ id: '([a-zA-Z-]+)',\s*key: '[^']+',\s*component: \w+/g)].map(m => m[1]);

    it('the admin tab registry is read (52 pages on 2026-11-09)', () => {
        expect(ids.length).toBeGreaterThanOrEqual(52);
    });

    for (const locale of ['en', 'fi', 'es']) {
        it(`every admin page has purpose, prompt and next in ${locale}`, () => {
            const dict = JSON.parse(readFileSync(new URL(`../../locales/${locale}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
            const missing = ids.flatMap(id => ['purpose', 'prompt', 'next']
                .map(part => `pageStart.admin.${id}.${part}`)
                .filter(k => typeof dict[k] !== 'string' || !(dict[k] as string).trim()));
            expect(missing).toEqual([]);
        });
    }
});
