/**
 * @file test/unit/install-set-startup.test.ts
 * @description What the start-up install set logs when a file it reads is wrong. The secrets file's
 *   problem is named and its text is not: Node's JSON parse error quotes the start of the input, and
 *   in that file the start is a secret (CodeQL js/clear-text-logging, alert 1674). The install set
 *   itself holds no secrets, so its error is logged whole, with the path.
 *   How long it waits before trying again: a bundle the repository does not serve this node yet is
 *   tried every 30 s for the first ten minutes, because the store grants a new node its entitlement
 *   one to two minutes after the node is live, and a one-minute-then-five-minute wait made a new
 *   place's apps arrive at 5 min instead of 2 (aimeat-commercial, 2026-10-07).
 * @usage pnpm test -- install-set-startup
 * @version-history
 *   v1.1.0 — 2026-10-08 — The retry schedule after BUNDLE_UNAVAILABLE and after other refusals.
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const applyInstallSet = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/install-set-apply.js', () => ({ applyInstallSet }));
// The schedule tests run on a fake clock, which does not wait for disk I/O, so they read the set from
// here; the file tests read real files.
const readFile = vi.hoisted(() => ({ fake: null as string | null }));
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real, readFile: (...a: Parameters<typeof real.readFile>) => readFile.fake !== null ? Promise.resolve(readFile.fake) : real.readFile(...a) };
});

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

describe('the start-up install set tries again on a schedule', () => {
  const refused = (code: string) => ({ ok: false, status: 502, code, message: 'SOURCE_REFUSED: the repository answered 403' });
  const prodDeps = () => ({ config: { installSetPath: join(dir, 'set.json'), installSetSecretsPath: null, testMode: false }, storage: {}, peers: new Map() }) as unknown as ApplyDeps;
  /** The delays the node announced, in seconds, in the order it announced them. */
  const announced = (info: ReturnType<typeof vi.spyOn>) =>
    info.mock.calls.map(c => /trying again in (\d+) s/.exec(String(c[0]))?.[1]).filter(Boolean).map(Number);

  beforeEach(() => { readFile.fake = '{}'; });
  afterEach(() => { vi.useRealTimers(); applyInstallSet.mockReset(); readFile.fake = null; });

  it('a bundle the repository does not serve yet is tried every 30 s for ten minutes, then on the long schedule', async () => {
    vi.useFakeTimers();
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    applyInstallSet.mockResolvedValue(refused('BUNDLE_UNAVAILABLE'));
    await applyStartupInstallSet(prodDeps());
    for (let i = 0; i < 21; i++) await vi.advanceTimersByTimeAsync(30_000);
    const delays = announced(info);
    expect(delays.slice(0, 20)).toEqual(Array(20).fill(30));
    expect(delays[20]).toBe(60);
    expect(applyInstallSet).toHaveBeenCalledTimes(21);
  });

  it('the grant landing between two tries is picked up within 30 s', async () => {
    vi.useFakeTimers();
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    vi.spyOn(logger, 'info').mockImplementation(() => logger);
    applyInstallSet.mockResolvedValueOnce(refused('BUNDLE_UNAVAILABLE')).mockResolvedValueOnce(refused('BUNDLE_UNAVAILABLE'))
      .mockResolvedValue({ ok: true, dry_run: true });
    await applyStartupInstallSet(prodDeps());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(applyInstallSet).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(applyInstallSet).toHaveBeenCalledTimes(3);
  });

  it('another refusal that may pass keeps the long schedule, and a final one is not tried again', async () => {
    vi.useFakeTimers();
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    applyInstallSet.mockResolvedValue(refused('PEER_UNREACHABLE'));
    await applyStartupInstallSet(prodDeps());
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(announced(info)).toEqual([60, 300]);

    info.mockClear();
    applyInstallSet.mockReset().mockResolvedValue(refused('INVALID_BUNDLE'));
    await vi.runOnlyPendingTimersAsync();
    expect(announced(info)).toEqual([]);
  });
});
