/**
 * @file scripts/check-shared-implementation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.2.0 — 2026-08-14 — SEED 39 → 38: src/mcp/feedback.ts is gone, and with it the last
 *     `storage.listFeedbackBySender()` call under src/mcp/. WRITE_SEED is untouched at 1.
 *   v1.1.0 — 2026-08-11 — WRITE_SEED 2 → 1: aimeat_operator_agent_configure writes through
 *     services/agent-profile-write.ts. The remaining writer is named, with what its REST twin is
 *     and how the two already disagree.
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
 *
 * 39 files / 2 writers on 2026-08-11, audit step 8: nineteen capabilities moved in one pass, each
 * one's write extracted into the service its REST twin already called. The number that matters is
 * the second one, 29 writing tool surfaces became 2, because a tool that only READS a record it did
 * not build has no shape to drift. The move found 169 places where the two copies had already
 * disagreed, 113 of them visible to whoever was using the tool. That is the argument for this rule
 * restated as measurement rather than as principle.
 *
 * 38 on 2026-08-14, and this one is bookkeeping rather than progress. Nothing moved onto a shared
 * service: the Node Feedback Channel was folded into messaging as support@operators, and
 * src/mcp/feedback.ts went with the capability, taking its `storage.listFeedbackBySender()` with it.
 * A deletion counts the same as a fix here, because the seed measures what exists and the file does
 * not. It is written down as a deletion so nobody later reads 39 → 38 as a tool that got fixed and
 * goes looking for the service it moved to.
 *
 * src/mcp/tool-usage-wrap.ts arrived in the same window and calls no storage, so it does not offset
 * the drop. Both halves were checked before this line was lowered; a seed moved on a guess is worse
 * than no seed, because it looks like evidence.
 */
const SEED = 38;

/**
 * The number that actually matters. A READ through storage is the same read whichever door asks;
 * a WRITE is where the two implementations drift, because a write carries a gate, a validation and
 * a side effect that one copy can forget. 30 of the 45 files write. Reported separately so progress
 * on the risky half is visible even while the file-level count sits still.
 *
 * 30 rather than 28 for the same reason as SEED above: two pure extractions, no new capability
 * writing on its own. Both parents still write, so both extractions count as writers too.
 *
 * 2 on 2026-08-11 after step 8. Nineteen capabilities moved in one pass.
 *
 * 1 on 2026-08-11 after aimeat_operator_agent_configure moved onto services/agent-profile-write.ts,
 * where PATCH /v1/agents/:name/tags and /mode already were. Three rules it had been writing around:
 * tags were stored verbatim, a mode change skipped the Hello Integration step-list re-derive, and an
 * empty scope list was accepted where REST refuses it.
 *
 * 0 on 2026-08-14. The last one was mcp/agent-tasks.ts, and the step 8 note that it had "no REST twin
 * at all" was wrong: aimeat_task_complete wrote the same two records
 * POST /v1/agents/:name/tasks/:id/complete writes, and the two had drifted three ways. REST completed
 * an ACTIVE or a STALLED task and the tool only an active one, so an agent that crashed and came back
 * could not report the work it finished, which is the same narrowing agent-task-fanout.ts was written
 * to close on the failure path. REST took a deliverable_key and the tool had no way to send one, so
 * an MCP completion never reached the public feed. And the provenance stamp depended on which door
 * was used rather than on who was writing. completeTask() in services/agent-task-fanout.ts is the
 * shared home, beside the failTask() of the same shape, and both doors call it.
 *
 * ZERO IS NOT THE END OF THE RULE. 38 tool-surface files still READ through storage directly. A read
 * is the same read whichever door asks, so it does not drift the way a write does, but the number is
 * not zero and this seed is what stops it climbing.
 */
const WRITE_SEED = 0;

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
