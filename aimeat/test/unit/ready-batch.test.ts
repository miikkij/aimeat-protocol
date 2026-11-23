/**
 * @file test/unit/ready-batch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One run of pnpm ready for several waiting sessions (scripts/lib/ready-batch.ts), proven
 *   on real git repositories made for each case: a bare origin and one clone in which every session's
 *   commits are made, as worktrees of one repository share their commits.
 *
 *   The stages are stand-ins that read the tree checked out: a stage is red when the file its rule
 *   names is there. So each case states which session brings a red by which file it commits, and the
 *   probe is the same rule read on whatever commit the batch has checked out.
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBatch, type BatchDeps, type Stage } from '../../scripts/lib/ready-batch.js';
import type { QueueEntry, Verdict } from '../../scripts/lib/ready-queue.js';

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-ready-batch-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const run = (cwd: string, ...args: string[]): string => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_EDITOR: 'true', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
}).trim();

interface Lab {
    repo: string;
    git: (...args: string[]) => string;
    /** A session's commit on main as it was at the start: `files` written, one commit, its entry. */
    session: (name: string, files: Record<string, string>) => QueueEntry;
    /** A commit pushed straight to origin's main, as another machine would. */
    onMain: (files: Record<string, string>) => string;
    /** The files of origin's main. */
    mainFiles: () => string[];
    /** How many times each stage ran, and the lines the batch logged. */
    ran: Record<string, number>;
    lines: string[];
    /** The batch's dependencies. `red` maps a stage name to the rule that makes it red on a tree. */
    deps: (red: Record<string, (has: (file: string) => boolean) => boolean>, over?: Partial<BatchDeps>) => BatchDeps;
}

let labs = 0;
function lab(): Lab {
    const root = join(scratch, `lab-${++labs}`);
    const origin = join(root, 'origin.git');
    const repo = join(root, 'repo');
    mkdirSync(origin, { recursive: true });
    run(origin, 'init', '-q', '--bare', '--initial-branch=main');
    run(root, 'clone', '-q', origin, 'repo');
    // No hook of the surrounding checkout, and no line-ending rewrite, reaches this repository.
    run(repo, 'config', 'core.hooksPath', join(root, 'no-hooks'));
    run(repo, 'config', 'core.autocrlf', 'false');
    const git = (...args: string[]): string => run(repo, ...args);
    const commit = (files: Record<string, string>, message: string): string => {
        for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
        git('add', '-A');
        git('commit', '-q', '-m', message);
        return git('rev-parse', 'HEAD');
    };
    git('checkout', '-q', '-b', 'main');
    commit({ 'base.txt': 'one\ntwo\nthree\n' }, 'base');
    git('push', '-q', 'origin', 'main');
    const start = git('rev-parse', 'HEAD');

    let asked = 0;
    const ran: Record<string, number> = {};
    const lines: string[] = [];
    return {
        repo, git, ran, lines,
        session: (name, files) => {
            git('checkout', '-q', '-f', '--detach', start);
            const sha = commit(files, `work of ${name}`);
            asked += 1;
            return { id: `${name}-${asked}`, session: name, worktree: `/w/${name}/aimeat`, sha, at: new Date(Date.UTC(2026, 10, 23, 10, 0, asked)).toISOString(), pid: process.pid, flags: { full: false, fresh: false, noChecks: false, noMerge: false } };
        },
        onMain: (files) => {
            git('fetch', '-q', 'origin', 'main');
            git('checkout', '-q', '-f', '--detach', 'origin/main');
            const sha = commit(files, 'another machine');
            git('push', '-q', 'origin', 'HEAD:main');
            return sha;
        },
        mainFiles: () => { git('fetch', '-q', 'origin', 'main'); return git('ls-tree', '--name-only', 'origin/main').split('\n').sort(); },
        deps: (red, over = {}) => {
            const has = (file: string): boolean => existsSync(join(repo, file));
            const stages: Stage[] = Object.entries(red).map(([name, rule]) => ({
                name,
                run: async () => {
                    ran[name] = (ran[name] ?? 0) + 1;
                    return rule(has) ? { ok: false as const, detail: `${name} rule`, probe: async () => rule(has) } : { ok: true as const };
                },
            }));
            return {
                git,
                log: line => { lines.push(line); },
                logFile: '/logs/batch-test.log',
                fetchMain: () => { git('fetch', '-q', 'origin', 'main'); return git('rev-parse', 'origin/main'); },
                checkout: async (commitId) => { git('checkout', '-q', '-f', '--detach', commitId); },
                plan: async () => stages,
                push: async (tip) => {
                    git('checkout', '-q', '-f', '--detach', tip);
                    git('push', '-q', 'origin', 'HEAD:main');
                    return { ok: true, main: tip };
                },
                ...over,
            };
        },
    };
}

