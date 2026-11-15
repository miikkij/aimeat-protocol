/**
 * @file scripts/ready.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Finished work reaches main only after the full E2E run is green on it: this pushes the
 *   session's commits to its own branch `ready/<session>`, starts the full run there on GitHub (four
 *   shards per backend, the same workflow as the nightly), waits for it, and when it is green puts the
 *   commits on main and deletes the branch. When it is red it prints the red suites and stops; main is
 *   not touched.
 *
 *   WHY. Ruled by the developer on 2026-11-15: develop against the suites of the area only, run
 *   `pnpm check:fast` once when the work looks done and fix every red line in one go, then the full E2E
 *   run and a build before main, so that nothing reaches main red. The full run takes about 35 minutes
 *   on GitHub and hours on a laptop, and GitHub runs only what it has, so the work goes to a branch of
 *   its own first. The branch carries only work that already passed check:fast.
 *
 *   WHAT IT REFUSES. A dirty tree (what is tested must be what is committed), no AIMEAT_SESSION (the
 *   branch is named by it), a HEAD behind origin/main (rebase first, then the run tests the work on
 *   today's main), and nothing to bring.
 *
 *   MAIN MOVED DURING THE RUN. Other sessions push while the run is going. When origin/main is no longer
 *   under HEAD at the end, the commits are rebased onto it and pushed; CI runs on main as always. They
 *   are not tested a second time, or a busy day would never end.
 * @usage
 *   cd aimeat && AIMEAT_SESSION=cc-alice-x pnpm ready         # push, run, wait, merge
 *   cd aimeat && pnpm ready --no-merge                         # stop after a green run
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import { execFileSync } from 'node:child_process';

const sh = (cmd: string, args: string[], opts: { inherit?: boolean } = {}): string =>
    execFileSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] }) ?? '';
const git = (...args: string[]): string => sh('git', args).trim();
const gh = (...args: string[]): string => sh('gh', args).trim();
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const WORKFLOW = 'e2e-full.yml';

function refuse(msg: string): never {
    console.error(`[ready] ${msg}`);
    process.exit(1);
}

async function main(): Promise<void> {
    const noMerge = process.argv.includes('--no-merge');
    const session = process.env.AIMEAT_SESSION?.trim();
    if (!session) refuse('AIMEAT_SESSION is not set; the branch is named by it (ready/<session>).');
    if (git('status', '--porcelain', '--untracked-files=no')) refuse('the tree has uncommitted changes; commit them first, so the run tests what is committed.');

    git('fetch', '-q', 'origin', 'main');
    const behind = Number(git('rev-list', '--count', 'HEAD..origin/main'));
    if (behind > 0) refuse(`HEAD is ${behind} commit(s) behind origin/main: git rebase origin/main, then pnpm ready.`);
    const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'));
    if (ahead === 0) refuse('nothing to bring: HEAD is origin/main.');

    const head = git('rev-parse', 'HEAD');
    const branch = `ready/${session}`;
    console.log(`[ready] ${ahead} commit(s), ${head.slice(0, 9)} → ${branch}`);
    sh('git', ['push', '--force', 'origin', `HEAD:refs/heads/${branch}`], { inherit: true });

    const started = Date.now();
    gh('workflow', 'run', WORKFLOW, '--ref', branch);
    let runId = 0;
    for (let i = 0; i < 30 && !runId; i++) {
        await sleep(5000);
        const runs = JSON.parse(gh('run', 'list', '--workflow', WORKFLOW, '--branch', branch, '--limit', '5', '--json', 'databaseId,headSha,createdAt')) as Array<{ databaseId: number; headSha: string; createdAt: string }>;
        runId = runs.find(r => r.headSha === head && Date.parse(r.createdAt) >= started - 60_000)?.databaseId ?? 0;
    }
    if (!runId) refuse(`the run on ${branch} did not appear in 150 s; look at gh run list --workflow ${WORKFLOW} --branch ${branch}.`);
    const url = gh('run', 'view', String(runId), '--json', 'url', '--jq', '.url');
    console.log(`[ready] full E2E run: ${url}`);

    let state = { status: '', conclusion: '' };
    while (state.status !== 'completed') {
        await sleep(60_000);
        try { state = JSON.parse(gh('run', 'view', String(runId), '--json', 'status,conclusion')); }
        catch (err) { console.warn(`[ready] could not read the run (asked again in a minute): ${String((err as Error).message).split('\n')[0]}`); }
    }
    const minutes = Math.round((Date.now() - started) / 60_000);
    if (state.conclusion !== 'success') {
        console.error(`[ready] RED after ${minutes} min (${state.conclusion}). Main is not touched; ${branch} is kept.`);
        const jobs = gh('run', 'view', String(runId), '--json', 'jobs', '--jq', '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | .name');
        if (jobs) console.error(`  red jobs:\n${jobs.split('\n').map(j => `    ${j}`).join('\n')}`);
        try {
            const log = sh('gh', ['run', 'view', String(runId), '--log-failed']);
            const lines = [...new Set(log.split('\n').filter(l => /❌|✗ e2e/.test(l)).map(l => l.replace(/^[^\t]*\t[^\t]*\t\S+ /, '').trim()))];
            if (lines.length) console.error(`  red assertions:\n${lines.slice(0, 40).map(l => `    ${l}`).join('\n')}`);
        } catch (err) { console.error(`  the failed log could not be read (${String((err as Error).message).split('\n')[0]}); it is on the run's page.`); }
        console.error('  Fix every red line in one go, commit, and run pnpm ready again.');
        process.exit(1);
    }
    console.log(`[ready] GREEN after ${minutes} min.`);
    if (noMerge) { console.log(`[ready] --no-merge: ${branch} is kept, main is not touched.`); return; }

    git('fetch', '-q', 'origin', 'main');
    if (git('rev-list', '--count', 'HEAD..origin/main') !== '0') {
        console.log('[ready] main moved during the run; rebasing the commits onto it.');
        sh('git', ['rebase', 'origin/main'], { inherit: true });
    }
    sh('git', ['push', 'origin', 'HEAD:main'], { inherit: true });
    sh('git', ['push', 'origin', '--delete', branch], { inherit: true });
    console.log(`[ready] on main: ${git('rev-parse', '--short', 'HEAD')}; ${branch} deleted.`);
}

await main();
