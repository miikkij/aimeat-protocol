/**
 * @file src/services/feature-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What this node can do, for an AI that already knows what the person needs: the
 *   Everything page (docs/AIMEAT-Feature-List.md, built into public/data/everything.json) served in
 *   parts over MCP and REST (guided journey P6, brief doc-mupor242l3cq).
 *
 *   WHY IN PARTS. The list has 24 areas and about 360 features, more than one tool result carries.
 *   Part `start` names the areas with their lead sentence and their part id; `g-<n>` is one area,
 *   every feature with what it gives and where it is reached. An area longer than one part
 *   continues in `g-<n>.2`, `g-<n>.3`, and each part names the next. The same split the build
 *   specification uses (aimeat_handbook_get { tier: "build-app/<id>" }).
 *
 *   WHEN TO READ IT. The conversation skills say: ask what the person is doing, then offer one
 *   thing. This is what the AI draws that one thing from once it knows the need; it is not a list to
 *   recite.
 * @structure featureMapPieceIds() · featureMapParts() · featureMapPiece(id)
 * @usage const piece = featureMapPiece('g-10'); piece?.text
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 *   v1.1.0 — 2026-10-10 — An area over 20 000 characters is split between features into
 *     `g-<n>`, `g-<n>.2`, … (Automation had reached 28 292 and no longer fit one tool result).
 */
import { readFileSync } from 'node:fs';

interface EverythingRow { slug: string; cells: string[] }
interface EverythingGroup { n: number; title: string; slug: string; lead: string[]; columns: string[]; rows: EverythingRow[] }
interface Everything { title: string; stamp: string; groups: EverythingGroup[] }

/** Read once at start, like the Everything page itself (utils/everything-page.ts). */
const EVERYTHING = JSON.parse(readFileSync(new URL('../../public/data/everything.json', import.meta.url), 'utf8')) as Everything;

/** A cell's HTML as plain text: tags dropped, the five entities a cell uses turned back. */
function plain(html: string): string {
    // Until nothing changes, so a tag split by another tag cannot survive one pass. The text goes to
    // an AI as Markdown, never into a page, and the source is this repository's own build output.
    let s = String(html ?? '');
    for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/<[^<>]*>/g, ''); }
    return s.replace(/&lt;/g, '‹').replace(/&gt;/g, '›').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
}

const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();

/**
 * The most characters one part carries. An area whose text is longer is served as consecutive
 * parts, `g-<n>`, `g-<n>.2`, `g-<n>.3`, split between features, so an area that grows never
 * stops fitting one tool result (an MCP client cuts a result near 25 000 characters).
 */
const PART_BUDGET = 20_000;

interface Page { id: string; group: EverythingGroup; text: string }

function rowText(r: EverythingRow): string {
    const [name, what, reach] = r.cells.map(plain);
    return `- **${name}**: ${what}${reach ? ` Reach: ${reach}` : ''}`;
}

/** One area as its parts: one part while it fits PART_BUDGET, more when it does not. */
function groupPages(g: EverythingGroup): Page[] {
    const lead = plain((g.lead ?? []).join(' '));
    const rows = g.rows.map(rowText);
    // Room for the heading and the closing "continues in" line, which are added after the split.
    const room = PART_BUDGET - 200;
    const chunks: string[][] = [[]];
    let size = lead.length;
    for (const row of rows) {
        const cur = chunks[chunks.length - 1]!;
        if (cur.length && size + row.length + 1 > room) { chunks.push([]); size = 0; }
        chunks[chunks.length - 1]!.push(row);
        size += row.length + 1;
    }
    const idOf = (i: number) => (i === 0 ? g.slug : `${g.slug}.${i + 1}`);
    return chunks.map((chunk, i) => {
        const many = chunks.length > 1;
        const head = many ? `# ${g.title} (part ${i + 1} of ${chunks.length})` : `# ${g.title}`;
        const body = i === 0 ? ['', lead, '', ...chunk] : ['', ...chunk];
        const next = i + 1 < chunks.length ? ['', `This area continues in \`features/${idOf(i + 1)}\`.`] : [];
        return { id: idOf(i), group: g, text: [head, ...body, ...next].join('\n') };
    });
}

let pagesCache: Page[] | null = null;
function allPages(): Page[] {
    return (pagesCache ??= EVERYTHING.groups.flatMap(groupPages));
}

export function featureMapPieceIds(): string[] {
    return ['start', ...allPages().map(p => p.id)];
}

function startText(): string {
    const lines = EVERYTHING.groups.map(g =>
        `- \`features/${g.slug}\` **${g.title}** (${g.rows.length}): ${firstSentence(plain((g.lead ?? []).join(' ')))}`);
    return [
        `# What this AIMEAT can do (${EVERYTHING.stamp})`,
        '',
        'Read this after you know what the person needs, and offer the one thing that fits. Do not recite it.',
        'Each area below is one part: ask for it with aimeat_handbook_get { tier: "features/<id>" }.',
        '',
        ...lines,
    ].join('\n');
}

/**
 * One part by id: `start` (the areas), `g-<n>` (one area, or its first part), or `g-<n>.<k>` (a
 * later part of a long area). Null for an id the map does not have.
 */
export function featureMapPiece(id: string): { id: string; text: string } | null {
    if (id === 'start') return { id, text: startText() };
    const page = allPages().find(p => p.id === id);
    return page ? { id, text: page.text } : null;
}

/** The parts with their size, for the listing route. */
export function featureMapParts(): Array<{ id: string; what: string; chars: number }> {
    return [
        { id: 'start', what: 'The areas, with their part ids', chars: startText().length },
        ...allPages().map(p => ({ id: p.id, what: p.group.title, chars: p.text.length })),
    ];
}
