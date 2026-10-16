/**
 * @file test/unit/toolchain-pins.test.ts
 * @description One version of each tool, named once. The root and aimeat/ package.json pinned two
 *   different pnpm versions, so corepack ran a different pnpm in each folder from one lockfile, and
 *   the Dockerfile pinned a third copy by hand; the PostgreSQL version CI runs was named nowhere a
 *   reader would look. This test holds the copies to each other and the CI images to the range the
 *   node states it supports (src/storage/providers/postgres-kysely/server-version.ts).
 * @usage pnpm exec vitest run test/unit/toolchain-pins.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-12).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_POSTGRES_MAJOR, TESTED_POSTGRES_MAJORS } from '../../src/storage/providers/postgres-kysely/server-version.js';

const AIMEAT = process.cwd();
const ROOT = join(AIMEAT, '..');
const json = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;

describe('toolchain pins', () => {
    const rootPm = json(join(ROOT, 'package.json')).packageManager as string;
    const pnpmVersion = /^pnpm@([\d.]+)/.exec(rootPm)?.[1];

    it('both package.json files pin the same pnpm', () => {
        expect(pnpmVersion).toBeTruthy();
        expect(json(join(AIMEAT, 'package.json')).packageManager).toBe(rootPm);
    });

    it('the Dockerfile prepares that pnpm', () => {
        const docker = readFileSync(join(AIMEAT, 'Dockerfile'), 'utf8');
        expect(/corepack prepare pnpm@([\d.]+)/.exec(docker)?.[1]).toBe(pnpmVersion);
    });

    it('both package.json files ask the same Node', () => {
        const a = (json(join(ROOT, 'package.json')).engines as { node?: string } | undefined)?.node;
        const b = (json(join(AIMEAT, 'package.json')).engines as { node?: string } | undefined)?.node;
        expect(b).toBe(a);
    });

    it('every PostgreSQL image CI and compose run is the supported floor', () => {
        const files = ['.github/workflows/ci.yml', '.github/workflows/e2e-full.yml', 'aimeat/docker-compose.yml']
            .map(f => join(ROOT, f)).filter(existsSync);
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) {
            for (const m of readFileSync(f, 'utf8').matchAll(/image:\s*postgres:(\d+)/g)) {
                expect(Number(m[1]), f).toBe(MIN_POSTGRES_MAJOR);
                expect(TESTED_POSTGRES_MAJORS).toContain(Number(m[1]));
            }
        }
    });
});
