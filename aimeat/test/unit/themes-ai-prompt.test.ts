/**
 * @file themes-ai-prompt.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two prompts of Themes & Styles' "Ask your AI" section and the reader of the AI's
 *   answer. The prompts must carry what the node serves (the tools, the colour values, the shapes,
 *   the fonts) and the person's own words; the reader must find the theme in a chatty answer and
 *   refuse a form the paste cannot apply, with the reason the page shows.
 * @usage cd aimeat && pnpm exec vitest run test/unit/themes-ai-prompt.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (wish "Themes & Styles: Pyydä tekoälyltä -lohko").
 */
import { describe, it, expect } from 'vitest';
import { buildThemeMcpPrompt, buildThemeJsonPrompt, readThemeAnswer } from '../../public/views/admin/themes-tab.prompt.js';

const THEMES = [
    { id: 'aimeat', name: 'AIMEAT', builtin: true, retired: false, defaultStyle: 'aimeat',
        styles: [{ id: 'aimeat', name: 'AIMEAT', retired: false, light: { '--bg': '#F7F7F5' }, dark: { '--bg': '#14141F' } }, { id: 'paper', name: 'Paper', retired: false }] },
    { id: 'super', name: 'SUPER', builtin: false, retired: false, defaultStyle: 'super-aimeat', styles: [{ id: 'super-aimeat', name: 'AIMEAT', retired: false }] },
];
const VOCABULARY = {
    tokens: [{ name: '--bg', kind: 'colour', what: 'the page ground' }, { name: '--font-x', kind: 'face', what: 'not a colour' }],
    faces: ['Archivo', 'Fraunces'],
    shapes: [{ name: '--shape-corner', kind: 'corner', what: 'the corner of a box', builtin: '0' }],
};

describe('the prompt for an AI connected over MCP', () => {
    const p = buildThemeMcpPrompt({ url: 'https://aimeat.io', look: 'calm and green', themes: THEMES });
    it('names the node, the look and the themes there now', () => {
        expect(p).toContain('https://aimeat.io');
        expect(p).toContain('calm and green');
        expect(p).toContain('super  "SUPER"');
        expect(p).toContain('(built-in, read only)');
    });
    it('names every tool it asks the AI to use', () => {
        for (const tool of ['aimeat_theme_list', 'aimeat_theme_get', 'aimeat_theme_save', 'aimeat_theme_style_save', 'aimeat_theme_component_css_set']) expect(p).toContain(tool);
    });
    it('leaves the offer to the operator', () => {
        expect(p).not.toContain('aimeat_theme_policy_set');
        expect(p).toContain('Keep the theme off the look picker');
    });
    it('asks the person first when no look is written', () => {
        expect(buildThemeMcpPrompt({ themes: THEMES })).toContain('Start by asking me what look I want');
    });
});

describe('the prompt for an AI with no connection', () => {
    const p = buildThemeJsonPrompt({ look: '', themes: THEMES, vocabulary: VOCABULARY });
    it('carries the colour values with the base style\'s values, and only colours', () => {
        expect(p).toContain('--bg  the page ground  (now: light #F7F7F5, dark #14141F)');
        expect(p).not.toContain('--font-x');
    });
    it('carries the shapes and the fonts the node serves', () => {
        expect(p).toContain('--shape-corner  (corner) the corner of a box  (now: 0)');
        expect(p).toContain('Archivo, Fraunces');
    });
    it('ends with the form its answer is read in', () => {
        expect(readThemeAnswer(p.slice(p.indexOf('```json'))).ok).toBe(true);
    });
});

describe('reading the answer', () => {
    const good = { name: 'Fjord', styles: [{ name: 'Fjord', light: { '--bg': '#fff' }, dark: { '--bg': '#000' }, faces: { headline: 'Fraunces' } }], shapes: { '--shape-corner': '12px' } };

    it('finds the last JSON block in a chatty answer', () => {
        const answer = `Here is a first idea:\n\`\`\`json\n{"name":"Draft","styles":[{"name":"A"}]}\n\`\`\`\nAnd the final one:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\nEnjoy.`;
        const r = readThemeAnswer(answer);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.plan.name).toBe('Fjord');
            expect(r.plan.basedOn).toBe('aimeat');
            expect(r.plan.styles[0].faces).toEqual({ headline: 'Fraunces' });
            expect(r.plan.shapes).toEqual({ '--shape-corner': '12px' });
        }
    });
    it('takes bare JSON too', () => {
        expect(readThemeAnswer(`Sure! ${JSON.stringify(good)}`).ok).toBe(true);
    });
    it('keeps onlyMode only when it is light or dark', () => {
        const r = readThemeAnswer(JSON.stringify({ name: 'X', styles: [{ name: 'A', onlyMode: 'dark' }, { name: 'B', onlyMode: 'dusk' }] }));
        expect(r.ok && r.plan.styles.map((s: any) => s.onlyMode)).toEqual(['dark', undefined]);
    });
    it('refuses what the paste cannot apply, with the reason the page names', () => {
        expect(readThemeAnswer('no theme here')).toEqual({ ok: false, error: 'json' });
        expect(readThemeAnswer(JSON.stringify({ styles: [{ name: 'A' }] }))).toEqual({ ok: false, error: 'name' });
        expect(readThemeAnswer(JSON.stringify({ name: 'X', styles: [] }))).toEqual({ ok: false, error: 'styles' });
        expect(readThemeAnswer(JSON.stringify({ name: 'X', styles: [{ light: {} }] }))).toEqual({ ok: false, error: 'styleName' });
        expect(readThemeAnswer(JSON.stringify({ name: 'X', styles: [{ name: 'A', light: { '--bg': 1 } }] }))).toEqual({ ok: false, error: 'colours', at: 'A' });
        expect(readThemeAnswer(JSON.stringify({ name: 'X', styles: [{ name: 'A' }], shapes: ['12px'] }))).toEqual({ ok: false, error: 'shapes' });
    });
});
