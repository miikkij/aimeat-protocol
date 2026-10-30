/**
 * @file test/unit/release-ready.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A release waits for green (QA audit 2026-10-16, W08: P2-02, P6-01, S9-04, P6-04).
 *   1. scripts/release-ready.mjs refuses a commit whose CI or nightly run is red, missing, still
 *      running, or unreadable, and passes one whose runs are both green. It reads fixture answers of
 *      the GitHub API (AIMEAT_CI_API_FIXTURE), so nothing here reads the network.
 *   2. Every tag workflow runs that check in a job of its own before anything is built or
 *      published, and prepublishOnly runs it and the packed-package start before `npm publish`.
 *   3. A named reason releases over a nightly sweep that is red, missing or running, and over nothing
 *      else; without one the check refuses as before (Jouni, decision 2026-10-16).
 * @version-history
 *   v1.3.0 -- 2026-10-30 -- A node release is refused while the released commit's ADOPTION_CUTOFF is
 *     null (secaudit2026oct26 round 8c, connector-04).
 *   v1.2.0 -- 2026-10-20 -- A green nightly of an earlier commit on main counts for 24 hours.
 *   v1.1.0 -- 2026-10-16 -- The named reason for releasing over a red nightly: the environment, the
 *     tag message, the loud line, the job summary and step output, and the two workflows that pass it.
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W08).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = fileURLToPath(new URL('../..', import.meta.url));
const REPO = join(AIMEAT, '..');
const SCRIPT = join(AIMEAT, 'scripts', 'release-ready.mjs');
const SLUG = 'test-owner/test-repo';

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-release-ready-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const git = (...a: string[]) => execFileSync('git', a, { cwd: scratch, encoding: 'utf8' }).trim();
git('init', '-q');
git('-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', 'commit', '--allow-empty', '-qm', 'release');
const SHA = git('rev-parse', 'HEAD');
const OTHER = 'f'.repeat(40);

const run = (id: number, workflow: string, conclusion: string | null, sha = SHA, status = 'completed') =>
    ({ id, name: workflow, status, conclusion, head_sha: sha, html_url: `https://github.com/${SLUG}/actions/runs/${id}`, created_at: '2026-10-16T10:00:00Z' });

function check(name: string, runs: { ci?: unknown[]; nightly?: unknown[] } | 'offline', env: Record<string, string> = {}) {
    const file = join(scratch, `${name}.json`);
    writeFileSync(file, JSON.stringify(runs === 'offline' ? { __offline: true } : {
        [`/repos/${SLUG}/actions/workflows/ci.yml/runs`]: { workflow_runs: runs.ci ?? [] },
        [`/repos/${SLUG}/actions/workflows/e2e-full.yml/runs`]: { workflow_runs: runs.nightly ?? [] },
    }));
    return spawnSync(process.execPath, [SCRIPT, '--no-main-check', '--require=ci.yml,e2e-full.yml'], {
        cwd: scratch, encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', AIMEAT_RELEASE_RED_REASON: '', AIMEAT_CI_API_FIXTURE: file, AIMEAT_CI_REPO: SLUG, ...env },
    });
}

describe('release-ready decides on the runs of the exact commit', () => {
    it('passes a commit whose CI and nightly runs are green', () => {
        const r = check('green', { ci: [run(1, 'CI', 'success')], nightly: [run(2, 'E2E full sweep', 'success')] });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain('every required workflow is green on this commit');
    });

    it('refuses a commit whose CI run is red, and names the run', () => {
        const r = check('red-ci', { ci: [run(3, 'CI', 'failure')], nightly: [run(2, 'E2E full sweep', 'success')] });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain(`ci.yml: the newest finished run of this commit is failure: https://github.com/${SLUG}/actions/runs/3`);
    });

    it('refuses when the nightly ran on another commit only, and says how to get a run of this one', () => {
        const r = check('no-nightly', { ci: [run(1, 'CI', 'success')], nightly: [run(4, 'E2E full sweep', 'success', OTHER)] });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('e2e-full.yml: no run of this commit exists');
        expect(r.stderr).toContain('Run workflow');
    });

    it('refuses while a run of the commit is still in progress', () => {
        const r = check('running', { ci: [run(1, 'CI', null, SHA, 'in_progress')], nightly: [run(2, 'E2E full sweep', 'success')] });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('still in progress');
    });

    it('refuses when GitHub cannot be read: a release does not pass on an unread answer', () => {
        const r = check('offline', 'offline');
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('GitHub could not be read');
    });

    it('refuses a commit that is not on origin/main', () => {
        const r = spawnSync(process.execPath, [SCRIPT, '--require=ci.yml'], {
            cwd: scratch, encoding: 'utf8', env: { ...process.env, AIMEAT_CI_API_FIXTURE: join(scratch, 'green.json'), AIMEAT_CI_REPO: SLUG },
        });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('is not on origin/main');
    });
});

describe('a green nightly of an earlier commit on main counts for 24 hours', () => {
    // A commit on top of SHA in a repository of its own, so the other tests keep SHA as HEAD.
    const child = mkdtempSync(join(tmpdir(), 'aimeat-release-ready-child-'));
    afterAll(() => rmSync(child, { recursive: true, force: true }));
    const cgit = (...a: string[]) => execFileSync('git', a, { cwd: child, encoding: 'utf8' }).trim();
    cgit('clone', '-q', scratch, '.');
    cgit('-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', 'commit', '--allow-empty', '-qm', 'test: a suite after the bump');
    const HEAD = cgit('rev-parse', 'HEAD');
    const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

    function checkChild(name: string, nightlyCreatedAt: string) {
        const file = join(child, `${name}.json`);
        writeFileSync(file, JSON.stringify({
            [`/repos/${SLUG}/actions/workflows/ci.yml/runs`]: { workflow_runs: [run(1, 'CI', 'success', HEAD)] },
            [`/repos/${SLUG}/actions/workflows/e2e-full.yml/runs`]: { workflow_runs: [{ ...run(7, 'E2E full sweep', 'success', SHA), created_at: nightlyCreatedAt }] },
        }));
        return spawnSync(process.execPath, [SCRIPT, '--no-main-check', '--require=ci.yml,e2e-full.yml'], {
            cwd: child, encoding: 'utf8',
            env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', AIMEAT_RELEASE_RED_REASON: '', AIMEAT_CI_API_FIXTURE: file, AIMEAT_CI_REPO: SLUG },
        });
    }

    it('passes when CI is green on the commit and the nightly was green on its parent 8 hours ago, and lists the commits since', () => {
        const r = checkChild('ancestor-fresh', at(8 * 3600_000));
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain(`green on the earlier commit ${SHA.slice(0, 9)}`);
        expect(r.stdout).toContain('test: a suite after the bump');
    });

    it('refuses when that nightly is more than 24 hours old', () => {
        const r = checkChild('ancestor-old', at(25 * 3600_000));
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('e2e-full.yml: no run of this commit exists');
    });
});

describe('a node release carries the adoption cut-off of the connector (secaudit2026oct26 round 8c, connector-04)', () => {
    // A repository of its own whose commits hold aimeat/src/cli/connect/adoption-cutoff.ts.
    const repo = mkdtempSync(join(tmpdir(), 'aimeat-release-ready-cutoff-'));
    afterAll(() => rmSync(repo, { recursive: true, force: true }));
    const rgit = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
    rgit('init', '-q');
    function commitCutoff(value: string): string {
        mkdirSync(join(repo, 'aimeat', 'src', 'cli', 'connect'), { recursive: true });
        writeFileSync(join(repo, 'aimeat', 'src', 'cli', 'connect', 'adoption-cutoff.ts'), `export const ADOPTION_CUTOFF: string | null = ${value};\n`);
        rgit('add', 'aimeat/src/cli/connect/adoption-cutoff.ts');
        rgit('-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', 'commit', '--allow-empty', '-qm', `cut-off ${value}`);
        return rgit('rev-parse', 'HEAD');
    }
    function checkRepo(name: string, sha: string, required = 'ci.yml,e2e-full.yml') {
        const file = join(repo, `${name}.json`);
        writeFileSync(file, JSON.stringify({
            [`/repos/${SLUG}/actions/workflows/ci.yml/runs`]: { workflow_runs: [run(1, 'CI', 'success', sha)] },
            [`/repos/${SLUG}/actions/workflows/e2e-full.yml/runs`]: { workflow_runs: [run(2, 'E2E full sweep', 'success', sha)] },
            [`/repos/${SLUG}/actions/workflows/python-aimeat-crewai.yml/runs`]: { workflow_runs: [run(3, 'Python', 'success', sha)] },
        }));
        return spawnSync(process.execPath, [SCRIPT, '--no-main-check', `--require=${required}`, `--sha=${sha}`], {
            cwd: repo, encoding: 'utf8',
            env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', AIMEAT_RELEASE_RED_REASON: '', AIMEAT_CI_API_FIXTURE: file, AIMEAT_CI_REPO: SLUG },
        });
    }

    it('refuses a commit whose cut-off is not set, and names the command that sets it', () => {
        const r = checkRepo('cutoff-null', commitCutoff('null'));
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('ADOPTION_CUTOFF');
        expect(r.stderr).toContain('pnpm release:trust-cutoff');
    });

    it('designed use: passes a commit whose cut-off is set, and the Python package is not asked for one', () => {
        const unset = commitCutoff('null');
        expect(checkRepo('cutoff-python', unset, 'ci.yml,python-aimeat-crewai.yml').status).toBe(0);
        const r = checkRepo('cutoff-set', commitCutoff("'2026-11-02T10:00:00.000Z'"));
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain('adoption cut-off: 2026-11-02T10:00:00.000Z');
    });
});

describe('a release over a nightly sweep that is not green names its reason', () => {
    const REASON = 'fixes a token check that let a refused key read memory';
    const redNightly = { ci: [run(1, 'CI', 'success')], nightly: [run(5, 'E2E full sweep', 'failure')] };

    it('refuses a red nightly with no reason, and says how to name one', () => {
        const r = check('red-nightly', redNightly);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain(`e2e-full.yml: the newest finished run of this commit is failure: https://github.com/${SLUG}/actions/runs/5`);
        expect(r.stderr).toContain('Red-Nightly: <reason>');
        expect(r.stderr).toContain('AIMEAT_RELEASE_RED_REASON');
    });

    it('passes a red nightly with AIMEAT_RELEASE_RED_REASON, with a loud line naming the reason and the run', () => {
        const output = join(scratch, 'gh-output.txt');
        const summary = join(scratch, 'gh-summary.md');
        writeFileSync(output, ''); writeFileSync(summary, '');
        const r = check('red-nightly-reason', redNightly, { AIMEAT_RELEASE_RED_REASON: REASON, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain('RELEASED OVER A NIGHTLY SWEEP THAT IS NOT GREEN. Reason, from AIMEAT_RELEASE_RED_REASON');
        expect(r.stdout).toContain(REASON);
        expect(r.stdout).toContain(`https://github.com/${SLUG}/actions/runs/5`);
        expect(readFileSync(output, 'utf8')).toBe(`red_reason=${REASON}\n`);
        expect(readFileSync(summary, 'utf8')).toContain(REASON);
    });

    it('passes a nightly that never ran on the commit when the annotated tag message names the reason', () => {
        git('-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'tag.gpgsign=false', 'tag', '-a', 'v9.9.9', '-m', `v9.9.9\n\nRed-Nightly: ${REASON}`);
        try {
            const r = check('tag-reason', { ci: [run(1, 'CI', 'success')], nightly: [] });
            expect(r.status, r.stderr).toBe(0);
            expect(r.stdout).toContain('Reason, from the message of tag v9.9.9');
            expect(r.stdout).toContain('e2e-full.yml: no run of this commit exists');
        } finally { git('tag', '-d', 'v9.9.9'); }
    });

    it('a reason does not release over a red CI run', () => {
        const r = check('red-ci-reason', { ci: [run(3, 'CI', 'failure')], nightly: [run(5, 'E2E full sweep', 'failure')] }, { AIMEAT_RELEASE_RED_REASON: REASON });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('ci.yml: the newest finished run of this commit is failure');
        expect(r.stdout).not.toContain('RELEASED OVER');
    });

    it('a reason does not release over an answer GitHub did not give', () => {
        const r = check('offline-reason', 'offline', { AIMEAT_RELEASE_RED_REASON: REASON });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('GitHub could not be read');
    });
});

describe('every release path runs the check before it builds or publishes', () => {
    const workflow = (name: string) => readFileSync(join(REPO, '.github', 'workflows', name), 'utf8');

    it.each([
        ['publish-mcp.yml', 'ci.yml,e2e-full.yml', ['publish']],
        ['publish-aimeat-crewai.yml', 'ci.yml,python-aimeat-crewai.yml', ['build']],
        ['release-desktop.yml', 'ci.yml,e2e-full.yml,desktop-check.yml', ['build']],
    ])('%s gates on %s in a release-gate job that %s needs', (file, required, dependants) => {
        const text = workflow(file);
        expect(text).toMatch(/^ {2}release-gate:$/m);
        expect(text).toContain(`node aimeat/scripts/release-ready.mjs --sha="$GITHUB_SHA" --require=${required}`);
        for (const job of dependants) {
            const block = text.slice(text.search(new RegExp(`^ {2}${job}:$`, 'm')));
            expect(block.split('\n').slice(0, 6).join('\n'), `${file}: job ${job} does not need release-gate`).toMatch(/needs: release-gate/);
        }
    });

    it.each(['publish-mcp.yml', 'release-desktop.yml'])('%s passes its red_reason input to the gate', (file) => {
        const text = workflow(file);
        expect(text).toMatch(/workflow_dispatch:\r?\n {4}inputs:\r?\n {6}red_reason:/);
        expect(text).toContain('AIMEAT_RELEASE_RED_REASON: ${{ inputs.red_reason }}');
    });

    it('the desktop release notes carry the reason the gate released over a red nightly with', () => {
        const text = workflow('release-desktop.yml');
        expect(text).toContain('red_reason: ${{ steps.gate.outputs.red_reason }}');
        expect(text).toContain('needs: [release-gate, build, sign]');
        expect(text).toContain("format('Released over a nightly sweep that was not green. Reason: {0}', needs.release-gate.outputs.red_reason)");
    });

    it('publish-mcp.yml refuses a tag that does not match server.json and aimeat/package.json', () => {
        expect(workflow('publish-mcp.yml')).toContain('does not match server.json');
    });

    it('prepublishOnly checks the runs first and starts the packed package last', () => {
        const pkg = JSON.parse(readFileSync(join(AIMEAT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        const steps = pkg.scripts.prepublishOnly.split('&&').map(s => s.trim());
        expect(steps[0]).toBe('node scripts/release-ready.mjs --require=ci.yml,e2e-full.yml');
        expect(steps.at(-1)).toBe('node scripts/pack-smoke.mjs');
    });

    it('the nightly starts the packed package, and its red leg opens an issue', () => {
        const text = workflow('e2e-full.yml');
        expect(text).toContain('run: node scripts/pack-smoke.mjs');
        expect(text).toMatch(/needs: \[sweep, release-4-0-0, pack-smoke[\],]/);
        expect(text).toContain("if: steps.sweep.outputs.conclusion != 'success'");
    });
});
