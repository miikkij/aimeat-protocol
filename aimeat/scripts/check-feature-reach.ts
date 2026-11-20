/**
 * @file check-feature-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every capability the node offers is named in docs/AIMEAT-Feature-List.md: each MCP
 *   tool of the catalogue, each served library and cortex of the library-pack registry, and each
 *   package the node seeds. The list is what an AI reads to know what this node can do
 *   (`aimeat_handbook_get { tier: "features" }`, /v1/everything), so a capability missing from it is
 *   one no AI offers a person.
 *
 *   WHY. Jouni, 2026-11-20: the lists must update themselves from the tools, and whoever builds a
 *   capability into the platform marks it through one system that gathers what we have in one place,
 *   so the app-building guidance and the new entry take it into account. The feature list was that
 *   place already, with 522 rows; nothing held a new tool or library to it, and on that day 12 tools
 *   and 23 served libraries were named nowhere in it. feature-documentation.md row 5 said "never
 *   skipped" and had no gate that noticed a skip.
 *
 *   WHAT COUNTS AS NAMED. A tool: its exact name, or a family written `aimeat_<prefix>_*` whose
 *   prefix it starts with. A library: `<id>` in backticks, its served path `/v1/libs/<id>`, or for an
 *   `aimeat-<x>` library its global `AIMEAT.<x>`. A package: its name in backticks. A text match, so
 *   a name in the wrong row passes; the row is the writer's to get right.
 *
 *   NOT A RATCHET. Every gap found on the first day was written into the list in the same change, so
 *   the gate holds the whole set from the start. A capability that is truly not one a person or an
 *   AI should be offered goes in security/feature-reach-exemptions.json with its reason; an entry
 *   whose name is no longer offered, or is now in the list, fails until it is deleted.
 * @structure toolNames() · libraryIds() · packageNames() · missing() · main: check | --list
 * @usage
 *   pnpm check:feature-reach            # gate (check:fast, CI)
 *   pnpm check:feature-reach --list     # every capability and whether the list names it
 * @version-history
 *   v1.0.0 -- 2026-11-20 -- Initial (feature-documentation.md row 5; the capability list read from the node).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLibraryPacks } from '../src/data/library-packs.js';

const here = dirname(fileURLToPath(import.meta.url));
const AIMEAT = join(here, '..');
const REPO = join(AIMEAT, '..');
const DOC = join(REPO, 'docs', 'AIMEAT-Feature-List.md');
const EXEMPTIONS = join(AIMEAT, 'security', 'feature-reach-exemptions.json');

type Kind = 'tool' | 'library' | 'package';
interface Capability { kind: Kind; name: string; source: string }

/** Every MCP tool name the catalogue defines. */
function toolNames(): Capability[] {
    const dir = join(AIMEAT, 'src', 'tool-catalog', 'definitions');
    const out = new Map<string, Capability>();
    for (const f of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
        const text = readFileSync(join(dir, f), 'utf8');
        for (const m of text.matchAll(/name:\s*'(aimeat_[a-z0-9_]+)'/g)) {
            out.set(m[1], { kind: 'tool', name: m[1], source: `src/tool-catalog/definitions/${f}` });
        }
    }
    return [...out.values()];
}

/** Every served library and cortex of the library-pack registry. */
function libraryIds(): Capability[] {
    return getLibraryPacks().map(p => ({ kind: 'library' as const, name: p.id, source: `src/data/library-packs (${p.kind})` }));
}

/** Every package the node seeds (src/data/*-package.ts). */
function packageNames(): Capability[] {
    const dir = join(AIMEAT, 'src', 'data');
    const out: Capability[] = [];
    for (const f of readdirSync(dir).filter(n => n.endsWith('-package.ts'))) {
        const m = readFileSync(join(dir, f), 'utf8').match(/\bname:\s*'([a-z0-9-]+)'/);
        if (m) out.push({ kind: 'package', name: m[1], source: `src/data/${f}` });
    }
    return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is `cap` named in the list's text? */
function named(cap: Capability, doc: string, families: string[]): boolean {
    if (cap.kind === 'tool') {
        if (new RegExp(`\\b${escape(cap.name)}\\b(?!_)`).test(doc)) return true;
        return families.some(prefix => cap.name.startsWith(prefix));
    }
    if (doc.includes(`\`${cap.name}\``)) return true;
    if (cap.kind === 'library') {
        if (new RegExp(`/v1/libs/${escape(cap.name)}(?![a-z0-9-])`).test(doc)) return true;
        const short = cap.name.startsWith('aimeat-') ? cap.name.slice('aimeat-'.length) : null;
        if (short && new RegExp(`AIMEAT\\.${escape(short)}\\b`).test(doc)) return true;
    }
    return false;
}

function readExemptions(): Record<string, string> {
    if (!existsSync(EXEMPTIONS)) return {};
    const raw = JSON.parse(readFileSync(EXEMPTIONS, 'utf8')) as { exempt?: Record<string, string> };
    return raw.exempt ?? {};
}

function main(): void {
    const doc = readFileSync(DOC, 'utf8');
    // A family is written `aimeat_<prefix>_*`; it names every tool starting with `aimeat_<prefix>_`.
    const families = [...doc.matchAll(/\b(aimeat_[a-z0-9_]+_)\*/g)].map(m => m[1]);
    const all = [...toolNames(), ...libraryIds(), ...packageNames()];
    const exempt = readExemptions();
    const keyOf = (c: Capability) => `${c.kind}:${c.name}`;

    if (process.argv.includes('--list')) {
        for (const c of all) console.log(`${named(c, doc, families) ? '✓' : exempt[keyOf(c)] ? '–' : '✗'} ${keyOf(c)}  (${c.source})`);
        return;
    }

    const missing = all.filter(c => !named(c, doc, families) && !exempt[keyOf(c)]);
    const offered = new Set(all.map(keyOf));
    const stale = Object.keys(exempt).filter(k => !offered.has(k) || all.some(c => keyOf(c) === k && named(c, doc, families)));

    const counts = (k: Kind) => all.filter(c => c.kind === k).length;
    console.log('\n  Every capability the node offers, named in the feature list');
    console.log('  ──────────────────────────────────────────────────────────────');
    console.log(`  MCP tools          ${String(counts('tool')).padStart(4)}`);
    console.log(`  served libraries   ${String(counts('library')).padStart(4)}   (sdk, cortex, vendored and bundle packs)`);
    console.log(`  seeded packages    ${String(counts('package')).padStart(4)}`);
    console.log(`  exempt             ${String(Object.keys(exempt).length).padStart(4)}   (security/feature-reach-exemptions.json, a reason each)`);

    if (missing.length === 0 && stale.length === 0) {
        console.log('\n  ✓ docs/AIMEAT-Feature-List.md names every tool, library and package the node offers\n');
        return;
    }
    if (missing.length) {
        console.log(`\n  ✗ ${missing.length} capability(ies) the feature list does not name:`);
        for (const c of missing) console.log(`      ${keyOf(c)}  (${c.source})`);
        console.log('\n  Add each to the row of docs/AIMEAT-Feature-List.md that describes it (its Reach column: the tool\'s name,');
        console.log('  the library as `<id>` or /v1/libs/<id>, the package as `<name>`), then pnpm build:everything.');
        console.log('  A capability no person or AI should be offered goes in security/feature-reach-exemptions.json with its reason.');
    }
    if (stale.length) {
        console.log(`\n  ✗ ${stale.length} exemption(s) no longer true (the name is gone, or the list names it now); delete them:`);
        for (const k of stale) console.log(`      ${k}`);
    }
    console.log('');
    process.exit(1);
}

main();
