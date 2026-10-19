/**
 * @file ci-stats.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How often main's CI goes red, for how long, how many pushes it takes to turn it
 *   green, and which step failed. A REPORT, never a gate.
 *
 *   WHY IT EXISTS. GitHub keeps every CI run, its jobs and its failed step, and nothing read them.
 *   Measured on 2026-09-24 over the CI workflow's history since 2026-08-16: in September main was
 *   red 77 separate times for 62.6 hours in total, 673 runs took 230 wall hours, and the incidents
 *   board carried a cause for about 15 of the 77. The process could not be improved because
 *   nobody could say where the time went.
 *
 *   WHAT A RED PERIOD IS. The CI workflow's runs on pushes to main, oldest first, cancelled runs
 *   left out. A red period starts at a failed run and ends at the next successful one. Its first
 *   red run names the commit that broke main and the step that failed; the green run names the
 *   commit that fixed it. Every run in between is a push made while main was red: a fix round.
 *
 *   WHAT IT DOES NOT DECIDE. Why a period happened (the `cause`) needs someone to read the fix
 *   commit, so every period comes out `unclassified`. The watch "CI-punaiset jaksot" in AIMEAT
 *   CODING CENTRAL reads the fixes, sets the causes and appends the rows to workspace
 *   `ws-muf3ib6hl4j` (its readme lists the fields and the causes). `gateRuns` is the one hint the
 *   script can give by itself: the failed step is one that `pnpm gate` or the pre-commit hook
 *   always runs, so a local run before the push would most likely have caught it.
 * @structure
 *   - GATE_STEPS: CI step names that the local gate or hook always runs
 *   - gh() / listRuns() / firstFailure() / commitInfo(): read GitHub and git
 *   - redPeriods(): the periods from an ordered run list
 *   - weeks(): per-week totals
 *   - main(): the table, or JSON with --json
 * @usage cd aimeat && pnpm ci:stats [--since 2026-09-01] [--json]
 *   (reads GitHub through the GitHub CLI when it is on PATH, else through the REST API with curl,
 *   with GH_TOKEN or GITHUB_TOKEN when set; from the repo root, pnpm ci:stats works the same)
 * @version-history
 *   2026-10-19 — Without the GitHub CLI the script reads the REST API with curl (repoFromRemote,
 *     runFromRest, rest): the watch round of 2026-10-19 stopped at `spawnSync gh ENOENT`.
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { execFileSync } from 'node:child_process';

const WORKFLOW = 'ci.yml';
const RUN_LIMIT = 3000;
const DEFAULT_DAYS = 28;

/** A failed CI step that the local gate (`pnpm gate`) or the pre-commit hook always runs. */
const GATE_STEPS: RegExp[] = [/^Lint$/, /^Type check/, /check:fast/, /check:invariants/, /check:licenses|check:notices/];

interface Run {
    databaseId: number;
    conclusion: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    headSha: string;
}

interface Commit { sha: string; subject: string; session: string }

export interface RedPeriod {
    id: string;
    week: string;
    startedAt: string;
    greenAt: string | null;
    redHours: number;
    pushesWhileRed: number;
    job: string;
    step: string;
    gateRuns: boolean;
    breakSha: string;
    breakSubject: string;
    breakSession: string;
    fixSha: string;
    fixSubject: string;
    fixSession: string;
    cause: 'unclassified';
    causeNote: string;
    incident: string;
}

interface Week {
    week: string;
    runs: number;
    redRuns: number;
    periods: number;
    redHours: number;
    fixRounds: number;
    wallHours: number;
    medianMinutes: number;
}

const gh = (args: string[]): string =>
    execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Whether the GitHub CLI is on PATH. Without it the script reads the same data from GitHub's REST
 * API with curl: a machine without `gh` stopped the watch round of 2026-10-19 at `spawnSync gh
 * ENOENT`, and the round was then done by hand against the same API.
 */
