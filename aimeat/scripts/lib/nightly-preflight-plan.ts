/**
 * @file scripts/lib/nightly-preflight-plan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What `pnpm nightly:preflight` runs, chosen from two inputs: the failed-job log of the
 *   last nightly run (`gh run view <id> --log-failed`) and the files changed since that run's commit.
 *   Pure functions, so the selection is unit-tested without GitHub or git.
 *
 *   WHAT IS CHOSEN, and why each is enough:
 *     - every E2E suite the last nightly reported red, on the job's own backend: a fix that does not
 *       make the red one green locally will not make it green there;
 *     - every E2E suite file changed since that commit, on both backends: a changed suite is the
 *       likeliest new red;
 *     - the upgrade test on both backends when storage code changed (src/storage/), and the packed
 *       package's start when the dependency tree or the pack scripts changed;
 *     - with `full`: the whole unit suite, the upgrade test and the pack start.
 *   The sweep itself (every suite on both backends, about two hours here) is never chosen: that is
 *   the nightly's job, and the guard tier already runs on every push.
 * @structure
 *   - stripAnsi(text)
 *   - redFromLog(log) → per job: the red E2E suites
 *   - planSteps(input) → the steps, each with its reason
 * @usage import { redFromLog, planSteps } from './lib/nightly-preflight-plan.js';
 * @version-history
 *   v1.1.0 — 2026-11-14 — No 4.0.0 steps: the nightly's release-4-0-0 job is gone, the package being
 *     past 4.0.0.
 *   v1.0.0 — 2026-11-14 — Initial: a local check before the nightly is started, after a manual run
 *     took an hour to report two failures a local run finds in minutes.
 */

export type Backend = 'sqlite' | 'postgres-kysely';
export const BACKENDS: Backend[] = ['sqlite', 'postgres-kysely'];

export function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\^\[\[[0-9;]*m/g, '');
}

export interface JobReds { suites: string[] }

/**
 * The red E2E suites per job in a `gh run view --log-failed` text. Each line is
 * `<job>\t<step>\t<timestamp> <text>`, and the E2E runner closes with `##[error]<suite>` per red
 * suite (a suite name has no space, so `##[error]4/5 passed` and the exit line are not one).
 */
export function redFromLog(log: string): Map<string, JobReds> {
    const jobs = new Map<string, JobReds>();
    for (const raw of log.split(/\r?\n/)) {
        const tab = raw.indexOf('\t');
        if (tab < 0) continue;
        const job = raw.slice(0, tab);
        const suite = /##\[error\]([a-z][a-z0-9-]*)\s*$/.exec(stripAnsi(raw));
        if (!suite) continue;
        const e = jobs.get(job) ?? { suites: [] };
        if (!e.suites.includes(suite[1])) e.suites.push(suite[1]);
        jobs.set(job, e);
    }
    return jobs;
}

/** The backend a job runs on: `sweep (sqlite)`, `upgrade-from-release (postgres-kysely)`. */
export function jobBackend(job: string): Backend | null {
    const m = /\((sqlite|postgres-kysely)\)/.exec(job);
    return m ? (m[1] as Backend) : null;
}

export type Step =
    | { kind: 'e2e'; backend: Backend; suites: string[]; reason: string }
    | { kind: 'unit'; reason: string }
    | { kind: 'upgrade'; backend: Backend; reason: string }
    | { kind: 'pack-smoke'; reason: string }
    | { kind: 'skip'; reason: string };

export interface PlanInput {
    /** The last nightly's failed jobs, from redFromLog; empty when it was green or unread. */
    reds: Map<string, JobReds>;
    /** The failed job names, so a job without parsed suites (upgrade, pack-smoke) is still rerun. */
    failedJobs: string[];
    /** Files changed since the last nightly's commit, relative to the repository root. */
    changed: string[];
    full: boolean;
}

const PACK_FILES = /^(aimeat\/package\.json|aimeat\/pnpm-lock\.yaml|pnpm-lock\.yaml|aimeat\/scripts\/(pack-smoke|gen-shrinkwrap|copy-dist-assets|clean-dist|vendor-libs|write-build-stamp)\.mjs|aimeat\/scripts\/lib\/npm-shrinkwrap\.mjs|aimeat\/\.npmignore)$/;

export function planSteps(input: PlanInput): Step[] {
    const steps: Step[] = [];
    const perBackend = new Map<Backend, Map<string, string>>();
    const addSuite = (backend: Backend, suite: string, why: string): void => {
        const m = perBackend.get(backend) ?? new Map<string, string>();
        if (!m.has(suite)) m.set(suite, why);
        perBackend.set(backend, m);
    };
    const upgrade = new Map<Backend, string>();
    let pack: string | null = null;

    // 1. What the last nightly reported red.
    for (const job of input.failedJobs) {
        const reds = input.reds.get(job) ?? { suites: [] };
        const backend = jobBackend(job);
        if (job.startsWith('sweep')) {
            for (const s of reds.suites) addSuite(backend ?? 'sqlite', s, `red in the last nightly (${job})`);
        } else if (job.startsWith('upgrade-from-release')) {
            for (const b of backend ? [backend] : BACKENDS) upgrade.set(b, `red in the last nightly (${job})`);
        } else if (job.startsWith('pack-smoke')) {
            pack = `red in the last nightly (${job})`;
        } else if (job.startsWith('stripe-testmode')) {
            steps.push({ kind: 'skip', reason: `${job} was red: it needs the Stripe test keys, run \`pnpm test:stripe-testmode\` where they are set` });
        }
    }

    // 2. What changed since that run's commit.
    for (const file of input.changed) {
        const suite = /^aimeat\/test\/(e2e-[a-z0-9-]+)\.ts$/.exec(file)?.[1];
        if (suite) for (const b of BACKENDS) addSuite(b, suite, 'changed since the last nightly');
        if (file.startsWith('aimeat/src/storage/')) for (const b of BACKENDS) if (!upgrade.has(b)) upgrade.set(b, `storage changed since the last nightly (${file})`);
        if (PACK_FILES.test(file) && !pack) pack = `the package changed since the last nightly (${file})`;
    }

    for (const [backend, suites] of perBackend) {
        steps.push({ kind: 'e2e', backend, suites: [...suites.keys()], reason: [...new Set(suites.values())].join('; ') });
    }
    if (input.full) {
        steps.push({ kind: 'unit', reason: '--full: the whole unit suite' });
        for (const b of BACKENDS) if (!upgrade.has(b)) upgrade.set(b, '--full');
        if (!pack) pack = '--full';
    }
    for (const [backend, reason] of upgrade) steps.push({ kind: 'upgrade', backend, reason });
    if (pack) steps.push({ kind: 'pack-smoke', reason: pack });
    return steps;
}
