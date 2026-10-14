/**
 * @file test/unit/places-index.test.ts
 * @description The index of places (public/data/places.json) against the menus it describes, and the
 *   menu find's matching (public/js/menu-find.js). The index is a second copy of the menus' order and
 *   names, read by the menu find and by an AI (services/places.ts); these tests make a menu change
 *   that forgets the index fail, and a section anchor that was renamed fail, instead of a search that
 *   quietly stops finding a place.
 * @version-history v1.0.0 -- 2026-10-14 -- Initial (wish-pikahaku-settings-controls-ja-admin-sivuille).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findInMenu, foldText, cutLabel } from '../../public/js/menu-find.js';
import { placesPiece, placesPieceIds, placesParts } from '../../src/services/places.js';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const INDEX = JSON.parse(read('public/data/places.json'));
const EN = JSON.parse(read('locales/en.json'));

function lookUp(key: string): string | undefined {
    if (typeof EN[key] === 'string') return EN[key];
    let cur: unknown = EN;
    for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
    return typeof cur === 'string' ? cur : undefined;
}

/** The menu's items in order, read from its source: [id, labelKey] per item, the group's key first. */
function menuFromSource(src: string, start: string, end: string, item: RegExp, group: RegExp) {
    const body = src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
    const groups: Array<{ titleKey: string; items: Array<[string, string]> }> = [];
    for (const line of body.split('\n')) {
        const g = line.match(group);
        if (g) groups.push({ titleKey: g[1]!, items: [] });
        const it = line.match(item);
        if (it && groups.length) groups[groups.length - 1]!.items.push([it[1]!, it[2]!]);
    }
    return groups;
}

const indexOf = (side: 'settings' | 'admin') =>
    INDEX[side].groups.map((g: { titleKey: string; items: Array<{ id: string; labelKey: string }> }) =>
        ({ titleKey: g.titleKey, items: g.items.map(i => [i.id, i.labelKey]) }));

