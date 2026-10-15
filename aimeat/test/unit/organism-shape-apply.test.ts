/**
 * @file test/unit/organism-shape-apply.test.ts
 * @description applyOrganismShape() names the workspaces of a shape it could not create, with a
 *   reason, beside the ones it made. Until 2026-10-15 a failed workspace showed only in the log and
 *   the create answered 201 with nothing to say a workspace was missing (feature-list audit #56).
 * @usage cd aimeat && pnpm exec vitest run test/unit/organism-shape-apply.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #56).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
let failAt = new Set<number>();
let failWith: () => Error = () => new Error('disk full');

vi.mock('../../src/services/workspace-provision.js', async (orig) => {
    const real = await orig<typeof import('../../src/services/workspace-provision.js')>();
    return {
        ...real,
        provisionWorkspace: async (_s: unknown, _c: unknown, input: { name: string }) => {
            const i = calls.length;
            calls.push(input.name);
            if (failAt.has(i)) throw failWith();
            return { ws: `ws-${i}`, types: [], schemas_locked: [] };
        },
    };
});

import { applyOrganismShape } from '../../src/services/organism-shape-apply.js';
import { shapeById } from '../../src/data/organism-shapes.js';
import { WorkspaceProvisionError } from '../../src/services/workspace-provision.js';

const deps = { storage: {} as never, config: { nodeId: 'test-node' } as never };

describe('applyOrganismShape', () => {
    beforeEach(() => { calls.length = 0; failAt = new Set(); failWith = () => new Error('disk full'); });

    it('every workspace made: notCreated is empty', async () => {
        const shape = shapeById('company')!;
        const out = await applyOrganismShape(deps, 'org-1', 'alice', shape, 'en');
        expect(out.made).toHaveLength(shape.workspaces.length);
        expect(out.notCreated).toEqual([]);
    });

    it('a workspace that fails is named in notCreated with its place and a plain reason', async () => {
        const shape = shapeById('company')!;
        expect(shape.workspaces.length).toBeGreaterThan(1);
        failAt = new Set([1]);
        const out = await applyOrganismShape(deps, 'org-1', 'alice', shape, 'en');
        expect(out.made).toHaveLength(shape.workspaces.length - 1);
        expect(out.notCreated).toHaveLength(1);
        expect(out.notCreated[0].index).toBe(1);
        expect(out.notCreated[0].name).toBe(calls[1]);
        // A storage failure's own text stays in the log.
        expect(out.notCreated[0].reason).not.toContain('disk full');
        expect(out.notCreated[0].reason).toMatch(/could not save/);
    });

    it('a manifest refusal carries the provisioning service\'s own sentence', async () => {
        failAt = new Set([0]);
        failWith = () => new WorkspaceProvisionError('manifest must be an object with an objectTypes array.');
        const out = await applyOrganismShape(deps, 'org-1', 'alice', shapeById('team')!, 'en');
        expect(out.notCreated[0].reason).toBe('manifest must be an object with an objectTypes array.');
    });
});
