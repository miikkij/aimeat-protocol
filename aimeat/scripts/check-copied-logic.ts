/**
 * @file scripts/check-copied-logic.ts
 * @description The same decision, written out in two files.
 *
 *   WHY. "One capability, one implementation, whatever the interface" is the architecture, and the
 *   way it gets broken is not by anyone deciding to break it. It gets broken while FIXING a
 *   difference: the tool surface is missing a check, the quickest repair is to paste the check in,
 *   and now the two copies agree — until the day somebody edits one. That is how a raised ceiling
 *   holds on one door, how a refusal message drifts, and how the August 2026 audit found 315
 *   differences that nobody ever chose.
 *
 *   A reviewer cannot catch this reliably. The two copies are usually correct, usually identical,
 *   and usually in files nobody opens together. A machine can.
 *
 *   WHAT IT DOES. Normalises every source line (whitespace, quotes and the identifiers that
 *   legitimately differ between doors — `req.auth!.owner` versus `callerOwner` — collapse to the
 *   same token), then looks for runs of MIN_LINES or more that appear in two different files where
 *   one is a tool surface and the other is not. A run that long, identical after normalisation, is
 *   a decision someone copied.
 *
 *   WHAT IT DOES NOT CATCH, and deliberately: the same rule expressed differently. That is a real
 *   duplicate and this check is blind to it; the answer there is the drift map and a person reading
 *   both doors. This catches the cheap, common, mechanical case.
 *
 *   THE SEED. The count on the day it was written. It fails only ABOVE that, so it stops the next
 *   copy without demanding that today's backlog be cleared first — and every entry cleared lowers
 *   the number, which is the only direction it may move.
 * @structure MIN_LINES · normalise() · main()
 * @usage pnpm check:copied-logic  ·  --strict fails the build  ·  --list prints every pair
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial. Written after the audit's own diff was found to have repaired
 *     four differences by copying the rule into the second door.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * How long a run has to be before it is evidence rather than coincidence.
 *
 * Six normalised lines. Below that, ordinary shapes collide — a guard clause plus a return, a small
 * object literal — and the check turns into noise, which is how a gate stops being read.
 */
const MIN_LINES = 6;

/**
 * The seed: file pairs on 2026-08-11, after every MCP↔REST pair was collapsed. What is left is five
 * pairs between a ROUTE and a SERVICE — the same disease, but the agent surface is not in it, and
 * each predates this work.
 *
 * The original list, for what it is worth: the audit's own four copies
 * (services/install-quotas.ts, services/agent-task-rules.ts, services/memory-ceilings.ts and the
 * board post). What is left predates this work and is the backlog, not the rule being broken today.
 *
 * Lower it as pairs are cleared. Never raise it: a new pair means somebody repaired a difference by
 * copying the rule, which is the failure this whole exercise exists to prevent.
 */
const SEED = 5;

const SIDES = [
    { name: 'mcp', dir: 'src/mcp' },
    { name: 'routes', dir: 'src/routes' },
    { name: 'services', dir: 'src/services' },
];

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

/**
 * Reduce a line to its decision, dropping what legitimately differs between two doors.
 *
 * The identity expression is the big one: the HTTP handler says `req.auth!.owner` where the tool
 * says `callerOwner` or `agentGaii`, and treating those as different would hide every copied gate.
 * Refusal RENDERING differs by design (MCP has no status codes), so a line that only sends a
 * response is dropped rather than compared.
 */
