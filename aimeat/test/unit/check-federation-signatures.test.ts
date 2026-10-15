/**
 * @file check-federation-signatures.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description QA audit S10-02: the federation signature gate chose its doors by file name
 *   (src/routes/federation*), so the four writing /v1/federation doors in routes/package-sales.ts were
 *   read by no gate, and check:route-scopes and the open-writes inventory skip every /v1/federation
 *   path. The gate now takes every write door whose path starts /v1/federation in any route file, and
 *   a handler that verifies through a function of its own file (sellerAct → verifySaleRequest) counts
 *   as signed. These cases prove both halves, and that a door losing its verification is "neither".
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-federation-signatures.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit S10-02).
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { federationDoors } from '../../scripts/check-federation-signatures.js';
import { srcProgram } from '../../scripts/inventory/program.js';

const AIMEAT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A route file the gate reads, written here, under a name that is not routes/federation*. */
function routeFile(name: string, text: string): ts.SourceFile {
    return ts.createSourceFile(resolve(AIMEAT, 'src', 'routes', name), text, ts.ScriptTarget.ES2022, true);
}

describe('the federation signature gate', () => {
    it('reads a /v1/federation write door in a file not named federation, and follows its helper to the verifier', () => {
        const doors = federationDoors([routeFile('package-x.ts', `
            export function r(router) {
                async function sellerAct(req, res) { const who = await verifySaleRequest(req.headers); return who; }
                router.put('/v1/federation/package-x/:id', async (req, res) => { const act = await sellerAct(req, res); });
                router.post('/v1/packages/x', requireAuth(), async (req, res) => {});
            }`)]);
        expect(doors.map(d => d.id)).toEqual(['PUT /v1/federation/package-x/:id']);
        expect(doors[0]).toMatchObject({ gated: false, verifies: true });
    });

    it('calls a door whose helper no longer verifies "neither"', () => {
        const doors = federationDoors([routeFile('package-y.ts', `
            export function r(router) {
                async function sellerAct(req, res) { return { nodeId: req.headers['x-source-node'] }; }
                router.delete('/v1/federation/package-y/:id', async (req, res) => { await sellerAct(req, res); });
            }`)]);
        expect(doors).toHaveLength(1);
        expect(doors[0]).toMatchObject({ gated: false, verifies: false });
    });

    it('counts every writing /v1/federation route of the real tree, the package repository doors included, as signed or gated', () => {
        const doors = federationDoors(srcProgram(/[/\\]src[/\\]routes[/\\]/).files);
        const sales = doors.filter(d => d.file.endsWith('src/routes/package-sales.ts'));
        expect(sales.map(d => d.id).sort()).toEqual([
            'DELETE /v1/federation/package-sales/:groupId/entitlements/:nodeId',
            'POST /v1/federation/package-claims/:groupId',
            'PUT /v1/federation/package-sales/:groupId/claims',
            'PUT /v1/federation/package-sales/:groupId/entitlements/:nodeId',
        ]);
        for (const d of sales) expect(d.verifies, `${d.id} verifies`).toBe(true);
    }, 180_000);
});
