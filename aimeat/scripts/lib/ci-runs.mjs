/**
 * @file scripts/lib/ci-runs.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What GitHub Actions says about main: the CI workflow's state, the nightly sweep's
 *   state, and the runs of one commit. Read through the public REST API with fetch, so it needs no
 *   `gh` CLI and no token (a GH_TOKEN or GITHUB_TOKEN in the environment is used when present).
 *
 *   WHY. CI on main ran after every push and its answer reached nobody: it was red on 236 runs in a
 *   row from 2026-10-02, across the 4.0.0 release, because the rule is never to wait for GitHub and
 *   nothing local read the result (QA audit P2-01, P4-01, P8-01). The session-start hook, `pnpm
 *   gate` and the pre-push hook now print the state, and a release reads the runs of the commit it
 *   tags (QA audit P2-02, P6-01, S9-04).
 *
 *   FAST AND OFFLINE. The answer is cached in the git common directory (one file for every worktree
 *   of the clone) and reused while it is younger than the caller's limit. Each request has a short
 *   timeout. When GitHub cannot be reached, a stale cache is shown with its age, and with no cache
 *   the state is "unknown". Nothing here throws to its caller for a network problem.
 *
 *   TESTS. AIMEAT_CI_API_FIXTURE names a JSON file whose keys are API paths (without the query) and
 *   whose values are the answers, so the hook's output is testable with no network.
 * @structure repoSlug() · cachePath() · apiGet() · summarise() · readCiState() · describeState() ·
 *   runsForCommit()
 * @usage import { readCiState, describeState } from './lib/ci-runs.mjs';
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W07: P2-01, P4-01, P8-01, P2-03; W08: P2-02, P6-01, S9-04).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const CI_WORKFLOW = 'ci.yml';
export const NIGHTLY_WORKFLOW = 'e2e-full.yml';
const DEFAULT_SLUG = 'miikkij/aimeat-protocol';
const REQUEST_TIMEOUT_MS = 2500;
/** Conclusions that say nothing about the code: a run somebody stopped or GitHub skipped. */
const NO_VERDICT = new Set(['cancelled', 'skipped', 'neutral', 'stale']);

/** @param {string} cwd */
function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** owner/repo from the origin remote; the public repository when there is none. */
export function repoSlug(cwd = process.cwd()) {
    if (process.env.AIMEAT_CI_REPO) return process.env.AIMEAT_CI_REPO;
    try {
        const url = git(cwd, 'remote', 'get-url', 'origin');
        const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (m) return m[1];
    } catch { /* not a checkout, or no origin: the default below is the answer */ }
    return DEFAULT_SLUG;
}

/** The cache file: in the git common directory, so every worktree of a clone shares one answer. */
export function cachePath(cwd = process.cwd()) {
    if (process.env.AIMEAT_CI_STATE_CACHE) return process.env.AIMEAT_CI_STATE_CACHE;
    try {
        const common = git(cwd, 'rev-parse', '--git-common-dir');
        return join(isAbsolute(common) ? common : resolve(cwd, common), 'aimeat-ci-state.json');
    } catch {
        return join(tmpdir(), 'aimeat-ci-state.json');
    }
}

/**
 * One GET against the REST API. Answers the parsed body, or throws with a short reason.
 * @param {string} path  e.g. /repos/o/r/actions/runs/1/jobs
 * @param {string} [query]
 */
