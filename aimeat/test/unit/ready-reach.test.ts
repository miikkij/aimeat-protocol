/**
 * @file test/unit/ready-reach.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which E2E suites pnpm ready runs for a code change (scripts/lib/ready-reach.ts), read
 *   against this repository's own source and suites: a change picks the suites that call what it
 *   reaches and leaves the rest, and a change on every request's path runs the whole sweep.
 * @version-history
 *   v1.2.0 — 2026-11-25 — An openapi.yaml change is placed on the paths it changed.
 *   v1.1.0 — 2026-11-25 — The suites without the e2e- prefix are reachable.
 *   v1.0.0 — 2026-11-24 — Initial.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { codeReach, FULL_SWEEP, openapiChangedRoutes, registeredSuites } from '../../scripts/lib/ready-reach.js';

const repo = path.resolve(process.cwd(), '..');

describe('codeReach', () => {
  it('runs the whole sweep for a change on every request\'s path', () => {
    expect(codeReach(repo, ['aimeat/src/middleware/envelope.ts']).full).toMatch(/every request/);
    expect(codeReach(repo, ['aimeat/package.json']).full).not.toBeNull();
    expect(FULL_SWEEP.test('openapi.yaml')).toBe(false);
  });

  it('runs a few suites for a boot change, since every suite starts a node', () => {
    const r = codeReach(repo, ['aimeat/src/server-bootstrap/service-init.ts']);
    expect(r.full).toBeNull();
    expect(r.suites.length).toBeGreaterThan(0);
    expect(r.suites.length).toBeLessThan(10);
  });

  it('picks the federation suites for the federated sign-in check, and not the library suites', () => {
    const r = codeReach(repo, ['aimeat/src/services/federation/auth-consent.ts']);
    expect(r.full).toBeNull();
    expect(r.suites).toEqual(expect.arrayContaining(['e2e-federated-session', 'e2e-federation-peer-consent', 'e2e-federation-peer-bounds']));
    expect(r.suites).not.toContain('e2e-libs');
  });

  it('reaches the runner\'s suites without the e2e- prefix', () => {
    const suites = registeredSuites(path.join(repo, 'aimeat')).map(s => path.basename(s, '.ts'));
    expect(suites).toEqual(expect.arrayContaining(['federation-mesh', 'federation-multinode', 'api-full', 'e2e-libs']));
    const r = codeReach(repo, ['aimeat/src/services/federation/auth-consent.ts']);
    expect(r.suites).toEqual(expect.arrayContaining(['federation-mesh', 'federation-multinode']));
  });

  it('picks the library suites for a change in the served libraries\' registry, and not the federation suites', () => {
    const r = codeReach(repo, ['aimeat/src/data/library-packs/sdk-ui.ts']);
    expect(r.full).toBeNull();
    expect(r.suites).toContain('e2e-libs');
    expect(r.suites).not.toContain('e2e-federated-session');
  });

  it('matches a route by every fixed part of its path, not by its start alone', () => {
    // /v1/ghii/:ghii/credential: a suite that signs in (/v1/ghii/login) does not call it.
    const r = codeReach(repo, ['aimeat/src/services/vc-issuer.ts']);
    expect(r.full).toBeNull();
    expect(r.suites.length).toBeLessThan(40);
  });

  it('places an openapi.yaml change on the paths it changed, through the components they refer to', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aimeat-contract-'));
    try {
      const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
      const doc = (amount: string, scheme = 'bearer') => [
        'openapi: 3.1.0',
        'components:',
        '  securitySchemes:',
        `    token: { type: http, scheme: ${scheme} }`,
        '  schemas:',
        `    Money: { type: object, properties: { amount: { type: ${amount} } } }`,
        "    Order: { type: object, properties: { total: { $ref: '#/components/schemas/Money' } } }",
        'paths:',
        '  /v1/orders/{id}:',
        "    get: { responses: { '200': { content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } } } }",
        '  /v1/notes:',
        "    get: { responses: { '200': { description: ok } } }",
        '',
      ].join('\n');
      git('init', '-q');
      writeFileSync(path.join(dir, 'openapi.yaml'), doc('integer'));
      git('add', 'openapi.yaml');
      git('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'base');
      writeFileSync(path.join(dir, 'openapi.yaml'), doc('number'));
      expect(openapiChangedRoutes(dir, 'HEAD')).toEqual(['/v1/orders/:id']);
      writeFileSync(path.join(dir, 'openapi.yaml'), doc('integer', 'basic'));
      expect(openapiChangedRoutes(dir, 'HEAD')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs no node suite for the Python package', () => {
    expect(codeReach(repo, ['python/aimeat-crewai/src/aimeat_crewai/daemon.py'])).toEqual({ full: null, suites: [] });
  });
});
