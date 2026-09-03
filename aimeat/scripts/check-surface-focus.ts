/**
 * @file scripts/check-surface-focus.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the v2 MCP surfaces are still projections, or on their way to being copies
 *   of the catalog.
 *
 *   THE RULE. A surface exists so the wrong tools are not present: less context to hold, fewer ways
 *   to reach for something that does not belong to this job. `full` is the catalog and says so.
 *   Every other surface earns its name by being smaller than it.
 *
 *   WHAT IT MEASURES, and why not size. Size cannot be ratcheted: every new tool has to land on some
 *   surface (validateSurfaces refuses an unplaced one), so a size gate would fail on every honest
 *   addition and be bumped without thought within a week. What it measures instead is the DISTANCE
 *   from `full` — how many tools a surface leaves out. Add a tool where it belongs and the distance
 *   is unchanged: the tool joins `full` and that surface together. Add it only to `full` and the
 *   distance grows, which is the direction this wants. The distance only SHRINKS when somebody puts
 *   an existing tool onto a surface that did not carry it, which is the one move that makes a
 *   surface less focused, and the one this refuses.
 *
 *   The second number is the same question asked of a tool rather than a surface: how many surfaces
 *   carry it. A tool on one surface has been placed; a tool on five has been given up on. On
 *   2026-09-03 the distribution was 149 / 67 / 62 / 9 / 3 across one to five surfaces, so twelve
 *   tools were on four or more. That twelve may not grow.
 *
 *   THE MEASUREMENT THAT MOTIVATED IT. `agent` carried 190 of 292 on 2026-09-03 — 65 % of everything
 *   the node offers on a surface named after one kind of work. It got there one reasonable-looking
 *   addition at a time, because putting a tool on `agent` is always the easiest answer and nothing
 *   ever counted.
 * @structure DISTANCE_SEED / SPREAD_SEED — 2026-09-03. main(): report, and gate on any shrink.
 * @usage
 *   cd aimeat && pnpm check:surface-focus            # report
 *   cd aimeat && pnpm check:surface-focus --strict   # the hook/CI gate
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial, with the `full` surface it measures against.
 */
import { MCP_SURFACES, V2_ROLES, type SurfaceRole } from '../src/mcp/catalog/surfaces.js';

/**
 * How many tools each surface leaves OUT of `full`, on the day this was written. Higher is more
 * focused. A number below its seed means a surface grew toward the catalog rather than with it.
 */
const DISTANCE_SEED: Record<Exclude<SurfaceRole, 'full'>, number> = {
    agent: 102,
    service: 151,
    appdev: 191,
    admin: 244,
    commerce: 263,
    primitives: 279,
};

/** Tools carried by four or more surfaces — placed everywhere is placed nowhere. */
const SPREAD_SEED = 12;
/** A tool on this many surfaces or more counts toward SPREAD_SEED. */
const SPREAD_AT = 4;

export interface FocusRow { role: string; size: number; distance: number; seed: number }
export interface FocusReport { full: number; rows: FocusRow[]; spread: number; shrunk: string[]; gained: string[] }

/**
 * The whole measurement, over any surface map — so the gate's own arithmetic can be tested against
 * a synthetic one rather than only against today's real numbers, which always pass.
 */
export function focusReport(
    surfaces: Record<string, string[]>,
    seeds: Record<string, number>,
    spreadSeed = SPREAD_SEED,
    spreadAt = SPREAD_AT,
): FocusReport {
    const full = (surfaces.full ?? []).length;
    const carriedBy = new Map<string, number>();
    for (const [role, tools] of Object.entries(surfaces)) {
        if (role === 'full') continue;
        for (const name of tools) carriedBy.set(name, (carriedBy.get(name) ?? 0) + 1);
    }
    const spread = [...carriedBy.values()].filter(n => n >= spreadAt).length;

    const rows: FocusRow[] = [];
    const shrunk: string[] = [];
    const gained: string[] = [];
    for (const [role, tools] of Object.entries(surfaces)) {
        if (role === 'full') continue;
        const distance = full - tools.length;
        const seed = seeds[role] ?? 0;
        rows.push({ role, size: tools.length, distance, seed });
        if (distance < seed) shrunk.push(`${role}: leaves out ${distance}, seeded ${seed}`);
        if (distance > seed) gained.push(`${role}: ${distance - seed}`);
    }
    if (spread > spreadSeed) shrunk.push(`spread: ${spread} tools on ${spreadAt}+ surfaces, seeded ${spreadSeed}`);
    return { full, rows, spread, shrunk, gained };
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const full = MCP_SURFACES.full.length;

    const carriedBy = new Map<string, number>();
    for (const role of V2_ROLES) {
        if (role === 'full') continue;
        for (const name of MCP_SURFACES[role]) carriedBy.set(name, (carriedBy.get(name) ?? 0) + 1);
    }
    const spread = [...carriedBy.values()].filter(n => n >= SPREAD_AT).length;

    console.log('');
    console.log('  v2 MCP surfaces — how far each one still is from carrying everything');
    console.log('  ' + '─'.repeat(62));
    console.log(`  full  ${String(full).padStart(4)} tools  (the catalog minus the exclusions)`);
    console.log('');
    console.log('  surface       tools   leaves out   seeded');

    const shrunk: string[] = [];
    const gained: string[] = [];
    for (const role of V2_ROLES) {
        if (role === 'full') continue;
        const size = MCP_SURFACES[role].length;
        const distance = full - size;
        const seed = DISTANCE_SEED[role as Exclude<SurfaceRole, 'full'>];
        const mark = distance < seed ? '✖' : distance > seed ? '✓' : ' ';
        console.log(`  ${role.padEnd(12)} ${String(size).padStart(5)} ${String(distance).padStart(12)} ${String(seed).padStart(8)}  ${mark}`);
        if (distance < seed) shrunk.push(`${role}: leaves out ${distance}, seeded ${seed}`);
        if (distance > seed) gained.push(`${role}: ${distance - seed}`);
    }

    console.log('');
    console.log(`  tools on ${SPREAD_AT}+ surfaces        ${String(spread).padStart(4)}`);
    console.log(`  seeded on 2026-09-03           ${String(SPREAD_SEED).padStart(4)}`);
    console.log('');

    if (shrunk.length > 0) {
        console.log('  A surface grew toward the catalog rather than with it:');
        for (const line of shrunk) console.log(`    ${line}`);
        console.log('');
        console.error('✖ A tool that was not on this surface was added to it. If that is right, say so by lowering');
        console.error('  the seed in DISTANCE_SEED with a version-history line naming the tool and why it belongs.');
        if (strict) process.exit(1);
        return;
    }

    if (spread > SPREAD_SEED) {
        console.error(`✖ ${spread} tools are on ${SPREAD_AT} or more surfaces, above the seeded ${SPREAD_SEED}.`);
        console.error('  A tool that belongs everywhere usually belongs on `full` and one other place.');
        if (strict) process.exit(1);
        return;
    }

    if (gained.length > 0) {
        console.log(`  ✓ more focused than the seed (${gained.join(', ')}). Raise DISTANCE_SEED to lock the gain in.`);
    } else {
        console.log('  ✓ every surface still leaves out at least what it left out at the seed');
    }
}

// Importable for the unit test that proves the gate refuses what it is meant to refuse; run as a
// script otherwise.
if (process.argv[1]?.includes('check-surface-focus')) main();
