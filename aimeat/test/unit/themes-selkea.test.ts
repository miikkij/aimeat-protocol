/**
 * @file test/unit/themes-selkea.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shipped theme Selkeä: the contrast pairs of its palette, recomputed from the colours
 *   the node serves; every token and shape value it sets passes the node's grammar; its theme CSS
 *   parses; its one style is light only; its faces are served by the node; and the theme service holds
 *   it as a shipped theme (read only, its id reserved, not offered by default, offered when the
 *   operator lists it, giving way to a custom record that already has its id).
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { ratio } from '../../src/services/atelier-color.js';
import { checkContrast } from '../../src/services/themes/contrast.js';
import { lintCss } from '../../src/services/themes/css-lint.js';
import { checkShape } from '../../src/services/themes/shapes.js';
import { themeSheet } from '../../src/services/themes/sheet.js';
import { THEME_FACES, THEME_TOKENS } from '../../src/services/themes/tokens.js';
import { checkValue } from '../../src/services/themes/values.js';
import { SERVED_FONT_FAMILIES } from '../../src/services/app-ui/signature-tokens.js';
import { SELKEA_COLOURS, SELKEA_ID, selkeaTheme } from '../../src/services/themes/selkea.js';
import { ThemeService, THEME_KEY_PREFIX } from '../../src/services/themes/service.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

type Name = keyof typeof SELKEA_COLOURS;

/** [words, ground, minimum, what it is]: every pair the theme puts words on. */
const PAIRS: ReadonlyArray<[Name, Name, number, string]> = [
    ['ink', 'paper', 4.5, 'text on the page ground'],
    ['ink', 'white', 4.5, 'text on a card'],
    ['textMuted', 'paper', 4.5, 'dim text on the page ground'],
    ['textMuted', 'white', 4.5, 'dim text on a card'],
    ['accent', 'paper', 4.5, 'the accent on the page ground'],
    ['accent', 'white', 4.5, 'the accent on a card'],
    ['ink', 'sun', 4.5, 'words on the sun (--on-sun on --sun)'],
    ['white', 'ink', 4.5, 'words on the dark band (--on-ink-ground on --ink-ground), and a filled button'],
    ['white', 'accent', 4.5, 'white words on the accent as a filled button ground'],
    ['white', 'accentDeep', 4.5, 'white words on the accent button under the pointer'],
    ['ink', 'chosen', 4.5, 'text on the chosen ground'],
    ['ink', 'paperSoft', 4.5, 'text on the alternate card ground'],
    ['textMuted', 'paperDeep', 4.5, 'dim text on the surface ground'],
];

/** A storage that keeps memory records in a map: enough for ThemeService's reads and writes. */
function memoryStorage(): Storage {
    const rows = new Map<string, any>();
    const id = (owner: string, key: string) => `${owner}\u0000${key}`;
    return {
        listAllMemoryMeta: async ({ ownerPrefix, prefix }: { ownerPrefix: string; prefix: string }) => ({
            items: [...rows.values()].filter((r) => r.ownerGaii === ownerPrefix && r.key.startsWith(prefix)).map((r) => ({ key: r.key })),
        }),
        getMemory: async (owner: string, key: string) => rows.get(id(owner, key)) ?? null,
        setMemory: async (rec: any) => { rows.set(id(rec.ownerGaii, rec.key), rec); },
    } as unknown as Storage;
}

const NODE = 'aimeat-local-001-dev';
const service = (offered = '') => new ThemeService({ nodeId: NODE, themesOffered: offered } as unknown as AimeatConfig, memoryStorage());

