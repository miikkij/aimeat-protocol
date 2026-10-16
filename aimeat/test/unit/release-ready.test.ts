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
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W08).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function check(name: string, runs: { ci?: unknown[]; nightly?: unknown[] } | 'offline') {
    const file = join(scratch, `${name}.json`);
    writeFileSync(file, JSON.stringify(runs === 'offline' ? { __offline: true } : {
        [`/repos/${SLUG}/actions/workflows/ci.yml/runs`]: { workflow_runs: runs.ci ?? [] },
        [`/repos/${SLUG}/actions/workflows/e2e-full.yml/runs`]: { workflow_runs: runs.nightly ?? [] },
    }));
    return spawnSync(process.execPath, [SCRIPT, '--no-main-check', '--require=ci.yml,e2e-full.yml'], {
        cwd: scratch, encoding: 'utf8', env: { ...process.env, AIMEAT_CI_API_FIXTURE: file, AIMEAT_CI_REPO: SLUG },
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
