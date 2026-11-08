/**
 * @file test/unit/workspace-manifest-backfill.test.ts
 * @description A create's objectTypes-only manifest gets each space's defaults, as add_spaces does:
 *   aimeat_workspace_create says such a manifest is accepted on the first call, and a real build on
 *   aimeat.io (2026-11-08) was refused for a missing schemaRef. A value the caller gives still wins.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-manifest-backfill.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { backfillManifestEnvelope } from '../../src/services/workspace-meta.js';

describe('backfillManifestEnvelope', () => {
    it('fills each space\'s defaults the way add_spaces does', () => {
        const m = backfillManifestEnvelope({ objectTypes: [{ name: 'items', namespace: 'shared.items', mode: 'records' }] }, { orgId: 'org-1', fallbackName: 'Lists' });
        const ot = (m.objectTypes as Array<Record<string, unknown>>)[0];
        expect(ot).toMatchObject({ name: 'items', namespace: 'shared.items', mode: 'records', schemaRef: 'schema:items@1', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true });
        expect(m).toMatchObject({ id: 'org-1', name: 'Lists', kind: 'project', status: 'active', manifestVersion: '1.0' });
    });

    it('keeps what the caller gave, and a row space unversioned with no mode', () => {
        const m = backfillManifestEnvelope({ objectTypes: [
            { name: 'notes', namespace: 'shared.notes', kind: 'document', schemaRef: 'schema:mine@2', writeRole: 'admin' },
            { name: 'log', namespace: 'shared.log', backing: 'rows' },
        ] }, { orgId: 'org-1' });
        const [notes, log] = m.objectTypes as Array<Record<string, unknown>>;
        expect(notes).toMatchObject({ mode: 'document', schemaRef: 'schema:mine@2', writeRole: 'admin' });
        expect(log).toMatchObject({ backing: 'rows', versioned: false });
        expect(log.mode).toBeUndefined();
    });
});