const statusOf = (verdicts: Map<string, Verdict>, entry: QueueEntry): string => verdicts.get(entry.id)?.status ?? 'none';
const reasonOf = (verdicts: Map<string, Verdict>, entry: QueueEntry): string => {
    const v = verdicts.get(entry.id);
    return v?.status === 'refused' ? v.reason : '';
};
const never = (): boolean => false;

describe('runBatch', { timeout: 120_000 }, () => {
    it('lands every waiting session in one run, in the order they asked, and each stage runs once', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n' });
        const bob = l.session('cc-bob-b', { 'bob.txt': 'b\n' });
        const carol = l.session('cc-carol-c', { 'carol.txt': 'c\n' });
        const verdicts = await runBatch(l.deps({ checks: never, unit: never, sweep: never }), [alice, bob, carol], 'batch-1');

        expect([alice, bob, carol].map(e => statusOf(verdicts, e))).toEqual(['landed', 'landed', 'landed']);
        expect(l.mainFiles()).toEqual(['alice.txt', 'base.txt', 'bob.txt', 'carol.txt']);
        expect(l.ran).toEqual({ checks: 1, unit: 1, sweep: 1 });
        // One commit on main for all three, the same for each, and each is told who it landed with.
        const v = verdicts.get(bob.id);
        expect(v).toMatchObject({ status: 'landed', batch: 'batch-1', with: ['cc-alice-a', 'cc-carol-c'] });
        expect(v?.status === 'landed' && v.main).toBe(l.git('rev-parse', 'origin/main'));
        expect(l.git('log', '--format=%s', 'origin/main')).toBe('work of cc-carol-c\nwork of cc-bob-b\nwork of cc-alice-a\nbase');
    });

    it('refuses a session whose commits do not apply on main, before any stage, and lands the others', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n' });
        const bob = l.session('cc-bob-b', { 'base.txt': 'one\nTWO by bob\nthree\n' });
        l.onMain({ 'base.txt': 'one\ntwo on main\nthree\n' });
        const verdicts = await runBatch(l.deps({ checks: never }), [alice, bob], 'batch-1');

        expect(statusOf(verdicts, alice)).toBe('landed');
        expect(reasonOf(verdicts, bob)).toMatch(/do not apply on main as it is now.*conflict in base\.txt/);
        expect(reasonOf(verdicts, bob)).toContain('git rebase origin/main');
        expect(l.ran).toEqual({ checks: 1 });
        expect(l.mainFiles()).toEqual(['alice.txt', 'base.txt']);
    });

    it('refuses a session that conflicts with one ahead of it in the batch, and names that session', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'base.txt': 'one\ntwo by alice\nthree\n' });
        const bob = l.session('cc-bob-b', { 'base.txt': 'one\ntwo by bob\nthree\n' });
        const verdicts = await runBatch(l.deps({ checks: never }), [alice, bob], 'batch-1');

        expect(statusOf(verdicts, alice)).toBe('landed');
        expect(reasonOf(verdicts, bob)).toContain('with the commits of cc-alice-a that were ahead of it in the batch');
        expect(l.git('show', 'origin/main:base.txt')).toBe('one\ntwo by alice\nthree');
    });

    it('finds the session that brought a red, refuses it alone, and tests the rest again before they land', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n' });
        const bob = l.session('cc-bob-b', { 'bob.txt': 'b\n', 'breaks-unit.txt': 'x\n' });
        const carol = l.session('cc-carol-c', { 'carol.txt': 'c\n' });
        const verdicts = await runBatch(l.deps({ checks: never, unit: has => has('breaks-unit.txt'), sweep: never }), [alice, bob, carol], 'batch-1');

        expect([alice, bob, carol].map(e => statusOf(verdicts, e))).toEqual(['landed', 'refused', 'landed']);
        expect(reasonOf(verdicts, bob)).toContain('unit is red with its commits and green without them (the sessions before it in the batch: cc-alice-a)');
        expect(verdicts.get(bob.id)).toMatchObject({ log: '/logs/batch-test.log' });
        // The first candidate stopped at unit; the second, without bob, ran every stage from the first.
        expect(l.ran).toEqual({ checks: 2, unit: 2, sweep: 1 });
        expect(l.mainFiles()).toEqual(['alice.txt', 'base.txt', 'carol.txt']);
        expect(verdicts.get(alice.id)).toMatchObject({ with: ['cc-carol-c'] });
    });

    it('refuses the later of two sessions when the red shows only with both', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'half-one.txt': '1\n' });
        const bob = l.session('cc-bob-b', { 'half-two.txt': '2\n' });
        const both = (has: (f: string) => boolean): boolean => has('half-one.txt') && has('half-two.txt');
        const verdicts = await runBatch(l.deps({ checks: both }), [alice, bob], 'batch-1');

        expect([alice, bob].map(e => statusOf(verdicts, e))).toEqual(['landed', 'refused']);
        expect(l.mainFiles()).toEqual(['base.txt', 'half-one.txt']);
    });

    it('goes on when a red does not repeat on the same commit, and says so in every verdict', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n' });
        const bob = l.session('cc-bob-b', { 'bob.txt': 'b\n' });
        let first = true;
        const once = (): boolean => { const red = first; first = false; return red; };
        const verdicts = await runBatch(l.deps({ checks: never, sweep: once }), [alice, bob], 'batch-1');

        expect([alice, bob].map(e => statusOf(verdicts, e))).toEqual(['landed', 'landed']);
        const v = verdicts.get(alice.id);
        expect(v?.status === 'landed' && v.notes.join('\n')).toContain('[batch-flaky] sweep was red on the candidate');
        expect(l.ran).toEqual({ checks: 1, sweep: 1 });
    });

    it('refuses a session waiting alone when a stage is red, without a probe, and pushes nothing', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n', 'breaks-unit.txt': 'x\n' });
        let pushes = 0;
        const deps = l.deps({ unit: has => has('breaks-unit.txt') }, { push: async () => { pushes += 1; return { ok: true, main: 'x' }; } });
        const verdicts = await runBatch(deps, [alice], 'batch-1');

        expect(reasonOf(verdicts, alice)).toBe('unit is red: unit rule');
        expect(pushes).toBe(0);
        expect(l.mainFiles()).toEqual(['base.txt']);
    });

    it('tells a session whose commits are on main already that they have landed, and runs nothing for it', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n' });
        l.git('push', '-q', 'origin', `${alice.sha}:main`);
        const verdicts = await runBatch(l.deps({ checks: never }), [alice], 'batch-1');

        expect(verdicts.get(alice.id)).toMatchObject({ status: 'landed', main: alice.sha, notes: ['its commits were on main already'] });
        expect(l.ran).toEqual({});
    });

    it('refuses every session of the candidate with the reason when the push is refused', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n' });
        const bob = l.session('cc-bob-b', { 'bob.txt': 'b\n' });
        const deps = l.deps({ checks: never }, { push: async () => ({ ok: false, reason: 'the pre-push hook refused it' }) });
        const verdicts = await runBatch(deps, [alice, bob], 'batch-1');

        expect([alice, bob].map(e => reasonOf(verdicts, e))).toEqual(['the pre-push hook refused it', 'the pre-push hook refused it']);
        expect(l.mainFiles()).toEqual(['base.txt']);
    });

    it('answers green and not landed when the run was asked not to push', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n' });
        const verdicts = await runBatch(l.deps({ checks: never }, { push: async () => ({ ok: true, main: null }) }), [alice], 'batch-1');

        expect(verdicts.get(alice.id)).toEqual({ status: 'green', batch: 'batch-1', notes: [] });
        expect(l.mainFiles()).toEqual(['base.txt']);
    });

    it('lands a session whose work stands on another waiting session\'s commits, with those commits on main once', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n' });
        // Bob's commit is made on top of Alice's, as when one session continues another's work.
        l.git('checkout', '-q', '-f', '--detach', alice.sha);
        writeFileSync(join(l.repo, 'bob.txt'), 'b\n');
        l.git('add', '-A');
        l.git('commit', '-q', '-m', 'work of cc-bob-b');
        const bob: QueueEntry = { ...alice, id: 'cc-bob-b-2', session: 'cc-bob-b', sha: l.git('rev-parse', 'HEAD'), at: new Date(Date.UTC(2026, 10, 23, 10, 0, 30)).toISOString() };
        const verdicts = await runBatch(l.deps({ checks: never }), [alice, bob], 'batch-1');

        expect([alice, bob].map(e => statusOf(verdicts, e))).toEqual(['landed', 'landed']);
        expect(l.git('log', '--format=%s', 'origin/main')).toBe('work of cc-bob-b\nwork of cc-alice-a\nbase');
    });

    it('builds on main as another machine left it, and keeps that commit under the batch', async () => {
        const l = lab();
        const alice = l.session('cc-alice-a', { 'alice.txt': 'a\n' });
        l.onMain({ 'elsewhere.txt': 'e\n' });
        const verdicts = await runBatch(l.deps({ checks: has => !has('elsewhere.txt') }), [alice], 'batch-1');

        // The stage saw main's new file: the candidate was built on today's main, not on the session's base.
        expect(statusOf(verdicts, alice)).toBe('landed');
        expect(l.mainFiles()).toEqual(['alice.txt', 'base.txt', 'elsewhere.txt']);
    });
});
