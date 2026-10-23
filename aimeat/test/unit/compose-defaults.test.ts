/**
 * @file test/unit/compose-defaults.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two compose files start a node nobody else can claim with a shared default: the
 *   admin password has no default (compose refuses to start without one), and PostgreSQL is published
 *   on loopback only. Until 2026-10-23 both files defaulted the admin password to `changeme`, which
 *   creates the first operator through POST /v1/admin/setup/register, and published PostgreSQL with
 *   its default account on every address of the host (secaudit2026oct22; Jouni, 2026-10-23).
 * @usage pnpm exec vitest run test/unit/compose-defaults.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (secaudit2026oct22).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['docker-compose.yml', 'docker-compose.sqlite.yml'];

interface Compose { services: Record<string, { environment?: string[]; ports?: string[] }> }
const load = (file: string): Compose => parse(readFileSync(join(ROOT, file), 'utf-8')) as Compose;

describe('compose files', () => {
    for (const file of FILES) {
        it(`${file}: the admin password is required, with no default`, () => {
            const env = load(file).services.aimeat.environment ?? [];
            const line = env.find(e => e.startsWith('AIMEAT_ADMIN_PASSWORD='));
            expect(line).toBeDefined();
            expect(line).toMatch(/^AIMEAT_ADMIN_PASSWORD=\$\{AIMEAT_ADMIN_PASSWORD:\?[^}]+\}$/);
        });
        it(`${file}: the node's own port is still published, so the setup wizard can be reached`, () => {
            expect(load(file).services.aimeat.ports).toEqual(['${AIMEAT_PORT:-40050}:40050']);
        });
    }

    it('docker-compose.yml: PostgreSQL is published on loopback only', () => {
        const ports = load('docker-compose.yml').services.postgres.ports ?? [];
        for (const p of ports) expect(p.startsWith('127.0.0.1:')).toBe(true);
    });
});
