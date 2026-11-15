/**
 * @file test/run-e2e-plan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which suites run where: the split of a run over GitHub jobs (`--shard=i/N`) and over
 *   the lanes of one machine (`--workers=N`), balanced by each suite's measured time, and the list of
 *   suites that never reach the runner's own node.
 *
 *   WHY (docs/internal report of 2026-11-15, section 4). The nightly of 2026-11-14 took 46.5 min on
 *   SQLite and 59.1 min on PostgreSQL, and half of every lane's time was the node restart between
 *   suites. Lane 0 was the critical path: every suite that writes a port of its own (131 of them) was
 *   put there, so lane 0 ran 34 min of suites while lanes 1 to 3 ran 12 to 16 min and then waited.
 *   That rule dates from 2026-09-05. Since 2026-10-11 a suite's own ports are taken under a lock every
 *   runner on the machine honours (scripts/lib/e2e-ports.ts acquirePortLocks), so two lanes can no
 *   longer bind one fixed port at once whatever the plan says. What is left of the old reason is
 *   that two suites sharing a port would wait for each other; they are kept in one lane instead
 *   (portGroups), and the lanes are filled longest suite first (LPT) from test/e2e-suite-times.json.
 *
 *   NO RUNNER NODE. RUNNER_NODE_FREE names the suites that start every node they talk to themselves
 *   and never read E2E_BASE, the runner's port or its database. The runner skips the node start for
 *   them (it still stops the previous node and empties the database, so the lane's database is as
 *   fresh as before), and points their E2E_BASE at a port nothing listens on, so a suite on this list
 *   that does reach the runner's node fails at once instead of passing against a stale one.
 *   checkRunnerNodeFree() refuses a listed suite whose source names E2E_BASE or a helper that reads
 *   it, so the list cannot rot quietly.
 * @structure RUNNER_NODE_FREE · checkRunnerNodeFree() · suiteSeconds() · portGroups() · shardOf() ·
 *   planLanesBalanced() · parseShard()
 * @usage Imported by test/run-e2e-ci.ts. Not a suite.
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial: balanced lanes without the lane-0 pin, `--shard=i/N`, and the
 *     suites that need no runner node (report of 2026-11-15, 4.2.1, 4.2.2 and 4.2.4).
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Suites that never reach the runner's node. Each was found by reading its source (no E2E_BASE, no
 * 40251, no server-db, no helper that reads either) and then run with no runner node on both backends.
 */
export const RUNNER_NODE_FREE: readonly string[] = [
    'e2e-account-events-task-keep',
    'e2e-ai-capabilities',
    'e2e-ai-catalog',
    'e2e-ai-ecosystem-caller',
    'e2e-ai-embed',
    'e2e-ai-extension-provider',
    'e2e-ai-gen-rules',
    'e2e-ai-input-reach',
    'e2e-ai-jobs',
    'e2e-ai-node-key-metering',
    'e2e-ai-openrouter-region',
    'e2e-ai-provider-allowlist',
    'e2e-ai-provider-stub',
    'e2e-ai-roles',
    'e2e-anonymous-records-incident',
    'e2e-app-access',
    'e2e-app-frame',
    'e2e-app-origin',
    'e2e-app-parties',
    'e2e-app-scope-allowance',
    'e2e-app-silent',
    'e2e-atomic-access',
    'e2e-atomic-content-b',
    'e2e-atomic-money',
    'e2e-attachment-sweep',
    'e2e-auth-tarpit',
    'e2e-boot-lock',
    'e2e-boot-port-in-use',
    'e2e-catalogue-classification',
    'e2e-chat-agent',
    'e2e-classification-defaults',
    'e2e-config-setting-fallback',
    'e2e-consent-publish-gate',
    'e2e-contact-picker',
    'e2e-content-access-browser',
    'e2e-content-access-gate',
    'e2e-content-class',
    'e2e-core-jobs',
    'e2e-email-delivery',
    'e2e-exchange-mcp',
    'e2e-federation-book',
    'e2e-federation-contact-link',
    'e2e-federation-nodeinfo',
    'e2e-federation-peer-limits',
    'e2e-federation-policy',
    'e2e-federation-relay-claim',
    'e2e-federation-settlements-sync',
    'e2e-federation-visiting',
    'e2e-genesis-federation',
    'e2e-graceful-shutdown',
    'e2e-held-account-names',
    'e2e-iam-parties',
    'e2e-install-set-grants',
    'e2e-install-sets',
    'e2e-key-reencrypt',
    'e2e-magic-link-refusal',
    'e2e-magic-link-return',
    'e2e-mailbox-push',
    'e2e-mcp-orientation',
    'e2e-mcp-warn-only-scopes',
    'e2e-money-audit',
    'e2e-money-path-races',
    'e2e-operator-admin-migration',
    'e2e-own-key-roads',
    'e2e-pacing',
    'e2e-package-repository',
    'e2e-package-sale',
    'e2e-page-access',
    'e2e-party-invite',
    'e2e-peer-registration-proof',
    'e2e-portfolio-origin',
    'e2e-portfolio-read-hold',
    'e2e-presence',
    'e2e-proactive-mode',
    'e2e-production-posture',
    'e2e-public-feed-exposure',
    'e2e-publish-request-bin-takeover',
    'e2e-publish-request-content-swap',
    'e2e-rest-scope-keep-working',
    'e2e-sealed-config',
    'e2e-search-visibility',
    'e2e-setup-code',
    'e2e-sign-in-policy',
    'e2e-single-process-lease',
    'e2e-sse',
    'e2e-test-money-guard',
    'e2e-two-process-bus',
    'e2e-two-process-leases',
    'e2e-unattended-publish-gate',
    'e2e-workspace-transfer-gates',
];

