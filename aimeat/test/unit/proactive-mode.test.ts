/**
 * @file proactive-mode.test.ts
 * @description The proactive-guidance setting, against real in-memory SQLite.
 *
 *   The E2E suite proves the setting end to end through the routes and the MCP handshake. What it
 *   cannot reach is the failure path, and that is the reason this file exists: a storage read that
 *   throws must read as the default rather than propagate, because this value is consulted during
 *   the MCP handshake and an exception there would cost a connection over a preference.
 *
 *   It also pins the two shapes the surface depends on: absent means ON with `defaulted` true, and
 *   `by` is never guessed — a record that does not say who acted reports null rather than 'person'.
 * @usage cd aimeat && pnpm exec vitest run test/unit/proactive-mode.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-22 — Initial.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import {
  readProactiveMode, writeProactiveMode, proactiveGuidance, PROACTIVE_KEY,
} from '../../src/services/proactive-mode.js';
import { PROACTIVE_GUIDANCE_TEXT } from '../../src/services/prompt-defaults/proactive.js';

const OWNER = 'alice';
const NODE = 'node';
const cfg = (proactiveGuidanceEnabled = true) =>
  ({ nodeId: NODE, proactiveGuidanceEnabled } as unknown as AimeatConfig);

let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

describe('the setting', () => {
  it('is on for an account that never chose, and says it is the default', async () => {
    const mode = await readProactiveMode(storage, cfg(), OWNER);
    expect(mode.enabled).toBe(true);
    expect(mode.defaulted).toBe(true);
    expect(mode.setBy).toBeNull();
    expect(mode.setAt).toBeNull();
  });

  it('records who acted, and stops calling it the default', async () => {
    const off = await writeProactiveMode(storage, cfg(), OWNER, false, 'ai');
    expect(off.enabled).toBe(false);
    expect(off.defaulted).toBe(false);
    expect(off.setBy).toBe('ai');
    expect(typeof off.setAt).toBe('string');
  });

  it('never guesses `by`: a record that does not say reports null', async () => {
    // What an AI writing the key through the memory API leaves behind if it omits the field.
    const now = new Date().toISOString();
    await storage.setMemory({
      key: PROACTIVE_KEY, ownerGaii: `${OWNER}@${NODE}`, value: { enabled: false },
      visibility: 'owner', tags: ['settings'], ttlHours: null, version: 1,
      createdAt: now, updatedAt: now,
    });
    const mode = await readProactiveMode(storage, cfg(), OWNER);
    expect(mode.enabled).toBe(false);
    expect(mode.setBy).toBeNull();     // not 'person' — nobody knows who did it
  });

  it('treats a value that is neither on nor off as no choice at all', async () => {
    const now = new Date().toISOString();
    await storage.setMemory({
      key: PROACTIVE_KEY, ownerGaii: `${OWNER}@${NODE}`, value: { enabled: 'yes' },
      visibility: 'owner', tags: ['settings'], ttlHours: null, version: 1,
      createdAt: now, updatedAt: now,
    });
    const mode = await readProactiveMode(storage, cfg(), OWNER);
    expect(mode.enabled).toBe(true);
    expect(mode.defaulted).toBe(true);
  });
});

describe('the operator switch', () => {
  it('overrules an owner who asked for it', async () => {
    await writeProactiveMode(storage, cfg(false), OWNER, true, 'person');
    const mode = await readProactiveMode(storage, cfg(false), OWNER);
    expect(mode.enabled).toBe(false);        // what actually happens
    expect(mode.ownerChoice).toBe(true);     // what the account asked for
    expect(mode.availableHere).toBe(false);  // and why they differ
  });

  it('withholds the guidance from everybody', async () => {
    expect(await proactiveGuidance(storage, cfg(false), OWNER)).toBeNull();
  });
});

describe('the guidance text', () => {
  it('is served while the setting is on', async () => {
    const text = await proactiveGuidance(storage, cfg(), OWNER);
    expect(text).toBe(PROACTIVE_GUIDANCE_TEXT);
  });

  it('is withheld once the setting is off', async () => {
    await writeProactiveMode(storage, cfg(), OWNER, false, 'person');
    expect(await proactiveGuidance(storage, cfg(), OWNER)).toBeNull();
  });

  it('is null rather than an error when there is no owner to read it for', async () => {
    expect(await proactiveGuidance(storage, cfg(), undefined)).toBeNull();
  });
});

describe('when storage misbehaves', () => {
  /** A storage whose reads throw, which is what a connecting agent must survive. */
  const broken = () => ({
    getMemory: async () => { throw new Error('database is on fire'); },
    getSystemPrompt: async () => { throw new Error('database is still on fire'); },
  } as unknown as Storage);

  it('reads as the default instead of throwing', async () => {
    const mode = await readProactiveMode(broken(), cfg(), OWNER);
    expect(mode.enabled).toBe(true);
    expect(mode.defaulted).toBe(true);
  });

  it('gives no guidance rather than failing the handshake', async () => {
    // The whole point: a preference must never be able to refuse a connection.
    await expect(proactiveGuidance(broken(), cfg(), OWNER)).resolves.toBeNull();
  });
});
