/**
 * @file scripts/inventory/build-cycles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the 295 import cycles actually are: a few big knots, or many small ones.
 *
 *   WHY THE REPORTED NUMBER DOES NOT ANSWER THAT. dependency-cruiser reports one violation per module
 *   that sits on a cycle, so a single knot of sixteen modules can report sixteen times and a repo with
 *   295 reported cycles may hold a dozen real ones. The question a person needs answered before
 *   deciding whether this is a project or an afternoon is how many INDEPENDENT knots there are and how
 *   big the largest is — which is the strongly-connected components of the import graph, not a count
 *   of violations.
 *
 *   Tarjan's algorithm, iterative because the graph is deep enough to blow a recursive stack. Every
 *   component with more than one module is a knot: every module in it can reach every other, so none
 *   of them can be understood, tested or moved without the rest.
 *
 *   A SELF-LOOP IS NOT A KNOT and is not counted: a module importing itself is a typo or a re-export,
 *   and lumping it in would flatter the count.
 * @structure
 *   - readGraph(): dependency-cruiser's JSON → adjacency
 *   - components(): Tarjan, iterative
 *   - main(): counts, the knots by size, the largest one as mermaid → secaudit/cycles.md
 * @usage
 *   cd aimeat && pnpm audit:cycles          # writes secaudit/cycles.{md,json}
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, the day dependency-cruiser first made the cycles visible.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..', '..');
const OUT_DIR = join(resolve(AIMEAT, '..'), 'secaudit');

interface DcModule { source: string; dependencies: { resolved: string }[] }

function readGraph(): Map<string, string[]> {
    const bin = join(AIMEAT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
    const out = execFileSync(process.execPath, [bin, 'src', '--config', '.dependency-cruiser.cjs', '--output-type', 'json'], {
        cwd: AIMEAT, encoding: 'utf-8', maxBuffer: 1 << 28,
    });
    const parsed = JSON.parse(out) as { modules: DcModule[] };
    const graph = new Map<string, string[]>();
    for (const m of parsed.modules) graph.set(m.source, m.dependencies.map(d => d.resolved));
    return graph;
}

/**
 * Tarjan's strongly-connected components, iterative.
 *
 * Written out rather than pulled in: it is thirty lines, and a dependency added to read a dependency
 * graph is a joke this repo would have to keep.
 */
export function components(graph: Map<string, string[]>): string[][] {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const found: string[][] = [];
    let counter = 0;

    for (const root of graph.keys()) {
        if (index.has(root)) continue;
        // Each frame is a node plus how far through its edge list we are.
        const work: { node: string; edge: number }[] = [{ node: root, edge: 0 }];
        index.set(root, counter); low.set(root, counter); counter += 1;
        stack.push(root); onStack.add(root);

        while (work.length > 0) {
            const frame = work[work.length - 1];
            const edges = graph.get(frame.node) ?? [];
            if (frame.edge < edges.length) {
                const next = edges[frame.edge];
                frame.edge += 1;
                if (!graph.has(next)) continue;          // outside the cruise (node_modules, missing)
                if (!index.has(next)) {
                    index.set(next, counter); low.set(next, counter); counter += 1;
                    stack.push(next); onStack.add(next);
                    work.push({ node: next, edge: 0 });
                } else if (onStack.has(next)) {
                    low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
                }
                continue;
            }
            work.pop();
            if (work.length > 0) {
                const parent = work[work.length - 1].node;
                low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
            }
            if (low.get(frame.node) === index.get(frame.node)) {
                const group: string[] = [];
                for (;;) {
                    const popped = stack.pop() as string;
                    onStack.delete(popped);
                    group.push(popped);
                    if (popped === frame.node) break;
                }
                if (group.length > 1) found.push(group.sort());
            }
        }
    }
    return found.sort((a, b) => b.length - a.length);
}

