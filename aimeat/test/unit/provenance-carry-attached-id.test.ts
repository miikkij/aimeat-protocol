/**
 * @file test/unit/provenance-carry-attached-id.test.ts
 * @description carryDeclaration and an `ai_provenance_id` given alone. On a tool whose route reads
 *   the id from the write body (aimeat_memory_write, and the not-carried tools marked `readsId`) the
 *   echo says the record was attached. On a tool whose route reads no provenance at all (board post
 *   and reply, the dm tools, message send, task complete and the rest) it answered
 *   `{ recorded: true, via: 'attached' }` for an id nothing read; it now answers `recorded: false`
 *   with the reason, as it does for a declaration on those tools (secaudit 2026-10 last items, F4).
 * @usage pnpm test -- provenance-carry-attached-id
 * @version-history
 *   v1.2.0 — 2026-10-08 — Board post and reply, the dm tools, message send, task complete and
 *     exchange delivery are recorded-by-route (aiprov D2, D5): an id given alone is reported
 *     attached. The not-carried sample is aimeat_workspace_comment.
 *   v1.1.0 — 2026-10-06 — The four not-carried tools whose route reads the id (design book propose
 *     and adopt, app draft publish, surface layout set) are reported attached; F4 had told them the
 *     id went nowhere (audit of the last items, finding 4).
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 last items, F4).
 */
import { describe, it, expect } from 'vitest';
import { carryDeclaration, CONNECTOR_PROVENANCE_CARRIERS } from '../../src/tool-dispatch/ai-provenance-carry.js';
import type { AimeatClient } from '../../src/tool-dispatch/api-client.js';

const noClient = {} as unknown as AimeatClient;

/** The dispatch definition forwards ai_provenance_id and the route reads it from the body. */
const READS_ID = ['aimeat_designbook_propose', 'aimeat_designbook_adopt', 'aimeat_app_draft_publish', 'aimeat_surface_layout_set'];

describe('an ai_provenance_id given alone', () => {
    it('is reported attached on a tool whose route reads it', async () => {
        const echo = await carryDeclaration(noClient, { tool: 'aimeat_memory_write', declaredId: 'prov-1' });
        expect(echo).toMatchObject({ recorded: true, id: 'prov-1', via: 'attached' });
    });

    it('is reported attached on the not-carried tools whose route reads the id', async () => {
        for (const tool of READS_ID) {
            const echo = await carryDeclaration(noClient, { tool, declaredId: 'prov-1' });
            expect(echo, tool).toMatchObject({ recorded: true, id: 'prov-1', via: 'attached' });
        }
    });

    it('is reported attached on a tool whose route records provenance itself', async () => {
        // Board post and reply, the dm tools, message send and task complete read the id from the
        // body since 2026-10-08 (aiprov D5), and the dispatch definitions send it.
        for (const tool of ['aimeat_board_post', 'aimeat_dm_send', 'aimeat_task_complete', 'aimeat_exchange_work_deliver']) {
            expect(CONNECTOR_PROVENANCE_CARRIERS[tool]?.kind, tool).toBe('recorded-by-route');
            const echo = await carryDeclaration(noClient, { tool, declaredId: 'prov-1' });
            expect(echo, tool).toMatchObject({ recorded: true, id: 'prov-1', via: 'attached' });
        }
    });

    it('is reported NOT recorded on every other tool whose route reads no provenance', async () => {
        const notCarried = Object.entries(CONNECTOR_PROVENANCE_CARRIERS)
            .filter(([tool, c]) => c.kind === 'not-carried' && !READS_ID.includes(tool)).map(([tool]) => tool);
        // aimeat_workspace_comment left this list on 2026-10-08: POST /v1/organisms/:id/comments
        // records the declaration itself (aiprov E8). Knowledge contribute has no REST route.
        expect(notCarried).toContain('aimeat_knowledge_contribute');
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
