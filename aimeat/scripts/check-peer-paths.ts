/**
 * @file scripts/check-peer-paths.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every code path that writes a federation peer, and every one that trusts a peer's url or
 *   key, is listed with the reason it is right.
 *
 *   WHY. On 2026-09-28 three package routes were given a way to write a peer, and nobody reading them
 *   asked what else trusts a peer: direct messages went to its url and federated sign-in verified its
 *   key, so any owner could register a node id that was not theirs and sign in as its users (the
 *   peer-registration incident, 2026-10-01; docs/pitfalls.md §103). A sweep that day found five more
 *   defects of the same kind in the federation routes. The knowledge to see it was in the code; what
 *   was missing was a place that asks, for each new writer and each new reader, on what proof.
 *
 *   WHAT IT COUNTS, per file under src/ (storage, static and generated excluded; comments stripped):
 *   - writers: calls of saveFederationPeer(;
 *   - readers: `<name with peer in it>.url` and `.publicKey`, the shape every reader in the tree has.
 *   A file that is new to either list, or whose count grew, fails. A count that fell is reported, and
 *   --seed lowers it. The reasons live in security/peer-paths.json; a seeded entry reads UNREVIEWED.
 * @structure countPaths() · main()
 * @usage
 *   cd aimeat && pnpm check:peer-paths            # the gate (--strict)
 *   cd aimeat && pnpm exec tsx scripts/check-peer-paths.ts --seed   # write today's counts, keep reasons
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (follow-up to the peer-registration incident, item 3).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const LEDGER = join(ROOT, 'security', 'peer-paths.json');
const UNREVIEWED = 'UNREVIEWED: say on what proof this path trusts or writes the peer, or fix it.';

interface Entry { count: number; why: string }
interface Ledger { about: string; writers: Record<string, Entry>; readers: Record<string, Entry> }

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'static' || entry === 'generated' || entry === 'storage') continue;
            walk(full, out);
        } else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** Line comments, one-line block comments and JSDoc lines are prose, not code. */
function codeOf(line: string): string {
    return line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\*.*$/, '').split('//')[0];
}

const WRITER = /\bsaveFederationPeer\s*\(/g;
const READER = /\b[A-Za-z]*[pP]eer[A-Za-z]*!?\.(?:url|publicKey)\b/g;

export function countPaths(files: string[]): { writers: Map<string, number>; readers: Map<string, number> } {
    const writers = new Map<string, number>();
    const readers = new Map<string, number>();
    for (const file of files) {
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        let w = 0;
        let r = 0;
        for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
            const code = codeOf(line);
            if (!code.trim()) continue;
            w += [...code.matchAll(WRITER)].length;
            r += [...code.matchAll(READER)].length;
        }
        if (w) writers.set(rel, w);
        if (r) readers.set(rel, r);
    }
    return { writers, readers };
}

function compare(kind: string, now: Map<string, number>, listed: Record<string, Entry>): { fresh: string[]; fell: string[] } {
    const fresh: string[] = [];
    const fell: string[] = [];
    for (const [file, count] of now) {
        const e = listed[file];
        if (!e) fresh.push(`${kind} ${file}: ${count}, not listed`);
        else if (count > e.count) fresh.push(`${kind} ${file}: ${count}, listed ${e.count}`);
        else if (count < e.count) fell.push(`${kind} ${file}: ${count}, listed ${e.count}`);
    }
    for (const file of Object.keys(listed)) if (!now.has(file)) fell.push(`${kind} ${file}: gone`);
    return { fresh, fell };
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');
    const now = countPaths(walk(SRC));
    const ledger: Ledger = existsSync(LEDGER)
        ? JSON.parse(readFileSync(LEDGER, 'utf-8')) as Ledger
        : { about: '', writers: {}, readers: {} };

    if (seed) {
        const keep = (m: Map<string, number>, old: Record<string, Entry>) =>
            Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)).map(([f, c]) => [f, { count: c, why: old[f]?.why ?? UNREVIEWED }]));
        writeFileSync(LEDGER, JSON.stringify({ ...ledger, writers: keep(now.writers, ledger.writers), readers: keep(now.readers, ledger.readers) }, null, 2) + '\n');
        console.log(`Seeded ${now.writers.size} writer and ${now.readers.size} reader files into ${relative(ROOT, LEDGER)}`);
        return;
    }

    const w = compare('writer', now.writers, ledger.writers);
    const r = compare('reader', now.readers, ledger.readers);
    const fresh = [...w.fresh, ...r.fresh];
    const fell = [...w.fell, ...r.fell];
    const open = [...Object.values(ledger.writers), ...Object.values(ledger.readers)].filter(e => e.why.startsWith('UNREVIEWED')).length;

    console.log('');
    console.log('  Federation peer paths: who writes a peer, who trusts its url or key');
    console.log('  ' + '─'.repeat(62));
    console.log(`  files writing a peer        ${String(now.writers.size).padStart(4)}`);
    console.log(`  files reading url or key    ${String(now.readers.size).padStart(4)}`);
    console.log(`  listed, UNREVIEWED          ${String(open).padStart(4)}   (backlog, may only shrink)`);
    console.log(`  NEW or grown                ${String(fresh.length).padStart(4)}`);
    console.log('');
    if (fresh.length) {
        console.log('  A peer is written, or its url or key trusted, in a place nobody has answered for. Say on');
        console.log('  what proof in security/peer-paths.json (docs/pitfalls.md §103): a writer names who may call');
        console.log('  it and what binds the node id to the key; a reader names the status, flag or tier it checks.');
        console.log('');
        for (const f of fresh) console.log(`    ${f}`);
        console.log('');
    }
    if (fell.length) {
        console.log('  Fewer than listed (run --seed to lock the gain in):');
        for (const f of fell) console.log(`    ${f}`);
        console.log('');
    }
    if (strict && fresh.length) {
        console.error(`✖ ${fresh.length} new or grown peer path(s).`);
        process.exit(1);
    }
    console.log(fresh.length ? '  (report only, pass --strict to gate)' : '  ✓ every peer writer and reader is listed');
}

main();