/** `src/services/foo.ts` → `services/foo`, short enough to read in a diagram. */
const short = (p: string): string => p.replace(/^src\//, '').replace(/\.ts$/, '');

/**
 * A mermaid-safe node id, and a UNIQUE one.
 *
 * The first version hashed the name and cut the hex to twelve characters, which is six characters of
 * the original: every `services/…` bucket became the same node and the diagram drew one box with
 * forty labels. Counted ids cannot collide, and nothing about the id needs to be derivable.
 */
const ids = new Map<string, string>();
function id(name: string): string {
    if (!ids.has(name)) ids.set(name, `n${ids.size}`);
    return ids.get(name) as string;
}

/** The group a module is drawn as: its directory, `depth` levels deep. */
function bucketOf(path: string, depth: number): string {
    return short(path).split('/').slice(0, depth).join('/');
}

/**
 * How deep to collapse a knot before drawing it.
 *
 * One level turns a knot that lives entirely inside `storage` into a single box, and three levels
 * turns a knot spanning mcp, routes and services into forty. So try the shallowest depth that gives
 * something worth looking at — more than two boxes and not more than a dozen.
 */
function collapseDepth(group: string[]): number {
    for (const depth of [1, 2, 3, 4]) {
        const distinct = new Set(group.map(m => bucketOf(m, depth))).size;
        if (distinct > 2 && distinct <= 12) return depth;
    }
    // Nothing between three boxes and a dozen at any depth: the knot lives inside one directory that
    // never branches (both storage providers are shaped that way). Take the deepest, which at least
    // separates methods from repos, rather than drawing one box with the knot's own name in it.
    return 4;
}

/**
 * The knot as a mermaid graph, with only the edges that stay inside it.
 *
 * A knot of ninety-eight files drawn file by file is a hairball nobody can read, so past a threshold
 * the nodes become directories and the edge labels become counts. What a person needs from the
 * picture is which parts of the tree are tied together and how tightly, not which line does it.
 */
function diagram(group: string[], graph: Map<string, string[]>, collapse: boolean): string {
    const inside = new Set(group);
    const lines = ['```mermaid', 'flowchart LR'];

    if (!collapse) {
        for (const m of group) lines.push(`    ${id(m)}["${short(m)}"]`);
        for (const from of group) {
            for (const to of graph.get(from) ?? []) {
                if (inside.has(to) && to !== from) lines.push(`    ${id(from)} --> ${id(to)}`);
            }
        }
        lines.push('```');
        return lines.join('\n');
    }

    const depth = collapseDepth(group);
    const weight = new Map<string, number>();
    const buckets = new Map<string, number>();
    for (const from of group) {
        const a = bucketOf(from, depth);
        buckets.set(a, (buckets.get(a) ?? 0) + 1);
        for (const to of graph.get(from) ?? []) {
            if (!inside.has(to) || to === from) continue;
            const b = bucketOf(to, depth);
            if (a === b) continue;
            const key = `${a} ${b}`;
            weight.set(key, (weight.get(key) ?? 0) + 1);
        }
    }
    for (const [bucket, n] of [...buckets].sort((x, y) => y[1] - x[1])) {
        lines.push(`    ${id(bucket)}["${bucket}<br/>${n} tiedostoa"]`);
    }
    for (const [key, n] of [...weight].sort((x, y) => y[1] - x[1])) {
        const [a, b] = key.split(' ');
        lines.push(`    ${id(a)} -->|${n}| ${id(b)}`);
    }
    lines.push('```');
    return lines.join('\n');
}

/**
 * The layers, shallowest caller first. A surface (`mcp`, `routes`, `cli`) calls a service, a service
 * calls storage, and nothing calls back up. Anything outside this list has no layer and is skipped:
 * `utils` and `data` are leaves that everyone may reach.
 */
const LAYERS = ['mcp', 'routes', 'cli', 'commerce', 'services', 'storage'];

/**
 * The edges inside a knot that point AGAINST the layer order.
 *
 * This is the work list rather than a description. Knot 1 holds ninety-eight modules and 51 of its
 * cross-area edges run mcp → services, which is the right way round; what closes the loop is the
 * eight that run back up. A knot dissolves when the upward edges are gone, so these are the lines to
 * look at and the rest of the knot is a consequence.
 */
function upwardEdges(group: string[], graph: Map<string, string[]>): Array<[string, string]> {
    const inside = new Set(group);
    const rank = (p: string): number => LAYERS.indexOf(short(p).split('/')[0]);
    const out: Array<[string, string]> = [];
    for (const from of group) {
        const a = rank(from);
        if (a < 0) continue;
        for (const to of graph.get(from) ?? []) {
            if (!inside.has(to) || to === from) continue;
            const b = rank(to);
            if (b < 0 || b >= a) continue;
            out.push([short(from), short(to)]);
        }
    }
    return out.sort((x, y) => x[0].localeCompare(y[0]));
}

/** The edges inside a knot that cross from one top-level area to another, counted by direction. */
function crossings(group: string[], graph: Map<string, string[]>): Array<[string, number]> {
    const inside = new Set(group);
    const counts = new Map<string, number>();
    const area = (p: string): string => short(p).split('/')[0];
    for (const from of group) {
        for (const to of graph.get(from) ?? []) {
            if (!inside.has(to) || to === from) continue;
            if (area(from) === area(to)) continue;
            const key = `${area(from)} → ${area(to)}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
}

/** Which top-level areas a knot spans. A knot inside one directory is a local mess; one that spans
 *  routes, services and storage is the layering itself. */
const areasOf = (group: string[]): string[] =>
    [...new Set(group.map(m => m.replace(/^src\//, '').split('/')[0]))].sort();

function main(): void {
    const graph = readGraph();
    const knots = components(graph);
    const onAKnot = new Set(knots.flat());

    const lines: string[] = [];
    const say = (s = ''): void => { lines.push(s); };

    say('# Tuontikehät');
    say();
    say('Mitattu, ei arvioitu. `pnpm audit:cycles` kirjoittaa tämän uudelleen.');
    say();
    say('dependency-cruiser raportoi yhden rikkeen jokaisesta moduulista joka on kehällä, joten');
    say('295 riketta ei ole 295 kehää. Alla on solmujen määrä: vahvasti yhtenäiset komponentit,');
    say('eli joukot joissa jokainen moduuli tavoittaa jokaisen toisen.');
    say();
    say('| | |');
    say('|---|---|');
    say(`| moduuleja | ${graph.size} |`);
    say(`| erillisiä solmuja | **${knots.length}** |`);
    say(`| moduuleja solmuissa | ${onAKnot.size} |`);
    say(`| suurin solmu | ${knots[0]?.length ?? 0} moduulia |`);
    say();

    say('## Solmut kooltaan');
    say();
    say('| # | moduuleja | alueet | ensimmäinen jäsen |');
    say('|---|---|---|---|');
    knots.forEach((group, i) => {
        say(`| ${i + 1} | ${group.length} | ${areasOf(group).join(', ')} | \`${short(group[0])}\` |`);
    });
    say();

    for (const [i, group] of knots.slice(0, 5).entries()) {
        const collapse = group.length > 14;
        say(`## Solmu ${i + 1} — ${group.length} moduulia`);
        say();
        if (collapse) say('Hakemistotasolla, koska tiedosto kerrallaan tästä ei näkisi mitään. Kaaren luku on kaarien määrä.');
        say();
        say(diagram(group, graph, collapse));
        say();

        const cross = crossings(group, graph);
        if (cross.length > 0) {
            say('Kaaret jotka ylittävät alueen rajan — nämä tekevät solmusta muuta kuin paikallisen sotkun:');
            say();
            say('| suunta | kaaria |');
            say('|---|---|');
            for (const [dir, n] of cross) say(`| ${dir} | ${n} |`);
            say();
        }

        const upward = upwardEdges(group, graph);
        if (upward.length > 0) {
            say(`**Ylöspäin osoittavat tuonnit — ${upward.length} kappaletta.** Nämä sulkevat silmukan.`);
            say('Kerrosjärjestys on pinta (mcp, routes, cli) → palvelu → tallennus, eikä takaisin.');
            say();
            for (const [from, to] of upward) say(`- \`${from}\` → \`${to}\``);
            say();
        }

        if (!collapse) {
            say('Jäsenet:');
            say();
            for (const m of group) say(`- \`${short(m)}\``);
            say();
        }
    }

    say('## Loput solmut');
    say();
    for (const [i, group] of knots.entries()) {
        if (i < 5) continue;
        say(`**Solmu ${i + 1}** (${group.length}): ${group.map(m => `\`${short(m)}\``).join(' · ')}`);
        say();
    }

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'cycles.md'), lines.join('\n'), 'utf-8');
    writeFileSync(join(OUT_DIR, 'cycles.json'), JSON.stringify({ knots, generatedAt: new Date().toISOString() }, null, 2), 'utf-8');
    console.log(`✓ ${knots.length} solmua, suurin ${knots[0]?.length ?? 0} moduulia → secaudit/cycles.md`);
}

main();
