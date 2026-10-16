/**
 * @file test/unit/ci-state-and-hooks.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a session is told about main's CI and about its own git hooks, and what a push
 *   on top of a red CI needs. Runs the real scripts against fixture answers of the GitHub API
 *   (AIMEAT_CI_API_FIXTURE), so nothing here reads the network.
 *
 *   1. The session-start hook prints a red CI run, the failed job and the nightly state, and says
 *      "unknown" when GitHub cannot be read and nothing is cached (QA audit P2-01, P4-01, P8-01).
 *   2. The session-start hook says whether core.hooksPath is .githooks (QA audit P2-07).
 *   3. A session's push on a red CI is refused unless it names a reason; a person's push is warned;
 *      an unknown state refuses nothing (QA audit P2-01).
 *   4. A worktree made by the WorktreeCreate hook runs the pre-commit hook on its first commit
 *      (QA audit P2-07).
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W07, W09).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = fileURLToPath(new URL('../..', import.meta.url));
const REPO = join(AIMEAT, '..');
const SESSION_START = join(REPO, '.claude', 'hooks', 'session-start.sh');
const WORKTREE_CREATE = process.env.AIMEAT_TEST_WORKTREE_HOOK ?? join(REPO, '.claude', 'hooks', 'worktree-create.sh');
const CI_STATE = join(AIMEAT, 'scripts', 'ci-state.mjs');
const SLUG = 'test-owner/test-repo';

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-ci-state-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const run = (id: number, conclusion: string | null, sha: string, at: string, status = 'completed') =>
    ({ id, status, conclusion, head_sha: sha, html_url: `https://github.com/${SLUG}/actions/runs/${id}`, created_at: at, display_title: `run ${id}` });

/** A fixture file: CI red for two runs (unit failed), the nightly green. */
function fixture(name: string, table: Record<string, unknown>): string {
    const file = join(scratch, `${name}.json`);
    writeFileSync(file, JSON.stringify(table));
    return file;
}
const RED = fixture('red', {
    [`/repos/${SLUG}/actions/workflows/ci.yml/runs`]: { workflow_runs: [
        run(3, 'failure', 'c'.repeat(40), '2026-10-16T10:00:00Z'),
        run(2, 'failure', 'b'.repeat(40), '2026-10-16T09:00:00Z'),
        run(1, 'success', 'a'.repeat(40), '2026-10-16T08:00:00Z'),
    ] },
    [`/repos/${SLUG}/actions/runs/3/jobs`]: { jobs: [{ name: 'checks', conclusion: 'success' }, { name: 'unit', conclusion: 'failure' }] },
    [`/repos/${SLUG}/actions/workflows/e2e-full.yml/runs`]: { workflow_runs: [run(9, 'success', 'b'.repeat(40), '2026-10-16T00:10:00Z')] },
});
const GREEN = fixture('green', {
    [`/repos/${SLUG}/actions/workflows/ci.yml/runs`]: { workflow_runs: [run(5, null, 'e'.repeat(40), '2026-10-16T11:00:00Z', 'in_progress'), run(4, 'success', 'd'.repeat(40), '2026-10-16T10:30:00Z')] },
    [`/repos/${SLUG}/actions/workflows/e2e-full.yml/runs`]: { workflow_runs: [run(9, 'failure', 'b'.repeat(40), '2026-10-16T00:10:00Z')] },
    [`/repos/${SLUG}/actions/runs/9/jobs`]: { jobs: [{ name: 'sweep (sqlite)', conclusion: 'failure' }] },
});
const OFFLINE = fixture('offline', { __offline: true });

function env(fixtureFile: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const e: NodeJS.ProcessEnv = { ...process.env, AIMEAT_CI_API_FIXTURE: fixtureFile, AIMEAT_CI_REPO: SLUG,
        AIMEAT_CI_STATE_CACHE: join(scratch, `cache-${Math.random().toString(36).slice(2)}.json`), ...extra };
    delete e.CLAUDECODE; delete e.AIMEAT_RED_CI_REASON; delete e.AIMEAT_RED_CI_REFUSE; delete e.AIMEAT_CI_STATE;
    return { ...e, ...extra };
}

const sessionStart = (cwd: string, e: NodeJS.ProcessEnv) =>
    execFileSync('bash', [SESSION_START], { cwd, env: e, encoding: 'utf8', input: '', timeout: 30_000 });

