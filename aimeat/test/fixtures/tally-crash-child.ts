/**
 * @file tally-crash-child.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Owned child process paused after durable memory and before tally persistence.
 * @version-history 1.0.0 2026-09-27 Deterministic crash window fixture.
 */
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { initWriteTallyBuffer, recordMemoryTouch } from '../../src/services/data-map/write-tally-buffer.js';
const storage = new SqliteStorage(process.argv[2]);
const now = new Date().toISOString();
await storage.setMemory({ ownerGaii: 'owner@crash-test', key: 'crash.persisted', value: 'durable',
  visibility: 'private', tags: [], version: 1, ttlHours: null, createdAt: now, updatedAt: now });
// Model an I/O request that has not reached storage yet. Neither grain may finish before the kill.
storage.upsertMemoryWriteTally = () => new Promise<void>(() => {});
storage.upsertMemoryFamilyTally = () => new Promise<void>(() => {});
initWriteTallyBuffer(storage);
recordMemoryTouch({ ownerGaii: 'owner@crash-test', key: 'crash.persisted', writerPrincipal: 'agent#owner@crash-test', kind: 'write' });
process.send?.('memory-committed-tally-pending');
setInterval(() => {}, 1000); // Parent owns and terminates this child without graceful shutdown.