/** Source text that means a suite talks to the runner's node or opens its database. */
const READS_RUNNER = /E2E_BASE|\b40251\b|helpers\/(server-db|connect-cli|purpose-kit|oauth-round|verified-email)\.js/;

/** The listed suites whose source reads the runner's node: each one is a list entry gone wrong. */
export function checkRunnerNodeFree(suitePaths: string[]): string[] {
    const listed = new Set(RUNNER_NODE_FREE);
    const wrong: string[] = [];
    for (const p of suitePaths) {
        const name = basename(p, '.ts');
        if (!listed.has(name) || !existsSync(p)) continue;
        if (READS_RUNNER.test(readFileSync(p, 'utf-8'))) wrong.push(name);
    }
    return wrong;
}

export function needsRunnerNode(name: string): boolean {
    return !RUNNER_NODE_FREE.includes(name);
}

type Times = Record<string, Record<string, number>>;
let times: Times | null = null;

/**
 * A suite's measured seconds on `dbType`, from test/e2e-suite-times.json. A suite the file does not
 * know (a new one) counts as the median, which is what a new suite usually costs.
 */
export function suiteSeconds(name: string, dbType: string): number {
    if (!times) {
        const file = fileURLToPath(new URL('./e2e-suite-times.json', import.meta.url));
        try { times = JSON.parse(readFileSync(file, 'utf-8')) as Times; } catch { times = {}; }
    }
    const table = times[dbType] ?? times.sqlite ?? {};
    const known = table[name];
    if (typeof known === 'number') return known;
    const all = Object.values(table).sort((a, b) => a - b);
    return all.length ? all[Math.floor(all.length / 2)] : 3;
}

/**
 * Suites that write down a common port, joined into one group (union-find over `pinned`). A group
 * runs in one lane and one shard, so its members never wait on each other's port lock.
 */
export function portGroups(suites: string[], pinned: Map<string, number[]>): string[][] {
    const parent = new Map<string, string>(suites.map(s => [s, s]));
    const find = (s: string): string => {
        let r = s;
        while (parent.get(r) !== r) r = parent.get(r)!;
        parent.set(s, r);
        return r;
    };
    const byPort = new Map<number, string>();
    for (const s of suites) {
        for (const p of pinned.get(s) ?? []) {
            const other = byPort.get(p);
            if (other === undefined) byPort.set(p, s);
            else parent.set(find(s), find(other));
        }
    }
    const groups = new Map<string, string[]>();
    for (const s of suites) {
        const r = find(s);
        groups.set(r, [...(groups.get(r) ?? []), s]);
    }
    return [...groups.values()];
}

/**
 * Longest-processing-time first: the heaviest group goes to the bin that is lightest so far. Ties
 * are broken by name and by bin index, so every machine computes the same plan from the same input,
 * which `--shard` depends on: four GitHub jobs each compute the whole plan and keep their own bin.
 */
function lpt(groups: string[][], bins: number, weight: (s: string) => number): string[][] {
    const load = Array<number>(bins).fill(0);
    const out: string[][] = Array.from({ length: bins }, () => []);
    const w = (g: string[]) => g.reduce((a, s) => a + weight(s), 0);
    const sorted = [...groups].sort((a, b) => w(b) - w(a) || a[0].localeCompare(b[0]));
    for (const g of sorted) {
        let best = 0;
        for (let k = 1; k < bins; k++) if (load[k] < load[best]) best = k;
        out[best].push(...g);
        load[best] += w(g);
    }
    return out;
}

/**
 * What a suite costs a lane: its own time plus the node start in front of it, which a suite on
 * RUNNER_NODE_FREE does not have.
 */
export function laneWeight(name: string, dbType: string, restartSeconds: number): number {
    return suiteSeconds(name, dbType) + (needsRunnerNode(name) ? restartSeconds : 0.5);
}

/** `--shard=2/4` → { index: 1, count: 4 }; null when not given. Exits on a malformed value. */
export function parseShard(argv: string[]): { index: number; count: number } | null {
    const arg = argv.find(a => a.startsWith('--shard='));
    if (!arg) return null;
    const m = /^(\d+)\/(\d+)$/.exec(arg.slice('--shard='.length));
    const index = m ? Number(m[1]) : NaN;
    const count = m ? Number(m[2]) : NaN;
    if (!m || count < 1 || index < 1 || index > count) {
        console.error(`--shard must be i/N with 1 <= i <= N, got "${arg.slice('--shard='.length)}"`);
        process.exit(1);
    }
    return { index: index - 1, count };
}

/** The suites of shard `index` of `count`, in the order the run asked for them. */
export function shardOf(suites: string[], shard: { index: number; count: number }, pinned: Map<string, number[]>, weight: (s: string) => number): string[] {
    if (shard.count === 1) return suites;
    const names = new Map(suites.map(s => [basename(s, '.ts'), s]));
    const groups = portGroups(suites, pinned).map(g => g.map(s => basename(s, '.ts')));
    const mine = new Set(lpt(groups, shard.count, weight)[shard.index]);
    return suites.filter(s => mine.has(basename(s, '.ts')) && names.has(basename(s, '.ts')));
}

/** The lanes of one machine: groups kept whole, filled longest first. */
export function planLanesBalanced(suites: string[], workers: number, pinned: Map<string, number[]>, weight: (s: string) => number): string[][] {
    if (workers <= 1) return [suites];
    const groups = portGroups(suites, pinned);
    return lpt(groups, workers, s => weight(basename(s, '.ts'))).filter(l => l.length > 0);
}
