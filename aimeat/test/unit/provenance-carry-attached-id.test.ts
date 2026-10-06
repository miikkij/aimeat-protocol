/**
 * @file test/unit/provenance-carry-attached-id.test.ts
 * @description carryDeclaration and an `ai_provenance_id` given alone. On a tool whose route reads
 *   the id from the write body (aimeat_memory_write) the echo says the record was attached. On a tool
 *   whose route reads no provenance at all (the not-carried list: board post and reply, the dm tools,
 *   message send, task complete and the rest) it answered `{ recorded: true, via: 'attached' }` for
 *   an id nothing read; it now answers `recorded: false` with the reason, as it does for a declaration
 *   on those tools (secaudit 2026-10 last items, F4).
 * @usage pnpm test -- provenance-carry-attached-id
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 last items, F4).
 */
import { describe, it, expect } from 'vitest';
import { carryDeclaration, CONNECTOR_PROVENANCE_CARRIERS } from '../../src/tool-dispatch/ai-provenance-carry.js';
import type { AimeatClient } from '../../src/tool-dispatch/api-client.js';

const noClient = {} as unknown as AimeatClient;

describe('an ai_provenance_id given alone', () => {
    it('is reported attached on a tool whose route reads it', async () => {
        const echo = await carryDeclaration(noClient, { tool: 'aimeat_memory_write', declaredId: 'prov-1' });
        expect(echo).toMatchObject({ recorded: true, id: 'prov-1', via: 'attached' });
    });

    it('is reported NOT recorded on every tool whose route reads no provenance', async () => {
        const notCarried = Object.entries(CONNECTOR_PROVENANCE_CARRIERS)
            .filter(([, c]) => c.kind === 'not-carried').map(([tool]) => tool);
        expect(notCarried).toContain('aimeat_board_post');
        for (const tool of notCarried) {
            const echo = await carryDeclaration(noClient, { tool, declaredId: 'prov-1' });
            expect(echo, tool).toMatchObject({ recorded: false, declared: { ai_provenance_id: 'prov-1' } });
            expect((echo as { reason: string }).reason, tool).toMatch(/ai_provenance_id/);
        }
    });

    it('is reported NOT recorded on a tool with no carrier at all', async () => {
        const echo = await carryDeclaration(noClient, { tool: 'aimeat_no_such_tool', declaredId: 'prov-1' });
        expect(echo).toMatchObject({ recorded: false });
    });
});
