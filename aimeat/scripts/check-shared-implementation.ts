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
 *   WHAT THIS COUNTS. A line under src/mcp/ that calls `storage.<something>(` (the bare `storage`
 *   or a member such as `deps.storage`) is a tool doing the work itself. Each file that still does
 *   it has a CEILING, the number of such lines it held when the ceiling was last set, and the gate
 *   fails in both directions: a file above its ceiling has a new direct call, and a file below it
 *   asks for the ceiling to be lowered, so every conversion is locked in. A file with no ceiling
 *   holds none. Fixing one tool at a time is the intended way through, because each fix is local —
 *   one tool swaps a direct call for a shared service function that takes the caller and holds the gate.
 *
 *   The same files are listed in eslint-rules/no-storage-in-mcp.js EXEMPT, which reports a direct
 *   call in the editor for every other file. The two lists are held to each other here.
 * @structure CEILINGS — per file, the lines with a direct storage call. WRITE_SEED. main(): report,
 *   and gate on a file above or below its ceiling, a new file, a stale entry and a list mismatch.
 * @usage
 *   cd aimeat && pnpm check:shared-impl            # report
 *   cd aimeat && pnpm check:shared-impl --strict   # the hook/CI gate
 * @version-history
 *   v1.4.0 — 2026-10-16 — The file count (SEED 38) became a per-file ceiling of direct-call lines that
 *     fails in both directions, and the ceilings are held to the lint rule's EXEMPT list. A new direct
 *     read inside an exempt file passed until now; 155 lines in 38 tool-surface files when the
 *     ceilings were set (QA audit P3-09).
 *   v1.3.0 — 2026-09-29 — SEED 38 → 39: src/mcp/core-resources.ts, a pure extraction out of core.ts.
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
 * HISTORY OF THE FILE COUNT the ceilings below replaced on 2026-10-16. It counted files, not calls,
 * so a new direct call inside a file already counted passed unseen.
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
 *
 * 39 on 2026-09-29, and like the 2026-08-11 raise it is not a new offender: src/mcp/core-resources.ts
 * is the memory and storage resource templates moved out of core.ts, which had reached
 * max-file-lines when TARGET-082 gave them the classification reader. The same four reads, counted in
 * two files instead of one; clearing core.ts's resources clears this one with it.
 *
 * 38 on 2026-10-05: aimeat_app_manage's member actions call the services the routes call, and the new
 * mcp/app-manage-members.ts reads no storage (secaudit 2026-10, M6).
 */

/**
 * Per file, the lines with a direct storage call it may hold. Set on 2026-10-16 from the count that
 * day (QA audit P3-09); appdev-pitfalls.ts held none and left the list. LOWER a number in the same
 * change that converts a call, delete the entry (and the file's line in the lint rule's EXEMPT) when
 * it reaches zero, and never add one: a tool written after the rule calls a service.
 */
const CEILINGS: Record<string, number> = {
    'src/mcp/agent-capabilities.ts': 2,
    'src/mcp/agent-messages.ts': 2,
    'src/mcp/agent-onboarding.ts': 3,
    'src/mcp/agent-schedules.ts': 1,
    'src/mcp/agent-tasks.ts': 10,
    'src/mcp/agent-telemetry.ts': 1,
    'src/mcp/app-template-proposals.ts': 1,
    'src/mcp/apps.ts': 7,
    'src/mcp/apps-fork.ts': 2,
    'src/mcp/boards.ts': 6,
    'src/mcp/capabilities.ts': 3,
    'src/mcp/catalogue.ts': 2,
    'src/mcp/chat-instances.ts': 4,
    'src/mcp/commerce.ts': 5,
    'src/mcp/companies.ts': 2,
    'src/mcp/consent.ts': 1,
    'src/mcp/core-boards.ts': 2,
    'src/mcp/core-admin.ts': 9,
    'src/mcp/core-resources.ts': 4,
    'src/mcp/core.ts': 10,
    'src/mcp/cortex.ts': 1,
    'src/mcp/exchange-run.ts': 3,
    'src/mcp/exchange.ts': 3,
    'src/mcp/extensions.ts': 9,
    'src/mcp/index.ts': 4,
    'src/mcp/knowledge.ts': 1,
    'src/mcp/memory-extended.ts': 1,
    'src/mcp/operator-config.ts': 2,
    'src/mcp/organisms-email-invites.ts': 2,
    'src/mcp/organisms-name-invites.ts': 7,
    'src/mcp/organisms.ts': 21,
    'src/mcp/prompts-managed.ts': 2,
    'src/mcp/prompts.ts': 3,
    'src/mcp/sharing-groups.ts': 4,
    'src/mcp/skills.ts': 1,
    'src/mcp/wallet-extended.ts': 2,
    'src/mcp/workspace-members.ts': 1,
    'src/mcp/workspaces.ts': 7,
};

