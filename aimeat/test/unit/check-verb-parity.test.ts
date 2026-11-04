/**
 * @file test/unit/check-verb-parity.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description scripts/check-verb-parity.ts reads the guards each writing verb of a route path names
 *   and finds the paths where they differ (codebase analysis 2026-11-03, B4; security-architecture
 *   finding 12). A PUT and a DELETE of one path with different scope words differ; a body check and a
 *   rate limit are not guards; a middleware array constant counts as its elements; parameter names do
 *   not split a path.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-verb-parity.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B4).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routesOf, differences, pathKey } from '../../scripts/check-verb-parity.js';

const dir = mkdtempSync(join(tmpdir(), 'aimeat-verb-parity-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, source: string): string => { const p = join(dir, name); writeFileSync(p, source); return p; };

describe('check:verb-parity', () => {
  it('reads each writing verb\'s guards and leaves GET, the path and the handler out', () => {
    const routes = routesOf('x.ts', `
      router.get('/v1/things/:id', requireAuth(), async (req, res) => {});
      router.put('/v1/things/:id', requireAuth(), requireScope("things:write"), validateBody(S, config.nodeId), async (req, res) => {});
      router.delete('/v1/things/:name', requireAuth(), requireScope('things:delete'), handler);
    `);
    expect(routes.map(r => [r.verb, r.guards])).toEqual([
      ['PUT', ['requireAuth()', 'requireScope(\'things:write\')']],
      ['DELETE', ['requireAuth()', 'requireScope(\'things:delete\')']],
    ]);
    expect(pathKey('/v1/things/:id')).toBe(pathKey('/v1/things/:name'));
  });

  it('finds a path whose verbs differ, and not one that differs only by a body check, a rate limit or the spelling of an array', () => {
    const a = file('a.ts', `
      const opOnly = [requireAuth(), requireOperator(storage)];
      router.put('/v1/same/:id', ...opOnly, validateBody(S, n), rateLimit({ max: 5 }), async (req, res) => {});
      router.delete('/v1/same/:key', requireAuth(), requireOperator(storage), async (req, res) => {});
      router.patch('/v1/drift/:id', requireAuth(), requireScope('workflow:write'), async (req, res) => {});
      router.delete('/v1/drift/:id', requireAuth(), requireScope('memory:write'), async (req, res) => {});
    `);
    const { all, differ } = differences([a]);
    expect([...all.keys()].sort()).toEqual(['/v1/drift/:', '/v1/same/:']);
    expect([...differ.keys()]).toEqual(['/v1/drift/:']);
    expect(differ.get('/v1/drift/:')).toEqual({
      PATCH: ['requireAuth()', 'requireScope(\'workflow:write\')'],
      DELETE: ['requireAuth()', 'requireScope(\'memory:write\')'],
    });
  });

  it('counts a file-wide router.use guard on every route of the file', () => {
    const routes = routesOf('y.ts', `
      router.use(requireAuth(), requireOperator(storage));
      router.post('/v1/admin/x', async (req, res) => {});
    `);
    expect(routes[0]!.guards).toEqual(['requireAuth()', 'requireOperator(storage)']);
  });
});