const HAS_GH = ((): boolean => {
    try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

/** `owner/repo` from a GitHub remote URL (https or ssh form), or null for any other host. */
export function repoFromRemote(url: string): string | null {
    const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
    return m ? `${m[1]}/${m[2]}` : null;
}

/** The REST shape of one workflow run, as GET /repos/{repo}/actions/workflows/{id}/runs lists it. */
export interface RestRun { id: number; conclusion: string | null; status: string; created_at: string; updated_at: string; head_sha: string }

/** A REST workflow run in the shape `gh run list --json` gives, which the rest of the script reads. */
export function runFromRest(r: RestRun): Run {
    return { databaseId: r.id, conclusion: r.conclusion ?? '', status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, headSha: r.head_sha };
}

let repoCache: string | null = null;
function repo(): string {
    if (repoCache) return repoCache;
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
    const found = repoFromRemote(url);
    if (!found) throw new Error(`origin is not a GitHub repository: ${url.trim()}`);
    repoCache = found;
    return found;
}

/**
 * One GET against api.github.com with curl. GH_TOKEN or GITHUB_TOKEN, when set, goes in on stdin
 * (`-H @-`) so it never appears in the process list; without one GitHub allows 60 requests an hour,
 * which a month of history can exceed, and the error then says so.
 */
function rest<T>(path: string): T {
    const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
    const args = ['-sS', '--fail-with-body', '-H', 'Accept: application/vnd.github+json', ...(token ? ['-H', '@-'] : []), `https://api.github.com/${path}`];
    try {
        const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input: token ? `Authorization: Bearer ${token}\n` : '' });
        return JSON.parse(out) as T;
    } catch (err) {
        const detail = (err as { stdout?: string }).stdout ?? (err as Error).message;
        throw new Error(`GitHub REST ${path} failed${token ? '' : ' (no GH_TOKEN or GITHUB_TOKEN: 60 requests an hour)'}: ${String(detail).slice(0, 300)}`);
    }
}

const hours = (from: string, to: string): number => (Date.parse(to) - Date.parse(from)) / 3_600_000;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Monday of the UTC week `iso` falls in, as YYYY-MM-DD. */
function mondayOf(iso: string): string {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
}

/**
 * Completed CI runs on pushes to main since `since`, oldest first, cancelled and skipped runs left
 * out. Read one week at a time: GitHub answers a filtered run listing with at most 1000 runs and
 * says nothing when it stops, and on 2026-09-24 one query from 2026-08-01 returned 1000 runs that
 * began on 2026-08-16. A week has held at most 269.
 */
function listRuns(since: string): Run[] {
    const runs: Run[] = [];
    const end = Date.now() + 86_400_000;
    for (let from = Date.parse(since); from < end; from += 7 * 86_400_000) {
        const a = new Date(from).toISOString().slice(0, 10);
        const b = new Date(from + 6 * 86_400_000).toISOString().slice(0, 10);
        let week: Run[] = [];
        if (HAS_GH) {
            const raw = gh(['run', 'list', '--workflow', WORKFLOW, '--branch', 'main', '--event', 'push',
                '--created', `${a}..${b}`, '--limit', String(RUN_LIMIT),
                '--json', 'databaseId,conclusion,status,createdAt,updatedAt,headSha']);
            week = JSON.parse(raw) as Run[];
        } else {
            for (let page = 1; ; page++) {
                const got = rest<{ workflow_runs: RestRun[] }>(`repos/${repo()}/actions/workflows/${WORKFLOW}/runs?branch=main&event=push&created=${a}..${b}&per_page=100&page=${page}`);
                week.push(...got.workflow_runs.map(runFromRest));
                if (got.workflow_runs.length < 100) break;
            }
        }
        if (week.length >= 1000) throw new Error(`${a}..${b} returned ${week.length} runs, GitHub's cap: shorten the window`);
        runs.push(...week);
    }
    return runs
        .filter(r => r.status === 'completed' && (r.conclusion === 'success' || r.conclusion === 'failure'))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The first failed job and step of one run. */
function firstFailure(runId: number): { job: string; step: string } {
    type Jobs = { jobs: { name: string; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] }[] };
    const jobs = HAS_GH
        ? (JSON.parse(gh(['run', 'view', String(runId), '--json', 'jobs'])) as Jobs).jobs
        : rest<Jobs>(`repos/${repo()}/actions/runs/${runId}/jobs?per_page=100`).jobs;
    const job = jobs.find(j => j.conclusion === 'failure');
    if (!job) return { job: '?', step: '?' };
    return { job: job.name, step: (job.steps ?? []).find(s => s.conclusion === 'failure')?.name ?? '?' };
}

const commitCache = new Map<string, Commit>();