/** A direct storage call: the bare `storage` or a member receiver (`deps.storage`, `this.storage`). */
const DIRECT_CALL = /\bstorage\??\.([a-zA-Z]+)\s*\(/g;
const LINT_RULE = join(ROOT, 'eslint-rules', 'no-storage-in-mcp.js');

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

/** The paths in the lint rule's EXEMPT set, read from its source: the list stays a literal there. */
function lintExempt(): Set<string> {
    const src = readFileSync(LINT_RULE, 'utf-8');
    const body = /const EXEMPT = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? '';
    return new Set([...body.matchAll(/'([^']+)'/g)].map(m => m[1] as string));
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const offenders: { file: string; lines: number; calls: string[] }[] = [];

    for (const file of walk(MCP)) {
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        if (NOT_A_TOOL_SURFACE.has(rel)) continue;
        const source = stripComments(readFileSync(file, 'utf-8'));
        const calls: string[] = [];
        let lines = 0;
        for (const line of source.split('\n')) {
            const found = [...line.matchAll(DIRECT_CALL)].map(m => m[1] as string);
            if (found.length) { lines++; calls.push(...found); }
        }
        if (lines) offenders.push({ file: rel, lines, calls: [...new Set(calls)].sort() });
    }

    const total = offenders.reduce((n, o) => n + o.lines, 0);
    const ceilingTotal = Object.values(CEILINGS).reduce((n, c) => n + c, 0);
    const writers = offenders.filter(o => o.calls.some(c => WRITEISH.test(c)));
    console.log('');
    console.log('  One capability, one implementation — MCP files doing the work themselves');
    console.log('  ' + '─'.repeat(62));
    console.log(`  tool-surface files calling storage directly  ${String(offenders.length).padStart(4)}`);
    console.log(`  lines with a direct storage call             ${String(total).padStart(4)}`);
    console.log(`  sum of the per-file ceilings                 ${String(ceilingTotal).padStart(4)}`);
    console.log('');
    console.log(`  of those, files that WRITE                   ${String(writers.length).padStart(4)}`);
    console.log(`  seeded on 2026-08-10                         ${String(WRITE_SEED).padStart(4)}`);
    console.log('');

    const problems: string[] = [];
    if (writers.length > WRITE_SEED) {
        problems.push(`${writers.length} files write through storage directly, above the seeded ${WRITE_SEED}: `
            + writers.map(w => w.file).join(', '));
    }
    const seen = new Set<string>();
    for (const o of offenders) {
        seen.add(o.file);
        const ceiling = CEILINGS[o.file];
        if (ceiling === undefined) {
            problems.push(`${o.file} calls storage directly on ${o.lines} line(s) (${o.calls.slice(0, 5).join(', ')}). `
                + 'A new MCP tool calls the service or route REST calls; move the work there.');
        } else if (o.lines > ceiling) {
            problems.push(`${o.file} has ${o.lines} lines with a direct storage call, above its ceiling ${ceiling}. `
                + 'Call the service the REST route calls instead of adding one.');
        } else if (o.lines < ceiling) {
            problems.push(`${o.file} is down to ${o.lines} from its ceiling ${ceiling}. Lower its CEILINGS entry `
                + `in scripts/check-shared-implementation.ts to ${o.lines} to lock the gain in.`);
        }
    }
    for (const file of Object.keys(CEILINGS)) {
        if (!seen.has(file)) {
            problems.push(`${file} has a ceiling and no direct storage call left (or no longer exists). Delete its `
                + 'CEILINGS entry here and its line in eslint-rules/no-storage-in-mcp.js EXEMPT.');
        }
    }
    // The lint rule's EXEMPT list and these ceilings name the same files, so the editor and the gate agree.
    const exempt = lintExempt();
    for (const file of Object.keys(CEILINGS)) {
        if (!exempt.has(file)) problems.push(`${file} has a ceiling here and is missing from eslint-rules/no-storage-in-mcp.js EXEMPT.`);
    }
    for (const file of exempt) {
        if (CEILINGS[file] === undefined && !NOT_A_TOOL_SURFACE.has(file)) {
            problems.push(`${file} is in eslint-rules/no-storage-in-mcp.js EXEMPT and has no ceiling here. Delete the EXEMPT line.`);
        }
    }

    if (problems.length) {
        for (const p of problems) console.error(`✖ ${p}`);
        if (strict) process.exit(1);
        return;
    }
    console.log(`  ✓ every file is at its ceiling (${total} lines in ${offenders.length} files)`);
}

main();