describe('the index follows the menus', () => {
    it('Settings & Controls: the same groups, places, order and names as SIDEBAR_GROUPS', () => {
        const menu = menuFromSource(read('public/views/profile/landing-page.cards.js'), 'export const SIDEBAR_GROUPS', '\n];',
            /\{ id: '([^']+)', labelKey: '([^']+)' \}/, /titleKey: '([^']+)'/);
        expect(menu.length).toBeGreaterThan(5);
        expect(indexOf('settings')).toEqual(menu);
    });

    it('admin: the same groups, pages, order and names as NAV_GROUPS', () => {
        const menu = menuFromSource(read('public/views/admin.js'), 'const NAV_GROUPS', '\n];',
            /\{ id: '([^']+)',\s+key: '([^']+)'/, /\{ key: '(dashboard\.nav[A-Za-z]+)', items/);
        expect(menu.length).toBeGreaterThan(5);
        expect(indexOf('admin')).toEqual(menu);
    });

    it('every name, group title and section name is a key English has', () => {
        const keys: string[] = [];
        for (const side of ['settings', 'admin'] as const) {
            for (const g of [{ titleKey: '', items: INDEX[side].top || [] }, ...INDEX[side].groups]) {
                if (g.titleKey) keys.push(g.titleKey);
                for (const p of g.items) {
                    keys.push(p.labelKey);
                    for (const s of p.sections || []) keys.push(s.labelKey);
                }
            }
        }
        expect(keys.filter(k => lookUp(k) === undefined)).toEqual([]);
    });

    it('every section anchor exists in a page under public/views/profile', () => {
        const files: string[] = [];
        const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
        walk(join(ROOT, 'public/views/profile'));
        const source = files.map(f => readFileSync(f, 'utf8')).join('\n');
        const anchors = INDEX.settings.groups.flatMap((g: { items: Array<{ sections?: Array<{ id: string }> }> }) =>
            g.items.flatMap(p => (p.sections || []).map(s => s.id)));
        expect(anchors.length).toBeGreaterThan(100);
        const missing = anchors.filter((id: string) => !source.includes(`id: '${id}'`) && !source.includes(`id="${id}"`));
        expect(missing).toEqual([]);
    });

    it('every place word key in English names a place the index has', () => {
        const ids = new Set<string>();
        for (const side of ['settings', 'admin'] as const) {
            for (const g of [{ items: INDEX[side].top || [] }, ...INDEX[side].groups]) for (const p of g.items) ids.add(`${side}.${p.id}`);
        }
        const strays = Object.keys(EN).filter(k => k.startsWith('places.kw.')).map(k => k.slice('places.kw.'.length)).filter(k => !ids.has(k));
        expect(strays).toEqual([]);
    });
});

const MENU = [
    { key: 'auto', title: 'Automation', items: [
        { id: 'fleet', label: 'Agent status', words: ['running agents'] },
        { id: 'agents', label: 'Agents', words: ['bots'], sections: [
            { id: 'agp-new', num: '03', label: 'An agent of your own' },
            { id: 'agp-connect', num: '04', label: 'Connect the AI you already use' },
        ] },
        { id: 'mcp', label: 'Connect your AI', words: ['MCP', 'Claude'], hidden: true },
    ] },
    { key: 'acct', title: 'Account', items: [{ id: 'wallet', label: 'Wallet', words: ['morsels'] }] },
];

describe('the menu find', () => {
    it('keeps the menu order, lists matching sections under their page, and chooses the name the words fit best', () => {
        const found = findInMenu(MENU, 'agent');
        expect(found.rows.map(r => r.label)).toEqual(['Agent status', 'Agents', 'An agent of your own']);
        expect(found.rows[found.best]!.label).toBe('Agents');
        expect(found.rows[2]!.kind).toBe('section');
        expect(found.places).toBe(2);
        expect(found.sections).toBe(1);
        expect(found.rows[1]!.cut).toMatchObject({ before: '', hit: 'Agent', after: 's' });
    });

    it('finds a place by another word and says which word, and counts the places the short menu hides', () => {
        const found = findInMenu(MENU, 'claude');
        expect(found.rows.map(r => [r.label, r.via])).toEqual([['Connect your AI', 'Claude']]);
        expect(found.hidden).toBe(1);
    });

    it('a group name brings every place in it', () => {
        expect(findInMenu(MENU, 'account').rows.map(r => r.label)).toEqual(['Wallet']);
    });

    it('a letter matches its plain form, and the underlined part is the text as written', () => {
        expect(foldText('Näkymä')).toBe('nakyma');
        expect(cutLabel('Ajastin ja näkymä', 'nakym')).toMatchObject({ before: 'Ajastin ja ', hit: 'näkym', after: 'ä' });
        const fi = [{ key: 'g', title: 'Tili', items: [{ id: 'dataWallet', label: 'Tietolompakko', words: ['tietosuoja'] }] }];
        expect(findInMenu(fi, 'TIETOSUOJA').rows[0]!.via).toBe('tietosuoja');
    });

    it('the other side comes last under its own title, and its sections are not searched', () => {
        const other = [{ key: 'adm', title: 'Identity', items: [{ id: 'agents', label: 'Agents', sections: [{ id: 'x', label: 'Agent roster' }] }] }];
        const found = findInMenu(MENU, 'agent', { other, otherTitle: 'On the operator side' });
        const last = found.groups[found.groups.length - 1]!;
        expect(last).toMatchObject({ other: true, title: 'On the operator side' });
        expect(last.rows.map(r => r.label)).toEqual(['Agents']);
    });

    it('past the most sections one place shows, one row says how many more there are', () => {
        const many = [{ key: 'n', title: 'Node', items: [{ id: 'config', label: 'Config', sections:
            Array.from({ length: 12 }, (_, i) => ({ id: `email.k${i}`, label: `Email setting ${i}` })) }] }];
        const found = findInMenu(many, 'email', { maxSections: 5 });
        expect(found.rows.filter(r => r.kind === 'section')).toHaveLength(5);
        expect(found.rows[found.rows.length - 1]).toMatchObject({ kind: 'more', more: 7 });
        expect(found.sections).toBe(12);
    });

    it('nothing typed, nothing found: no rows and no choice', () => {
        expect(findInMenu(MENU, '   ').rows).toEqual([]);
        const none = findInMenu(MENU, 'vpn');
        expect(none.rows).toEqual([]);
        expect(none.best).toBe(-1);
    });
});

describe('the list of places for an AI', () => {
    it('has two parts, each with links on the node\'s own address and under one tool result', () => {
        expect(placesPieceIds()).toEqual(['start', 'admin']);
        const start = placesPiece('start', 'https://node.example/')!.text;
        expect(start).toContain('https://node.example/v1/profile?tab=scheduler');
        expect(start).toContain('`section=sc-all`');
        expect(start).toContain('(only the operator of this AIMEAT)');
        expect(placesPiece('admin', 'https://node.example')!.text).toContain('https://node.example/v1/admin?tab=themes');
        for (const p of placesParts('https://node.example')) expect(p.chars).toBeLessThan(20_000);
        expect(placesPiece('nowhere', 'https://node.example')).toBeNull();
        for (const inherited of ['constructor', '__proto__', 'toString']) expect(placesPiece(inherited, 'https://node.example')).toBeNull();
    });
});
