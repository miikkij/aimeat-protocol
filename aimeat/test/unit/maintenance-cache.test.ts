/**
 * @file test/unit/maintenance-cache.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's maintenance copy follows storage (a CLI stop reaches it after the re-read
 *   interval), never blocks a request on that read, and never lets a re-read that began before the
 *   operator's own switch undo the switch.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item A8).
 */
import { describe, it, expect } from 'vitest';
import { createMaintenanceCache } from '../../src/services/maintenance-cache.js';
import type { MaintenanceState } from '../../src/storage/interface.js';

const OFF: MaintenanceState = { enabled: false, message: '', enabledAt: null, enabledBy: null };
const ON: MaintenanceState = { enabled: true, message: 'cli', enabledAt: '2026-11-04T00:00:00.000Z', enabledBy: 'cli' };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createMaintenanceCache', () => {
  it('sees a change written to storage by another process after the interval, without waiting for it', async () => {
    let clock = 0;
    let stored = OFF;
    const cache = createMaintenanceCache(async () => stored, OFF, { rereadMs: 5000, now: () => clock });
    stored = ON;                         // `aimeat maintenance on` in another process
    expect(cache.get().enabled).toBe(false);
    clock = 4999;
    expect(cache.get().enabled).toBe(false);
    clock = 5000;
    expect(cache.get().enabled).toBe(false); // the request that starts the read is not held
    await tick();
    expect(cache.get().enabled).toBe(true);
    expect(cache.get().message).toBe('cli');
  });

  it('keeps the operator\'s switch when a read that began before it answers later', async () => {
    let clock = 0;
    let release: (s: MaintenanceState) => void = () => undefined;
    const cache = createMaintenanceCache(() => new Promise<MaintenanceState>((r) => { release = r; }), OFF, { rereadMs: 10, now: () => clock });
    clock = 10;
    cache.get();                         // a re-read starts and sees OFF
    cache.set(ON);                       // the operator switches it on
    release(OFF);
    await tick();
    expect(cache.get().enabled).toBe(true);
  });

  it('keeps the last known state when storage cannot answer', async () => {
    let clock = 0;
    const cache = createMaintenanceCache(async () => { throw new Error('db down'); }, ON, { rereadMs: 10, now: () => clock });
    clock = 10;
    cache.get();
    await tick();
    expect(cache.get().enabled).toBe(true);
  });

  it('starts one read at a time', async () => {
    let clock = 0;
    let reads = 0;
    const cache = createMaintenanceCache(() => { reads++; return new Promise<MaintenanceState>(() => undefined); }, OFF, { rereadMs: 10, now: () => clock });
    clock = 100;
    for (let i = 0; i < 50; i++) cache.get();
    expect(reads).toBe(1);
  });
});
