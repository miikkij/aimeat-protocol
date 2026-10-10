/**
 * @file test/unit/node-update-prompt-backup.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The update prompt's backup step names the node key file and the keys set outside
 *   `.env`, for every storage backend. Since the 2026-10-09 secrets audit the identity key's database
 *   copy is encrypted, so a backup of the database and `.env` alone could leave a node that cannot
 *   start with its own identity when the keys came from somewhere else.
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { buildNodeUpdatePrompt } from '../../src/services/node-update-prompt.js';

const base = {
    current: '3.25.0', latest: '3.26.0', releasedAt: null, baseUrl: 'http://localhost:40050',
    install: { method: 'npm' as const, packageDir: null, workingDir: '/srv/aimeat' }, sqlitePath: './data/aimeat.db',
};

describe('the backup step of the update prompt', () => {
    for (const storage of ['sqlite', 'postgres-kysely', 'memory']) {
        it(`names the key file and the keys outside .env (${storage})`, () => {
            const text = buildNodeUpdatePrompt({ ...base, storage });
            expect(text).toContain('node-key.json');
            expect(text).toContain('AIMEAT_KEY_PASSPHRASE');
            expect(text).toContain('AIMEAT_ENCRYPTION_KEY');
            expect(text).toMatch(/do not change any of them/);
        });
    }
});
