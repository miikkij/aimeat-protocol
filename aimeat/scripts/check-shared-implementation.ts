/**
 * @file scripts/check-shared-implementation.ts
 * @description How far the MCP surface still is from calling what REST calls.
 *
 *   THE RULE (CLAUDE.md, Backend): one capability, one implementation, whatever the interface. An MCP
 *   tool declares its own name, description and parameters because the protocol requires that. It
 *   does not do the work itself: it calls the same route or the same service function REST calls, so
 *   the scope check, the validation and the provenance happen where they were written once.
 *
 *   THE COST OF NOT DOING THAT, measured rather than argued: the same defect has been fixed three
 *   separate times inside `aimeat_memory_write` — schema locks, the write target, the provenance
 *   stamp — each time in one place while the other surface kept the old behaviour. The August 2026
 *   audit then found two more of the same kind, and step 4 found eight more in the extension sandbox.
 *
 *   WHAT THIS COUNTS. A file under src/mcp/ that calls `storage.<something>` is doing the work
 *   itself. That is the number to drive to zero, and it is a ratchet: the seed is the count on the
 *   day this was written, and the gate fails only if the number GOES UP. Fixing one tool at a time
 *   is the intended way through, because each fix is local — one tool swaps a direct call for a
 *   shared service function that takes the caller and holds the gate.
 * @structure SEED — the count on 2026-08-10. main(): report, and gate on any increase.
 * @usage
 *   cd aimeat && pnpm check:shared-impl            # report
 *   cd aimeat && pnpm check:shared-impl --strict   # the hook/CI gate
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 3, option B).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const MCP = join(ROOT, 'src', 'mcp');

/**
 * Files under src/mcp/ that are not tool surfaces and may talk to storage freely: the OAuth server,
 * session plumbing, and the catalog. They implement the protocol, not a capability.
 */
const NOT_A_TOOL_SURFACE = new Set<string>([
    'src/mcp/oauth.ts',
    'src/mcp/session.ts',
    'src/mcp/sessions.ts',
    'src/mcp/transport.ts',
]);

/**
 * The count on the day the rule got a measure. The gate fails only above this.
 *
 * 44 when the number was first taken (the diagram the developer asked for, commit 846f21f4).
 * 43 after aimeat_memory_write moved onto services/memory-write.ts — the capability whose same
 * defect had been fixed three separate times. Lower this line with every tool that follows.
 *
 * 44 on 2026-08-11 after mcp/apps-fork.ts moved its quota onto services/install-quotas.ts.
 * 45 earlier that day, and the two extra files were NOT new offenders: apps-fork.ts and
 * workspace-create.ts are pure extractions out of apps.ts and workspaces.ts, which grew past
 * max-file-lines while their gates were being fixed. The same code, counted in two places instead
 * of one. Raising a ratchet needs a reason in writing, and that is the reason; the backlog did not
 * grow, and clearing either parent clears its extraction with it.
 */
const SEED = 44;

/**
 * The number that actually matters. A READ through storage is the same read whichever door asks;
 * a WRITE is where the two implementations drift, because a write carries a gate, a validation and
 * a side effect that one copy can forget. 30 of the 45 files write. Reported separately so progress
 * on the risky half is visible even while the file-level count sits still.
 *
 * 30 rather than 28 for the same reason as SEED above: two pure extractions, no new capability
 * writing on its own. Both parents still write, so both extractions count as writers too.
 */
const WRITE_SEED = 29;

/** Storage methods that change something. Everything else is a read. */
const WRITEISH = /^(create|set|update|delete|add|remove|insert|upsert|write|debit|credit|transfer|enqueue|revoke|grant|mint|save|publish|archive|deactivate|activate|link|unlink)/i;

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** Drop comments so a docblock naming `storage.setMemory` does not read as a call. */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const offenders: { file: string; calls: string[] }[] = [];

    for (const file of walk(MCP)) {
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        if (NOT_A_TOOL_SURFACE.has(rel)) continue;
        const source = stripComments(readFileSync(file, 'utf-8'));
        const calls = [...source.matchAll(/\bstorage\.([a-zA-Z]+)\s*\(/g)].map(m => m[1]);
        if (calls.length) offenders.push({ file: rel, calls: [...new Set(calls)].sort() });
    }

    const count = offenders.length;
    const writers = offenders.filter(o => o.calls.some(c => WRITEISH.test(c)));
    console.log('');
    console.log('  One capability, one implementation — MCP files doing the work themselves');
    console.log('  ' + '─'.repeat(62));
    console.log(`  tool-surface files calling storage directly  ${String(count).padStart(4)}`);
    console.log(`  seeded on 2026-08-10                         ${String(SEED).padStart(4)}`);
    console.log('');
    console.log(`  of those, files that WRITE                   ${String(writers.length).padStart(4)}`);
    console.log(`  seeded on 2026-08-10                         ${String(WRITE_SEED).padStart(4)}`);
    console.log('');

    if (writers.length > WRITE_SEED) {
        console.error(`✖ ${writers.length} files write through storage directly, above the seeded ${WRITE_SEED}.`);
        if (strict) process.exit(1);
        return;
    }

    if (count > SEED) {
        console.log('  NEW since the seed — these are the ones to look at:');
        for (const o of offenders.slice(0, 10)) console.log(`    ${o.file}  (${o.calls.slice(0, 5).join(', ')})`);
        console.log('');
        console.error(`✖ ${count} exceeds the seeded ${SEED}. A new MCP tool must call the same service or route REST calls.`);
        if (strict) process.exit(1);
        return;
    }

    if (count < SEED) {
        console.log(`  ✓ down ${SEED - count} from the seed. Lower the SEED constant in this script to lock the gain in.`);
    } else {
        console.log('  ✓ no new direct-storage tool surfaces (the backlog is unchanged)');
    }
}

main();