/** Subject and Session: trailer of a commit: from local git when it has the commit, else from GitHub. */
function commitInfo(sha: string): Commit {
    const cached = commitCache.get(sha);
    if (cached) return cached;
    let message = '';
    try {
        message = execFileSync('git', ['show', '-s', '--format=%B', sha], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
        // Not in this clone (a shallow or stale fetch): GitHub has every pushed commit.
        message = HAS_GH
            ? gh(['api', `repos/{owner}/{repo}/commits/${sha}`, '--jq', '.commit.message'])
            : rest<{ commit: { message: string } }>(`repos/${repo()}/commits/${sha}`).commit.message;
    }
    const session = /^Session:\s*(\S+)/m.exec(message)?.[1] ?? '';
    const info = { sha: sha.slice(0, 9), subject: message.split('\n')[0].trim(), session };
    commitCache.set(sha, info);
    return info;
}

/** Red periods from runs ordered oldest first. A period with no green run yet is still open. */
export function redPeriods(runs: Run[], now: string): RedPeriod[] {
    const periods: RedPeriod[] = [];
    let first: Run | null = null;
    let rounds = 0;
    const close = (green: Run | null): void => {
        if (!first) return;
        const { job, step } = firstFailure(first.databaseId);
        const broke = commitInfo(first.headSha);
        const fixed = green ? commitInfo(green.headSha) : { sha: '', subject: '', session: '' };
        periods.push({
            id: String(first.databaseId),
            week: mondayOf(first.createdAt),
            startedAt: first.createdAt,
            greenAt: green ? green.createdAt : null,
            redHours: round1(hours(first.createdAt, green ? green.createdAt : now)),
            pushesWhileRed: rounds,
            job,
            step,
            gateRuns: GATE_STEPS.some(re => re.test(step)),
            breakSha: broke.sha,
            breakSubject: broke.subject,
            breakSession: broke.session,
            fixSha: fixed.sha,
            fixSubject: fixed.subject,
            fixSession: fixed.session,
            cause: 'unclassified',
            causeNote: '',
            incident: '',
        });
    };
    for (const run of runs) {
        if (run.conclusion === 'failure') {
            if (!first) { first = run; rounds = 0; } else rounds++;
        } else if (first) {
            rounds++;
            close(run);
            first = null;
        }
    }
    close(null);
    return periods;
}

function weeks(runs: Run[], periods: RedPeriod[]): Week[] {
    const byWeek = new Map<string, Run[]>();
    for (const run of runs) {
        const key = mondayOf(run.createdAt);
        byWeek.set(key, [...(byWeek.get(key) ?? []), run]);
    }
    return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, list]) => {
        const minutes = list.map(r => hours(r.createdAt, r.updatedAt) * 60).sort((a, b) => a - b);
        const mine = periods.filter(p => p.week === week);
        return {
            week,
            runs: list.length,
            redRuns: list.filter(r => r.conclusion === 'failure').length,
            periods: mine.length,
            redHours: round1(mine.reduce((sum, p) => sum + p.redHours, 0)),
            fixRounds: mine.reduce((sum, p) => sum + p.pushesWhileRed, 0),
            wallHours: round1(minutes.reduce((sum, m) => sum + m, 0) / 60),
            medianMinutes: Math.round(minutes[minutes.length >> 1] ?? 0),
        };
    });
}

function table(rows: (string | number)[][]): string {
    const widths = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
    return rows.map(r => r.map((c, i) => typeof c === 'number' ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i])).join('  ')).join('\n');
}

function main(): void {
    const args = process.argv.slice(2);
    const sinceArg = args.indexOf('--since');
    const since = sinceArg >= 0 ? args[sinceArg + 1] : new Date(Date.now() - DEFAULT_DAYS * 86_400_000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? '')) {
        console.error('--since takes a date, YYYY-MM-DD');
        process.exit(2);
    }
    const now = new Date().toISOString();
    const runs = listRuns(since);
    const periods = redPeriods(runs, now);
    const perWeek = weeks(runs, periods);

    if (args.includes('--json')) {
        console.log(JSON.stringify({ generatedAt: now, since, workflow: WORKFLOW, weeks: perWeek, periods }, null, 2));
        return;
    }

    console.log(`CI on main since ${since}: ${runs.length} runs, ${periods.length} red periods, ` +
        `${round1(periods.reduce((s, p) => s + p.redHours, 0))} hours red, ` +
        `${periods.reduce((s, p) => s + p.pushesWhileRed, 0)} pushes to turn it green.\n`);
    console.log(table([
        ['Week', 'Runs', 'Red runs', 'Red periods', 'Hours red', 'Fix pushes', 'Wall hours', 'Median min'],
        ...perWeek.map(w => [w.week, w.runs, w.redRuns, w.periods, w.redHours, w.fixRounds, w.wallHours, w.medianMinutes]),
    ]));

    const bySteps = new Map<string, number>();
    for (const p of periods) bySteps.set(`${p.job} :: ${p.step}`, (bySteps.get(`${p.job} :: ${p.step}`) ?? 0) + 1);
    const local = periods.filter(p => p.gateRuns).length;
    console.log(`\nWhere the red periods started (${local} of ${periods.length} in a step \`pnpm gate\` or the hook always runs):\n`);
    console.log(table([['Periods', 'Job :: step'], ...[...bySteps.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [n, k])]));

    console.log('\nThe periods, newest first:\n');
    console.log(table([
        ['Started', 'Hours', 'Pushes', 'Step', 'Broke', 'Fixed'],
        ...[...periods].reverse().map(p => [
            p.startedAt.slice(0, 16).replace('T', ' '), p.redHours, p.pushesWhileRed,
            p.step.slice(0, 40), `${p.breakSha} ${p.breakSession}`, p.greenAt ? `${p.fixSha} ${p.fixSession}` : 'STILL RED',
        ]),
    ]));
}

if (process.argv[1]?.endsWith('ci-stats.ts')) main();
