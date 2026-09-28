/**
 * @file test/unit/install-set-startup.test.ts
 * @description What the start-up install set logs when a file it reads is wrong. The secrets file's
 *   problem is named and its text is not: Node's JSON parse error quotes the start of the input, and
 *   in that file the start is a secret (CodeQL js/clear-text-logging, alert 1674). The install set
 *   itself holds no secrets, so its error is logged whole, with the path.
 * @usage pnpm test -- install-set-startup
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyStartupInstallSet } from '../../src/services/install-set-startup.js';
import { logger } from '../../src/utils/logger.js';
import type { ApplyDeps } from '../../src/services/install-set-apply.js';
import type { AimeatConfig } from '../../src/config.js';

const SECRET = 'sk-live-abc123-very-secret';
let dir: string;

const deps = (installSetPath: string, installSetSecretsPath: string | null): ApplyDeps =>
  ({ config: { installSetPath, installSetSecretsPath, testMode: true } as unknown as AimeatConfig, storage: {}, peers: new Map() }) as unknown as ApplyDeps;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'install-set-startup-'));
  writeFileSync(join(dir, 'set.json'), '{}');
  writeFileSync(join(dir, 'secrets.json'), `${SECRET} is not JSON`);
  writeFileSync(join(dir, 'broken-set.json'), '{"owner": oops}');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

describe('the start-up install set logs a file it cannot use', () => {
  it('a secrets file that is not JSON is named by its problem, and none of its text is logged', async () => {
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    await applyStartupInstallSet(deps(join(dir, 'set.json'), join(dir, 'secrets.json')));
    const logged = errors.mock.calls.map(c => JSON.stringify(c)).join('\n');
    expect(logged).toMatch(/AIMEAT_INSTALL_SET_SECRETS is not JSON/);
    expect(logged).not.toContain('sk-live');
  });

  it('a secrets file that cannot be read is named by its problem', async () => {
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    await applyStartupInstallSet(deps(join(dir, 'set.json'), join(dir, 'missing.json')));
    expect(errors.mock.calls.map(c => String(c[0])).join('\n')).toMatch(/AIMEAT_INSTALL_SET_SECRETS cannot be read/);
  });

  it('an install set that is not JSON is logged with its path and the error text', async () => {
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    await applyStartupInstallSet(deps(join(dir, 'broken-set.json'), null));
    const logged = errors.mock.calls.map(c => String(c[0])).join('\n');
    expect(logged).toContain('broken-set.json is not JSON');
    expect(logged).toMatch(/SyntaxError/);
  });
});
