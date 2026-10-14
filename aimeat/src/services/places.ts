/**
 * @file src/services/places.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where things are on this node's own pages, for an AI asked "where do I find X": every
 *   page of Settings & Controls with the sections inside it, and every admin page, each with its
 *   address, its name in the three languages and the other words a person may use for it. Read from
 *   public/data/places.json, the same index the menu find reads in the browser
 *   (public/components/MenuFind.js), so the menu and the AI cannot disagree on where a thing is.
 *   Served over MCP as aimeat_handbook_get { tier: "places" | "places/admin" } and over HTTP as
 *   GET /v1/prompts/places/sections[/:id].
 *
 *   TWO PARTS. `start` is Settings & Controls, which every signed-in owner has; `admin` is the
 *   operator's pages. Together they pass what one MCP result carries comfortably, and most questions
 *   are about the first.
 * @structure placesPieceIds() · placesParts(baseUrl) · placesPiece(id, baseUrl)
 * @usage const piece = placesPiece('start', config.baseUrl); piece?.text
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-pikahaku-settings-controls-ja-admin-sivuille).
 */
import { readFileSync } from 'node:fs';
import { createT } from '../i18n.js';

interface PlaceSection { id: string; num?: string; labelKey: string }
interface Place { id: string; labelKey: string; sections?: PlaceSection[] }
interface PlaceGroup { titleKey: string; operator?: boolean; items: Place[] }
interface PlaceSide { path: string; top?: Place[]; groups: PlaceGroup[] }
interface PlacesIndex { settings: PlaceSide; admin: PlaceSide }

/** Read once at start, like the feature map (services/feature-map.ts). */
const INDEX = JSON.parse(readFileSync(new URL('../../public/data/places.json', import.meta.url), 'utf8')) as PlacesIndex;

const en = createT('en');
const fi = createT('fi');
const es = createT('es');

/** A place's name in English, with the Finnish and Spanish names when they differ. */
function names(key: string): string {
    const e = en(key);
    const others = [['fi', fi(key)], ['es', es(key)]].filter(([, v]) => v && v !== key && v !== e).map(([l, v]) => `${l}: ${v}`);
    return others.length ? `**${e}** (${others.join(', ')})` : `**${e}**`;
}

/** The other words a place is found by, in English. */
function words(side: string, id: string): string {
    const key = `places.kw.${side}.${id}`;
    const v = en(key);
    return v && v !== key ? ` (also: ${v})` : '';
}

function placeLines(side: 'settings' | 'admin', place: Place, base: string): string[] {
    const url = `${base}${INDEX[side].path}?tab=${encodeURIComponent(place.id)}`;
    const lines = [`- ${names(place.labelKey)}: ${url}${words(side, place.id)}`];
    for (const s of place.sections || []) {
        lines.push(`  - ${s.num ? s.num + ' ' : ''}${en(s.labelKey)}: \`section=${s.id}\``);
    }
    return lines;
}

function sideText(side: 'settings' | 'admin', base: string): string {
    const s = INDEX[side];
    const groups = [...(s.top?.length ? [{ titleKey: '', items: s.top }] : []), ...s.groups];
    const out: string[] = [];
    for (const g of groups) {
        if (g.titleKey) out.push('', `## ${en(g.titleKey)}${g.operator ? ' (only the operator of this AIMEAT)' : ''}`);
        for (const p of g.items) out.push(...placeLines(side, p, base));
    }
    return out.join('\n');
}

function startText(base: string): string {
    return [
        '# Where things are: Settings & Controls',
        '',
        'When the person asks where something is on this AIMEAT\'s own pages, answer with the link to the place. Name the place in the person\'s language: the Finnish and Spanish names follow the English one, and the menu shows the name in the language the person chose.',
        `A section of a page has its own link: add \`&section=<id>\` to the page's link (${base}/v1/profile?tab=agents&section=agp-connect opens the Agents page at "Connect the AI you already use").`,
        'Every signed-in owner has these pages. The admin pages, which only the operator of this AIMEAT opens, are the part `places/admin`.',
        'On the page itself, the field "Find a place" at the top of the menu finds the same places by name or by another word; the / key moves into it.',
        sideText('settings', base),
    ].join('\n');
}

function adminText(base: string): string {
    return [
        '# Where things are: the admin pages',
        '',
        'Only the operator of this AIMEAT opens these pages. Answer with the link to the page.',
        `A setting on the Config page has its own link: ${base}/v1/admin?tab=config&q=<setting key> opens the page searched for it (for example q=email.smtp_host). The keys are listed by aimeat_admin_config.`,
        'On the page itself, the field "Find a page" at the top of the operator menu finds the pages and the Config settings by name, key or another word.',
        sideText('admin', base),
    ].join('\n');
}

const PIECES: Record<string, { what: string; text: (base: string) => string }> = {
    start: { what: 'Settings & Controls, every page and its sections', text: startText },
    admin: { what: 'The admin pages (the operator of this AIMEAT only)', text: adminText },
};

export function placesPieceIds(): string[] {
    return Object.keys(PIECES);
}

/** One part by id (`start` or `admin`), with the node's own address in every link; null for any other id. */
export function placesPiece(id: string, baseUrl: string): { id: string; text: string } | null {
    // Own keys only: "constructor" or "__proto__" in a URL must answer not found, not reach Object's.
    const piece = Object.hasOwn(PIECES, id) ? PIECES[id] : undefined;
    return piece ? { id, text: piece.text(String(baseUrl || '').replace(/\/+$/, '')) } : null;
}

/** The parts with their size, for the listing route. */
export function placesParts(baseUrl: string): Array<{ id: string; what: string; chars: number }> {
    return placesPieceIds().map(id => ({ id, what: PIECES[id]!.what, chars: placesPiece(id, baseUrl)!.text.length }));
}
