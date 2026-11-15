/**
 * @file test/unit/e2e-run-plan.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The E2E runner's plan (test/run-e2e-plan.ts): `--shard=i/N` splits the suites so that
 *   the shards together run every suite exactly once, every machine computes the same split, suites
 *   that write down a common port stay in one lane, and the lanes are balanced by measured time
 *   rather than by count. Also the list of suites that need no runner node refuses an entry whose
 *   source reads the runner's node.
 * @usage pnpm exec vitest run test/unit/e2e-run-plan.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial (report of 2026-11-15, 4.2.1, 4.2.2 and 4.2.4).
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRunnerNodeFree, planLanesBalanced, portGroups, RUNNER_NODE_FREE, shardOf, suiteSeconds } from '../run-e2e-plan.js';

const suites = Array.from({ length: 40 }, (_, i) => `test/e2e-s${String(i).padStart(2, '0')}.ts`);
const weight = (name: string): number => 1 + (Number(name.slice(-2)) % 7) * 3;

describe('--shard=i/N', () => {
    it('runs every suite exactly once across the shards', () => {
        const parts = [0, 1, 2, 3].map(index => shardOf(suites, { index, count: 4 }, new Map(), weight));
        const all = parts.flat();
        expect(all.length).toBe(suites.length);
        expect(new Set(all)).toEqual(new Set(suites));
    });

    it('is the same split on every machine and keeps the order the run asked for', () => {
        const a = shardOf(suites, { index: 2, count: 4 }, new Map(), weight);
        const b = shardOf([...suites], { index: 2, count: 4 }, new Map(), weight);
        expect(a).toEqual(b);
        expect(a).toEqual(suites.filter(s => a.includes(s)));
    });

    it('balances the shards by time, not by count', () => {
        const loads = [0, 1, 2, 3].map(index => shardOf(suites, { index, count: 4 }, new Map(), weight)
            .reduce((n, s) => n + weight(s.replace(/^test\/|\.ts$/g, '')), 0));
        expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(19); // at most one heaviest suite apart
    });
});

describe('lanes', () => {
    it('keeps suites that write down one port in one lane', () => {
        const pinned = new Map<string, number[]>([[suites[0], [28100]], [suites[9], [28100, 28200]], [suites[20], [28200]]]);
        expect(portGroups(suites, pinned).find(g => g.includes(suites[0]))).toEqual(expect.arrayContaining([suites[0], suites[9], suites[20]]));
        const lanes = planLanesBalanced(suites, 4, pinned, s => weight(s.replace(/^.*\/|\.ts$/g, '')));
        const lane = lanes.find(l => l.includes(suites[0]))!;
        expect(lane).toEqual(expect.arrayContaining([suites[9], suites[20]]));
        expect(lanes.flat().length).toBe(suites.length);
    });

    it('no longer puts every suite with a port of its own into lane 0', () => {
        const pinned = new Map<string, number[]>(suites.slice(0, 20).map((s, i) => [s, [28000 + i]]));
        const lanes = planLanesBalanced(suites, 4, pinned, () => 1);
        expect(lanes.every(l => l.length === 10)).toBe(true);
    });
});

describe('suite times', () => {
    it('counts a suite the table does not know as the median', () => {
        const median = suiteSeconds('e2e-a-suite-nobody-has-measured', 'sqlite');
        expect(median).toBeGreaterThan(0);
        expect(median).toBeLessThan(30);
    });
});

describe('RUNNER_NODE_FREE', () => {
    it('refuses a listed suite whose source reads E2E_BASE', () => {
        const name = RUNNER_NODE_FREE[0];
        if (!name) return;
        const dir = mkdtempSync(join(tmpdir(), 'aimeat-plan-'));
        const file = join(dir, `${name}.ts`);
        writeFileSync(file, "const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';\n");
        expect(checkRunnerNodeFree([file])).toEqual([name]);
        writeFileSync(file, "const BASE = 'http://127.0.0.1:28123';\n");
        expect(checkRunnerNodeFree([file])).toEqual([]);
    });

    it('holds no suite twice', () => {
        expect(new Set(RUNNER_NODE_FREE).size).toBe(RUNNER_NODE_FREE.length);
    });
});
