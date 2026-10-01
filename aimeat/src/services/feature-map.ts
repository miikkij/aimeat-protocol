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
 *   every feature with what it gives and where it is reached. The same split the build
 *   specification uses (aimeat_handbook_get { tier: "build-app/<id>" }).
 *
 *   WHEN TO READ IT. The conversation skills say: ask what the person is doing, then offer one
 *   thing. This is what the AI draws that one thing from once it knows the need; it is not a list to
 *   recite.
 * @structure featureMapPieceIds() · featureMapParts() · featureMapPiece(id)
 * @usage const piece = featureMapPiece('g-10'); piece?.text
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
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

export function featureMapPieceIds(): string[] {
    return ['start', ...EVERYTHING.groups.map(g => g.slug)];
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

function groupText(g: EverythingGroup): string {
    const rows = g.rows.map(r => {
        const [name, what, reach] = r.cells.map(plain);
        return `- **${name}**: ${what}${reach ? ` Reach: ${reach}` : ''}`;
    });
    return [`# ${g.title}`, '', plain((g.lead ?? []).join(' ')), '', ...rows].join('\n');
}

/** One part by id: `start` (the areas), or `g-<n>` (one area). Null for an id the map does not have. */
export function featureMapPiece(id: string): { id: string; text: string } | null {
    if (id === 'start') return { id, text: startText() };
    const g = EVERYTHING.groups.find(x => x.slug === id);
    return g ? { id, text: groupText(g) } : null;
}

/** The parts with their size, for the listing route. */
export function featureMapParts(): Array<{ id: string; what: string; chars: number }> {
    return featureMapPieceIds().map(id => {
        const g = EVERYTHING.groups.find(x => x.slug === id);
        return { id, what: g ? g.title : 'The areas, with their part ids', chars: featureMapPiece(id)?.text.length ?? 0 };
    });
}