export async function apiGet(path, query = '') {
    const fixture = process.env.AIMEAT_CI_API_FIXTURE;
    if (fixture) {
        const table = JSON.parse(readFileSync(fixture, 'utf8'));
        if (table.__offline) throw new Error('offline (fixture)');
        if (!(path in table)) throw new Error(`no fixture for ${path}`);
        return table[path];
    }
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'aimeat-ci-state', 'X-GitHub-Api-Version': '2022-11-28' };
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com${path}${query ? `?${query}` : ''}`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
    return res.json();
}

/**
 * The state of one workflow from its runs, newest first.
 * @param {Array<{id:number,status:string,conclusion:string|null,head_sha:string,html_url:string,created_at:string,display_title?:string,event?:string}>} runs
 */
export function summarise(runs) {
    const done = runs.filter(r => r.status === 'completed' && r.conclusion && !NO_VERDICT.has(r.conclusion));
    const running = runs.find(r => r.status !== 'completed');
    const latest = done[0];
    if (!latest) return { state: 'unknown', running: running ? { sha: running.head_sha, url: running.html_url } : undefined };
    let streak = 0;
    while (streak < done.length && done[streak].conclusion !== 'success') streak++;
    const red = latest.conclusion !== 'success';
    return {
        state: red ? 'red' : 'green',
        runId: latest.id,
        sha: latest.head_sha,
        title: latest.display_title ?? '',
        url: latest.html_url,
        at: latest.created_at,
        conclusion: latest.conclusion,
        redRuns: red ? streak : 0,
        // The oldest red run of the streak; when the streak reaches the end of the page it is "at least".
        redSince: red ? done[streak - 1].created_at : undefined,
        redAtLeast: red && streak === done.length,
        running: running ? { sha: running.head_sha, url: running.html_url } : undefined,
        failedJobs: /** @type {string[]} */ ([]),
    };
}

/** The names of a run's failed jobs; empty when they cannot be read. */
async function failedJobs(slug, runId) {
    try {
        const body = await apiGet(`/repos/${slug}/actions/runs/${runId}/jobs`, 'per_page=100');
        return (body.jobs ?? []).filter(j => j.conclusion && j.conclusion !== 'success' && !NO_VERDICT.has(j.conclusion)).map(j => j.name);
    } catch {
        return [];
    }
}

async function workflowState(slug, workflow, query) {
    const body = await apiGet(`/repos/${slug}/actions/workflows/${workflow}/runs`, query);
    const s = summarise(body.workflow_runs ?? []);
    if (s.state === 'red' && s.runId) s.failedJobs = await failedJobs(slug, s.runId);
    return s;
}

/**
 * Main's CI and nightly state, from the cache when it is younger than maxAgeMs, else from GitHub.
 * Never throws for a network problem: the answer says where it came from.
 * @param {{ cwd?: string, maxAgeMs?: number }} [opts]
 */
export async function readCiState(opts = {}) {
    const cwd = opts.cwd ?? process.cwd();
    const maxAgeMs = opts.maxAgeMs ?? 10 * 60_000;
    const file = cachePath(cwd);
    const slug = repoSlug(cwd);
    /** @type {any} */
    let cached = null;
    try { if (existsSync(file)) cached = JSON.parse(readFileSync(file, 'utf8')); } catch { cached = null; }
    if (cached && cached.slug !== slug) cached = null;
    const now = Date.now();
    if (cached && now - cached.fetchedAt < maxAgeMs && !process.env.AIMEAT_CI_API_FIXTURE) {
        return { ...cached, source: 'cache', ageMs: now - cached.fetchedAt };
    }
    if (process.env.AIMEAT_CI_STATE === 'off') {
        return cached ? { ...cached, source: 'stale', ageMs: now - cached.fetchedAt, error: 'AIMEAT_CI_STATE=off' }
            : { slug, source: 'none', error: 'AIMEAT_CI_STATE=off', ci: { state: 'unknown' }, nightly: { state: 'unknown' } };
    }
    try {
        const [ci, nightly] = await Promise.all([
            // Pushes to main only: a pull request's run says nothing about main.
            workflowState(slug, CI_WORKFLOW, 'branch=main&event=push&per_page=30'),
            workflowState(slug, NIGHTLY_WORKFLOW, 'branch=main&per_page=10'),
        ]);
        const fresh = { slug, fetchedAt: now, ci, nightly };
        try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(fresh, null, 2) + '\n'); } catch { /* a read-only cache costs the next caller one more request, nothing else */ }
        return { ...fresh, source: 'live', ageMs: 0 };
    } catch (e) {
        const error = /** @type {Error} */ (e).message;
        if (cached) return { ...cached, source: 'stale', ageMs: now - cached.fetchedAt, error };
        return { slug, source: 'none', error, ci: { state: 'unknown' }, nightly: { state: 'unknown' } };
    }
}

/** @param {string|undefined} iso */
function when(iso) {
    return iso ? iso.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC') : '?';
}

/** @param {number} ms */
function age(ms) {
    if (ms < 90_000) return `${Math.max(0, Math.round(ms / 1000))} s`;
    if (ms < 90 * 60_000) return `${Math.round(ms / 60_000)} min`;
    if (ms < 48 * 3600_000) return `${Math.round(ms / 3600_000)} h`;
    return `${Math.round(ms / 86_400_000)} days`;
}

/** One workflow in one line, plus a second line for a red one. */
function describeOne(label, s) {
    if (!s || s.state === 'unknown') return [`${label}: UNKNOWN (no completed run could be read)`];
    const sha = (s.sha ?? '').slice(0, 9);
    const running = s.running ? `; a run for ${s.running.sha.slice(0, 9)} is in progress` : '';
    if (s.state === 'green') return [`${label}: GREEN (${sha}, ${when(s.at)})${running}`];
    const jobs = s.failedJobs?.length ? `; failed: ${s.failedJobs.join(', ')}` : '';
    const streak = `${s.redAtLeast ? 'at least ' : ''}${s.redRuns} run(s) in a row since ${when(s.redSince)}`;
    return [`${label}: RED (${sha}, ${when(s.at)}), ${streak}${jobs}${running}`, `  ${s.url}`];
}

/**
 * The state as lines for a person or a session.
 * @param {any} state  what readCiState answered
 */
export function describeState(state) {
    const lines = [...describeOne('CI on main', state.ci), ...describeOne('Nightly E2E sweep', state.nightly)];
    if (state.source === 'live') lines.push(`  (read from GitHub just now, ${state.slug})`);
    else if (state.source === 'cache') lines.push(`  (read from GitHub ${age(state.ageMs)} ago, ${state.slug})`);
    else if (state.source === 'stale') lines.push(`  (GitHub could not be read: ${state.error}; this is what it said ${age(state.ageMs)} ago)`);
    else lines.push(`  (GitHub could not be read: ${state.error}; the state is unknown)`);
    return lines;
}

/**
 * The completed runs of one workflow for one commit, newest first, for a release check.
 * Throws when GitHub cannot be read: a release must not pass on a missing answer.
 * @param {string} slug @param {string} workflow @param {string} sha
 */
export async function runsForCommit(slug, workflow, sha) {
    const body = await apiGet(`/repos/${slug}/actions/workflows/${workflow}/runs`, `head_sha=${sha}&per_page=30`);
    return (body.workflow_runs ?? []).filter(r => r.head_sha === sha);
}