function gitRepo(dir: string): (...a: string[]) => string {
    mkdirSync(dir, { recursive: true });
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Hook Test');
    git('config', 'user.email', 'hook@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    return git;
}

describe('the session-start hook says what CI on main says', { timeout: 90_000 }, () => {
    it('prints a red CI run with its streak and failed job, and the nightly state', () => {
        const out = sessionStart(REPO, env(RED));
        expect(out).toMatch(/CI on main: RED \(ccccccccc, 2026-10-16 10:00 UTC\), 2 run\(s\) in a row since 2026-10-16 09:00 UTC; failed: unit/);
        expect(out).toContain(`https://github.com/${SLUG}/actions/runs/3`);
        expect(out).toMatch(/Nightly E2E sweep: GREEN \(bbbbbbbbb/);
    });

    it('prints a green CI with the run in progress, and a red nightly with its failed leg', () => {
        const out = sessionStart(REPO, env(GREEN));
        expect(out).toMatch(/CI on main: GREEN \(ddddddddd, 2026-10-16 10:30 UTC\); a run for eeeeeeeee is in progress/);
        expect(out).toMatch(/Nightly E2E sweep: RED .*failed: sweep \(sqlite\)/);
    });

    it('says unknown when GitHub cannot be read and nothing is cached, and does not fail', () => {
        const out = sessionStart(REPO, env(OFFLINE));
        expect(out).toContain('CI on main: UNKNOWN');
        expect(out).toContain('the state is unknown');
        expect(out).toContain('=== AIMEAT session start ===');
    });

    it('shows the last answer with its age when GitHub cannot be read now', () => {
        const cache = join(scratch, 'stale-cache.json');
        execFileSync(process.execPath, [CI_STATE, '--max-age=0'], { env: env(RED, { AIMEAT_CI_STATE_CACHE: cache }), encoding: 'utf8' });
        const out = execFileSync(process.execPath, [CI_STATE, '--max-age=0'], { env: env(OFFLINE, { AIMEAT_CI_STATE_CACHE: cache }), encoding: 'utf8' });
        expect(out).toContain('CI on main: RED');
        expect(out).toMatch(/GitHub could not be read: offline \(fixture\); this is what it said .* ago/);
    });
});

describe('the session-start hook says whether the git hooks are on', { timeout: 90_000 }, () => {
    it('OFF on a clone without core.hooksPath, ON once it names .githooks', () => {
        const dir = join(scratch, 'hooks-state');
        const git = gitRepo(dir);
        expect(sessionStart(dir, env(OFFLINE))).toMatch(/Git hooks: OFF \(core\.hooksPath is unset\)/);
        git('config', 'core.hooksPath', '.githooks');
        expect(sessionStart(dir, env(OFFLINE))).toContain('Git hooks: ON (core.hooksPath .githooks)');
    });
});

describe('a push on top of a red CI needs a named reason', { timeout: 90_000 }, () => {
    const dir = join(scratch, 'push');
    const git = gitRepo(dir);
    git('commit', '--allow-empty', '-qm', 'base');
    git('branch', 'base');
    git('commit', '--allow-empty', '-qm', 'work without a reason');
    const push = (fixtureFile: string, extra: Record<string, string> = {}, range = 'base..HEAD') =>
        spawnSync(process.execPath, [CI_STATE, '--push-check', `--range=${range}`], { cwd: dir, env: env(fixtureFile, extra), encoding: 'utf8' });

    it('refuses a Claude Code session that names none', () => {
        const r = push(RED, { CLAUDECODE: '1' });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('refused: CI on main is red');
        expect(r.stderr).toContain('Red-CI:');
    });

    it('lets the session go with AIMEAT_RED_CI_REASON, and says the reason', () => {
        const r = push(RED, { CLAUDECODE: '1', AIMEAT_RED_CI_REASON: 'fixes the unit job' });
        expect(r.status).toBe(0);
        expect(r.stderr).toContain('names its reason: fixes the unit job');
    });

    it('lets the session go with a Red-CI trailer in a pushed commit', () => {
        git('commit', '--allow-empty', '-qm', 'fix(unit): the red test\n\nRed-CI: this commit fixes the red unit job');
        const r = push(RED, { CLAUDECODE: '1' });
        expect(r.status).toBe(0);
        expect(r.stderr).toContain('this commit fixes the red unit job');
    });

    it('warns a person and lets the push go; AIMEAT_RED_CI_REFUSE=all refuses a person too', () => {
        const warned = push(RED, {}, 'base~0..base');
        expect(warned.status).toBe(0);
        expect(warned.stderr).toContain('warning: CI on main is red');
        expect(push(RED, { AIMEAT_RED_CI_REFUSE: 'all' }, 'base~0..base').status).toBe(1);
    });

    it('refuses nothing when CI is green or its state is unknown', () => {
        for (const f of [GREEN, OFFLINE]) {
            const r = push(f, { CLAUDECODE: '1' }, 'base~0..base');
            expect(r.status).toBe(0);
            expect(r.stderr).not.toContain('refused');
        }
    });
});

describe('a worktree made by the WorktreeCreate hook runs the git hooks', { timeout: 90_000 }, () => {
    it('the first commit in the new worktree runs pre-commit', () => {
        const origin = join(scratch, 'origin');
        const og = gitRepo(origin);
        mkdirSync(join(origin, '.githooks'), { recursive: true });
        mkdirSync(join(origin, 'aimeat'), { recursive: true });
        writeFileSync(join(origin, 'aimeat', 'README'), 'placeholder\n');
        const hook = join(origin, '.githooks', 'pre-commit');
        writeFileSync(hook, '#!/bin/sh\necho "pre-commit ran" > "$HOOK_MARKER"\n');
        chmodSync(hook, 0o755);
        og('add', '.');
        og('update-index', '--chmod=+x', '.githooks/pre-commit');
        og('-c', 'core.hooksPath=', 'commit', '-qm', 'origin');

        const clone = join(scratch, 'clone');
        execFileSync('git', ['clone', '-q', origin, clone]);
        const made = execFileSync('bash', [WORKTREE_CREATE], {
            cwd: clone, encoding: 'utf8', timeout: 60_000,
            input: JSON.stringify({ name: 'cc-test-hooks', cwd: clone }),
            env: { ...process.env, AIMEAT_WORKTREE_HOOK_SKIP_INSTALL: '1' },
        }).trim();
        const worktree = join(clone, '.worktrees', 'cc-test-hooks');
        expect(existsSync(worktree), `the hook answered ${made}`).toBe(true);

        const marker = join(scratch, 'hook-ran.txt');
        writeFileSync(join(worktree, 'change.txt'), 'a change\n');
        const wg = (...a: string[]) => execFileSync('git', a, { cwd: worktree, encoding: 'utf8', env: { ...process.env, HOOK_MARKER: marker } });
        wg('add', 'change.txt');
        wg('-c', 'user.name=Hook Test', '-c', 'user.email=hook@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'first commit in the worktree');
        expect(existsSync(marker), 'the pre-commit hook did not run in the new worktree').toBe(true);
    });
});
