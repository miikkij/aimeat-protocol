#!/usr/bin/env node
/**
 * @file scripts/ci-state.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Prints main's CI state and the nightly sweep's state, and decides whether a push may
 *   go on top of a red CI.
 *
 *   WHY. CI on main was red for eleven days and 236 runs, across a release, and nobody was told:
 *   the rule is not to wait for GitHub, and nothing local read its answer (QA audit P2-01, P4-01,
 *   P8-01). The nightly sweep was red seven nights in a row the same way (P2-03). This prints both
 *   where a session and a person already look: the session-start hook, `pnpm gate`, `git push`.
 *
 *   A PUSH ON A RED CI NEEDS A NAMED REASON (--push-check). When the newest finished CI run on main
 *   is red, a push has to say why it goes on top of it: a `Red-CI: <reason>` trailer in one of the
 *   commits it pushes (kept in history), or AIMEAT_RED_CI_REASON for this one push. A Claude Code
 *   session (CLAUDECODE=1) is refused without one; a person's push gets the same message as a
 *   warning and goes on, because a refusal from a hook is easy to miss in VS Code and broke the
 *   developer's Sync Changes once already (2026-09-05). AIMEAT_RED_CI_REFUSE=all refuses for
 *   everybody. An unknown state (offline, GitHub down) never refuses.
 * @usage
 *   node scripts/ci-state.mjs                         # the state, cached up to 10 minutes
 *   node scripts/ci-state.mjs --max-age=0             # read GitHub now
 *   node scripts/ci-state.mjs --json
 *   node scripts/ci-state.mjs --push-check --range=origin/main..HEAD   # the pre-push hook
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W07: P2-01, P4-01, P8-01, P2-03).
 */
import { execFileSync } from 'node:child_process';
import { describeState, readCiState } from './lib/ci-runs.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** The reasons a push names for going on top of a red CI: commit trailers, then the environment. */
function namedReasons(range) {
    const reasons = [];
    if (range) {
        try {
            const out = execFileSync('git', ['log', '--format=%(trailers:key=Red-CI,valueonly,separator=%x1f)', range], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            for (const line of out.split('\n')) for (const v of line.split('\x1f')) if (v.trim()) reasons.push(v.trim());
        } catch { /* an unreadable range names no reason; the environment still may */ }
    }
    if (process.env.AIMEAT_RED_CI_REASON?.trim()) reasons.push(process.env.AIMEAT_RED_CI_REASON.trim());
    return reasons;
}

async function main() {
    const maxAgeSec = flag('max-age');
    const pushCheck = args.includes('--push-check');
    // A push decides on a fresh answer; a session start or a gate plan is fine with ten minutes.
    const maxAgeMs = maxAgeSec !== undefined ? Number(maxAgeSec) * 1000 : pushCheck ? 120_000 : 600_000;
    const state = await readCiState({ maxAgeMs });

    if (args.includes('--json')) {
        console.log(JSON.stringify(state, null, 2));
        return;
    }
    if (!pushCheck) {
        for (const line of describeState(state)) console.log(line);
        return;
    }

    if (state.ci?.state !== 'red') return;
    const reasons = namedReasons(flag('range'));
    const lines = describeState(state).filter(l => !l.startsWith('Nightly'));
    if (reasons.length > 0) {
        console.error(`[pre-push] CI on main is red, and this push names its reason: ${reasons.join(' | ')}`);
        return;
    }
    const session = process.env.CLAUDECODE === '1';
    const refuse = session || process.env.AIMEAT_RED_CI_REFUSE === 'all';
    console.error(`[pre-push] ${refuse ? 'refused' : 'warning'}: CI on main is red, and this push names no reason for going on top of it.`);
    for (const l of lines) console.error(`  ${l}`);
    console.error('  Name the reason in a commit trailer, which stays in history:  Red-CI: fixes the unit job');
    console.error('  or for this one push:  AIMEAT_RED_CI_REASON="<why this push cannot wait>" git push');
    if (refuse) process.exit(1);
}

main().catch((e) => {
    // A state reader that breaks must not stop a push or a session start: say so and go on.
    console.error(`ci-state: ${e instanceof Error ? e.message : String(e)}`);
});
