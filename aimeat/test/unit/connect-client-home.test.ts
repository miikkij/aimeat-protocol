/**
 * @file connect-client-home.test.ts
 * @description `aimeat connect client` in an empty home (feature-list audit #6). The command sets
 *   AIMEAT_HOME to the client's home after cli/connect/config.js may already be loaded; the
 *   connector home must follow that value, or the credential is written to <cwd>/.aimeat and the
 *   command ends with "No credential was stored" after the agent was created on the node. Also the
 *   summary's tool-surface lines: `--surface` is printed as used only when the adapter applied it.
 * @structure late AIMEAT_HOME · surfaceLines
 * @usage pnpm exec vitest run test/unit/connect-client-home.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #6).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { surfaceLines } from '../../src/cli/connect/clients/index.js';

const saved = process.env.AIMEAT_HOME;
afterEach(() => {
    if (saved === undefined) delete process.env.AIMEAT_HOME; else process.env.AIMEAT_HOME = saved;
});

describe('the connector home set after config.js is loaded', () => {
    it('getConfigDir() and the token store follow an AIMEAT_HOME set after the import', async () => {
        const first = mkdtempSync(join(tmpdir(), 'aimeat-home-a-'));
        const later = mkdtempSync(join(tmpdir(), 'aimeat-home-b-'));
        try {
            process.env.AIMEAT_HOME = first;
            vi.resetModules();
            const config = await import('../../src/cli/connect/config.js');
            const keychain = await import('../../src/cli/connect/keychain.js');
            expect(config.getConfigDir()).toBe(first);

            // What runConnectClient does: set the client's home, then authorize and store.
            process.env.AIMEAT_HOME = later;
            expect(config.getConfigDir()).toBe(later);
            await keychain.storeToken('goose', 'alice', 'tok-123');
            expect((await keychain.listAllTokens()).map(t => `${t.agent}@${t.owner}`)).toContain('goose@alice');
        } finally {
            rmSync(first, { recursive: true, force: true });
            rmSync(later, { recursive: true, force: true });
        }
    });
});

describe('the summary names the tool surface the adapter applied', () => {
    it('prints the surface when the adapter wrote it (Claude Desktop)', () => {
        expect(surfaceLines({ label: 'Claude Desktop' }, { surface: 'agent' }, { surface: 'agent' }))
            .toEqual(['  Tool surface : agent']);
    });

    it('prints full and a note when --surface was given to a client that does not take it', () => {
        const lines = surfaceLines({ label: 'Goose' }, { surface: 'agent' }, {});
        expect(lines[0]).toBe('  Tool surface : full');
        expect(lines[1]).toContain('--surface agent was not used');
    });

    it('prints full and nothing else when no surface was asked for', () => {
        expect(surfaceLines({ label: 'Goose' }, {}, {})).toEqual(['  Tool surface : full']);
    });
});