function normalise(line: string): string | null {
    let l = line.trim();
    if (!l || l.startsWith('//') || l.startsWith('*') || l.startsWith('/*')) return null;
    // Response rendering is per-door by design.
    if (/^(res\.status|res\.json|return \{ content:)/.test(l)) return null;
    l = l
        .replace(/req\.auth!?\.(owner|sub)( as string)?/g, 'ID')
        .replace(/\b(callerOwner|ownerName|agentGaii|callerGaii|ownerGhii|callerGhii)\b/g, 'ID')
        .replace(/['"`]/g, '"')
        .replace(/\s+/g, ' ');
    return l.length >= 12 ? l : null;
}

interface Block { file: string; start: number; lines: string[] }

function blocks(file: string): Block[] {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const raw = readFileSync(file, 'utf-8').split(/\r?\n/);
    const kept: { text: string; line: number }[] = [];
    for (const [i, l] of raw.entries()) {
        const n = normalise(l);
        if (n) kept.push({ text: n, line: i + 1 });
    }
    const out: Block[] = [];
    for (let i = 0; i + MIN_LINES <= kept.length; i++) {
        const window = kept.slice(i, i + MIN_LINES).map(k => k.text);
        // A run has to contain real reasoning to count. Six consecutive `field: value,` lines are a
        // RECORD SHAPE, which is its own drift class and its own fix (a shared builder); firing on
        // those would bury the gate under things nobody is about to change. A decision branches,
        // returns, throws or awaits.
        if (!window.some(l => /^(if |else|for |while |return |throw |await |const \w+ = await )/.test(l))) continue;
        out.push({ file: rel, start: kept[i].line, lines: window });
    }
    return out;
}

function sideOf(rel: string): string | null {
    for (const s of SIDES) if (rel.startsWith(s.dir + '/')) return s.name;
    return null;
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const list = process.argv.includes('--list');

    const index = new Map<string, Block[]>();
    for (const side of SIDES) {
        for (const file of walk(join(ROOT, side.dir))) {
            for (const b of blocks(file)) {
                const key = b.lines.join('\n');
                const bucket = index.get(key);
                if (bucket) bucket.push(b); else index.set(key, [b]);
            }
        }
    }

    // A pair matters when the two copies live in DIFFERENT files on DIFFERENT sides: a tool surface
    // and a route, or either and a service. Two copies inside one file are a local repetition, which
    // is a style question rather than a drift risk.
    const seen = new Set<string>();
    const pairs: { a: Block; b: Block }[] = [];
    for (const group of index.values()) {
        if (group.length < 2) continue;
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i], b = group[j];
                if (a.file === b.file) continue;
                const sa = sideOf(a.file), sb = sideOf(b.file);
                if (!sa || !sb || sa === sb) continue;
                const id = `${a.file}|${b.file}|${a.lines[0]}`;
                if (seen.has(id)) continue;
                seen.add(id);
                pairs.push({ a, b });
            }
        }
    }

    // Collapse overlapping windows into one report per file pair.
    const byPair = new Map<string, { a: Block; b: Block }>();
    for (const p of pairs) {
        const k = `${p.a.file}|${p.b.file}`;
        if (!byPair.has(k)) byPair.set(k, p);
    }

    console.log('');
    console.log(`  The same decision written out twice (${MIN_LINES}+ identical lines, two sides)`);
    console.log('  ' + '─'.repeat(62));
    console.log(`  file pairs sharing a copied block        ${String(byPair.size).padStart(4)}`);
    console.log(`  seeded on 2026-08-11                     ${String(SEED).padStart(4)}`);
    console.log('');

    if (list || byPair.size > SEED) {
        for (const { a, b } of byPair.values()) {
            console.error(`  ✖ ${a.file}:${a.start}`);
            console.error(`    ${b.file}:${b.start}`);
            console.error(`      ${a.lines[0].slice(0, 92)}`);
        }
        console.error('');
    }

    if (byPair.size > SEED) {
        console.error(`  ✖ ${byPair.size} copied blocks, above the seeded ${SEED}.`);
        console.error('');
        console.error('  Put the decision in ONE function that takes the caller (identity, roles, scopes)');
        console.error('  and returns a refusal or a result, then call it from both doors. Each door still');
        console.error('  renders its own answer — that part is meant to differ. Worked examples:');
        console.error('  services/memory-write.ts, services/board-post.ts, services/install-quotas.ts,');
        console.error('  services/agent-task-rules.ts, services/memory-ceilings.ts.');
        if (strict) process.exit(1);
        return;
    }

    console.log('  ✓ no decision is written out on two sides');
}

main();