describe('Selkeä as a theme record', () => {
    const theme = selkeaTheme();
    const style = theme.styles[0];

    it('is one read-only theme with one style, light only, its dark map the light map', () => {
        expect(theme.id).toBe(SELKEA_ID);
        expect(theme.name).toBe('Selkeä');
        expect(theme.builtin).toBe(true);
        expect(theme.styles).toHaveLength(1);
        expect(theme.defaultStyle).toBe(style.id);
        expect(theme.offeredStyles).toEqual([style.id]);
        expect(style.onlyMode).toBe('light');
        expect(style.dark).toEqual(style.light);
    });

    it.each(PAIRS)('%s on %s reaches %s (%s)', (fg, bg, min) => {
        expect(ratio(SELKEA_COLOURS[fg], SELKEA_COLOURS[bg])).toBeGreaterThanOrEqual(min);
    });

    it('carries the palette onto the tokens the pages read', () => {
        const c = SELKEA_COLOURS;
        const map = style.light;
        expect(map['--bg']).toBe(c.paper);
        expect(map['--card-bg']).toBe(c.white);
        expect(map['--card-border']).toBe(c.ink);
        expect(map['--text']).toBe(c.ink);
        expect(map['--text-dim']).toBe(c.textMuted);
        expect(map['--accent']).toBe(c.accent);
        expect(map['--accent-deep']).toBe(c.accentDeep);
        expect(map['--sun']).toBe(c.sun);
        expect(map['--on-sun']).toBe(c.ink);
        expect(map['--ink-ground']).toBe(c.ink);
        expect(map['--on-ink-ground']).toBe(c.white);
    });

    it('sets every token a style sets with a value the node accepts, and passes the node\'s contrast rules', () => {
        for (const t of THEME_TOKENS) {
            expect(style.light[t.name], t.name).toBeDefined();
            expect(checkValue(style.light[t.name], t.kind), t.name).toBeNull();
        }
        expect(checkContrast(style.light, style.dark).filter((r) => !r.ok)).toEqual([]);
    });

    it('sets shape values the node accepts: small corners, thin frames, no shadows', () => {
        const shapes = theme.shapes ?? {};
        expect(Object.keys(shapes).length).toBeGreaterThan(0);
        for (const [name, value] of Object.entries(shapes)) expect(checkShape(name, value), name).toBeNull();
        expect(shapes['--shape-corner']).toBe('4px');
        expect(shapes['--shape-corner-control']).toBe('3px');
        expect(shapes['--shape-frame']).toBe('1.5px');
        expect(shapes['--shape-shadow-action']).toBe('none');
        expect(shapes['--shape-chosen-ground']).toBe(SELKEA_COLOURS.chosen);
    });

    it('serves a stylesheet that parses, reads no outside file and carries its height rule', () => {
        const report = lintCss(theme.css ?? '');
        expect(report.error).toBeFalsy();
        expect(report.rules.length).toBeGreaterThan(50);
        const sheet = themeSheet(theme);
        expect(sheet).toContain('--bg: #FAFAF8;');
        expect(sheet).toContain('--shape-corner: 4px;');
        expect(sheet).toContain('min-height: 40px; line-height: 19px;');
        expect(sheet).not.toMatch(/url\(|@import|https?:/i);
        expect(theme.css ?? '').not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });

    it('sets its faces in stacks the node serves', () => {
        expect(style.faces).toEqual({ headline: 'Hanken Grotesk', body: 'Hanken Grotesk', mono: 'JetBrains Mono' });
        for (const face of ['Hanken Grotesk', 'JetBrains Mono']) {
            expect(THEME_FACES[face], face).toBeDefined();
            expect(SERVED_FONT_FAMILIES, face).toContain(face);
        }
    });
});

describe('Selkeä in the theme service', () => {
    it('is listed after Tiilitaivas, read only, and not offered on a node with no list of its own', async () => {
        const svc = service();
        const all = await svc.listAll();
        expect(all.map((t) => t.id).slice(0, 3)).toEqual(['aimeat', 'tiilitaivas', SELKEA_ID]);
        expect((await svc.get(SELKEA_ID))?.builtin).toBe(true);
        await expect(svc.update(SELKEA_ID, { name: 'Mine' }, 'op')).rejects.toMatchObject({ code: 'READ_ONLY' });
        expect(svc.policyFrom(all).offered).toEqual(['aimeat', 'tiilitaivas']);
    });

    it('is offered when the operator lists it, and may be the default', async () => {
        const svc = new ThemeService({ nodeId: NODE, themesOffered: `aimeat,${SELKEA_ID}`, themesDefault: SELKEA_ID } as unknown as AimeatConfig, memoryStorage());
        const policy = svc.policyFrom(await svc.listAll());
        expect(policy.offered).toEqual(['aimeat', SELKEA_ID]);
        expect(policy.default).toBe(SELKEA_ID);
    });

    it('reserves its id and its name: a theme named "selkea" gets another id, one named "Selkeä" is refused', async () => {
        const svc = service();
        const made = await svc.create({ name: 'selkea' }, 'op');
        expect(made.theme.id).not.toBe(SELKEA_ID);
        expect((await svc.get(SELKEA_ID))?.builtin).toBe(true);
        await expect(svc.create({ name: 'Selkeä' }, 'op')).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    });

    it('can be copied, and the copy is the operator\'s own', async () => {
        const svc = service();
        const { theme } = await svc.create({ name: 'Oma selkeä', basedOn: SELKEA_ID }, 'op');
        expect(theme.builtin).toBe(false);
        expect(theme.basedOn).toBe(SELKEA_ID);
        expect(theme.styles[0].id).not.toBe(SELKEA_ID);
        expect(theme.styles[0].onlyMode).toBe('light');
        expect(theme.shapes?.['--shape-corner']).toBe('4px');
    });

    it('gives way to a custom record a node saved under its id before it shipped', async () => {
        const storage = memoryStorage();
        const own = { ...selkeaTheme(), name: 'Our own', builtin: false };
        await storage.setMemory({ key: THEME_KEY_PREFIX + SELKEA_ID, ownerGaii: `system@${NODE}`, value: own } as any);
        const svc = new ThemeService({ nodeId: NODE } as unknown as AimeatConfig, storage);
        const listed = (await svc.listAll()).filter((t) => t.id === SELKEA_ID);
        expect(listed).toHaveLength(1);
        expect(listed[0].name).toBe('Our own');
        expect((await svc.get(SELKEA_ID))?.builtin).toBe(false);
    });
});
