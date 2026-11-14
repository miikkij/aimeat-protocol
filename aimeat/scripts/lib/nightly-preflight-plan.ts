/**
 * @file scripts/lib/nightly-preflight-plan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What `pnpm nightly:preflight` runs, chosen from two inputs: the failed-job log of the
 *   last nightly run (`gh run view <id> --log-failed`) and the files changed since that run's commit.
 *   Pure functions, so the selection is unit-tested without GitHub or git.
 *
 *   WHAT IS CHOSEN, and why each is enough:
 *     - every E2E suite and unit file the last nightly reported red, on the job's own backend and
 *       version: a fix that does not make the red one green locally will not make it green there;
 *     - every E2E suite file changed since that commit, on both backends, and under version 4.0.0
 *       when test/version-aware-suites.txt lists it: a changed suite is the likeliest new red;
 *     - the upgrade test on both backends when storage code changed (src/storage/), and the packed
 *       package's start when the dependency tree or the pack scripts changed;
 *     - with `full`: the release-4-0-0 job whole (version-aware suites and the unit suite under
 *       4.0.0), the upgrade test and the pack start, about twenty minutes.
 *   The sweep itself (every suite on both backends, about two hours here) is never chosen: that is
 *   the nightly's job, and the guard tier already runs on every push.
 * @structure
 *   - stripAnsi(text)
 *   - redFromLog(log) → per job: red E2E suites, red unit files
 *   - planSteps(input) → the steps, each with its reason
 * @usage import { redFromLog, planSteps } from './lib/nightly-preflight-plan.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: a local check before the nightly is started, after a manual run
 *     took an hour to report two failures a local run finds in minutes.
 */

export type Backend = 'sqlite' | 'postgres-kysely';
export const BACKENDS: Backend[] = ['sqlite', 'postgres-kysely'];

export function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\^\[\[[0-9;]*m/g, '');
}

export interface JobReds { suites: string[]; unitFiles: string[] }

/**
 * The red E2E suites and unit files per job in a `gh run view --log-failed` text. Each line is
 * `<job>\t<step>\t<timestamp> <text>`. The E2E runner closes with `##[error]<suite>` per red suite;
 * vitest prints ` FAIL  <project> test/unit/<file>.test.ts > ...`.
 */
export function redFromLog(log: string): Map<string, JobReds> {
    const jobs = new Map<string, JobReds>();
    for (const raw of log.split(/\r?\n/)) {
        const tab = raw.indexOf('\t');
        if (tab < 0) continue;
        const job = raw.slice(0, tab);
        const line = stripAnsi(raw);
        const entry = (): JobReds => {
            let e = jobs.get(job);
            if (!e) { e = { suites: [], unitFiles: [] }; jobs.set(job, e); }
            return e;
        };
        const suite = /##\[error\](e2e-[a-z0-9-]+)\s*$/.exec(line);
        if (suite) { const e = entry(); if (!e.suites.includes(suite[1])) e.suites.push(suite[1]); continue; }
        const unit = /\sFAIL\s+(?:\S+\s+)?(test\/unit\/[\w./-]+\.test\.ts)/.exec(line);
        if (unit) { const e = entry(); if (!e.unitFiles.includes(unit[1])) e.unitFiles.push(unit[1]); }
    }
    return jobs;
}

/** The backend a job runs on: `sweep (sqlite)`, `upgrade-from-release (postgres-kysely)`. */
export function jobBackend(job: string): Backend | null {
    const m = /\((sqlite|postgres-kysely)\)/.exec(job);
    return m ? (m[1] as Backend) : null;
}

export type Step =
    | { kind: 'e2e'; backend: Backend; suites: string[]; version?: string; reason: string }
    | { kind: 'e2e-list'; backend: Backend; file: string; version: string; reason: string }
    | { kind: 'unit'; files: string[]; version?: string; reason: string }
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
    /** The suite names in test/version-aware-suites.txt. */
    versionAware: string[];
    full: boolean;
}

const VERSION = '4.0.0';
const PACK_FILES = /^(aimeat\/package\.json|aimeat\/pnpm-lock\.yaml|pnpm-lock\.yaml|aimeat\/scripts\/(pack-smoke|gen-shrinkwrap|copy-dist-assets|clean-dist|vendor-libs|write-build-stamp)\.mjs|aimeat\/scripts\/lib\/npm-shrinkwrap\.mjs|aimeat\/\.npmignore)$/;

export function planSteps(input: PlanInput): Step[] {
    const steps: Step[] = [];
    const perBackend = new Map<Backend, Map<string, string>>();
    const addSuite = (backend: Backend, suite: string, why: string): void => {
        const m = perBackend.get(backend) ?? new Map<string, string>();
        if (!m.has(suite)) m.set(suite, why);
        perBackend.set(backend, m);
    };
    const v4Suites = new Map<string, string>();
    const unitFiles = new Map<string, string>();
    const upgrade = new Map<Backend, string>();
    let pack: string | null = null;

    // 1. What the last nightly reported red.
    for (const job of input.failedJobs) {
        const reds = input.reds.get(job) ?? { suites: [], unitFiles: [] };
        const backend = jobBackend(job);
        if (job.startsWith('sweep')) {
            for (const s of reds.suites) addSuite(backend ?? 'sqlite', s, `red in the last nightly (${job})`);
        } else if (job.startsWith('release-')) {
            for (const s of reds.suites) v4Suites.set(s, `red in the last nightly (${job})`);
            for (const f of reds.unitFiles) unitFiles.set(f, `red in the last nightly (${job})`);
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
        if (suite) {
            for (const b of BACKENDS) addSuite(b, suite, 'changed since the last nightly');
            if (input.versionAware.includes(suite)) v4Suites.set(suite, 'changed since the last nightly, and version-aware');
        }
        if (file.startsWith('aimeat/src/storage/')) for (const b of BACKENDS) if (!upgrade.has(b)) upgrade.set(b, `storage changed since the last nightly (${file})`);
        if (PACK_FILES.test(file) && !pack) pack = `the package changed since the last nightly (${file})`;
    }

    for (const [backend, suites] of perBackend) {
        steps.push({ kind: 'e2e', backend, suites: [...suites.keys()], reason: [...new Set(suites.values())].join('; ') });
    }
    if (input.full) {
        steps.push({ kind: 'e2e-list', backend: 'sqlite', file: 'test/version-aware-suites.txt', version: VERSION, reason: '--full: the release-4-0-0 job\'s suites' });
        steps.push({ kind: 'unit', files: [], version: VERSION, reason: '--full: the release-4-0-0 job\'s unit suite' });
        for (const b of BACKENDS) if (!upgrade.has(b)) upgrade.set(b, '--full');
        if (!pack) pack = '--full';
    } else {
        if (v4Suites.size) steps.push({ kind: 'e2e', backend: 'sqlite', suites: [...v4Suites.keys()], version: VERSION, reason: [...new Set(v4Suites.values())].join('; ') });
        if (unitFiles.size) steps.push({ kind: 'unit', files: [...unitFiles.keys()], version: VERSION, reason: [...new Set(unitFiles.values())].join('; ') });
    }
    for (const [backend, reason] of upgrade) steps.push({ kind: 'upgrade', backend, reason });
    if (pack) steps.push({ kind: 'pack-smoke', reason: pack });
    return steps;
}
