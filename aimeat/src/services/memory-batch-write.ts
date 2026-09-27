/**
 * @file memory-batch-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Commit accepted batch rows with their provenance; restores retain source attribution.
 * @structure writeMemoryBatch
 * @version-history 1.0.0 2026-09-27 Share the existing batch storage and provenance services.
 */
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { MemoryDbService, BulkWriteItem, BulkWriteOptions } from './db/memory-db-service.js';
import { provenanceForWrite, storeHeldProvenance, contentHashOf } from './ai-provenance.js';
import { memoryContentBytes } from '../utils/memory-content.js';
import { ownerGhiiOf } from '../utils/gaii.js';

export async function writeMemoryBatch(
  deps: { storage: Storage; config: AimeatConfig; memoryDb: MemoryDbService },
  caller: { principal: string; targetGaii: string },
  items: BulkWriteItem[],
  opts: BulkWriteOptions,
  kind: 'bulk' | 'import',
) {
  const { storage, config, memoryDb } = deps;
  const held: AiProvenanceRecordRow[] = [];
  // The principal is constant for the request. Do not repeat its model lookup for each row.
  let agent: ReturnType<Storage['getAgent']> | undefined;
  const provenanceStorage = new Proxy(storage, {
    get(target, prop) {
      if (prop === 'getAgent') return (principal: string) =>
        principal === caller.principal ? agent ??= target.getAgent(principal) : target.getAgent(principal);
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const supplied = new Map(items.map(item => [item.key, item.aiProvenanceId]));
  return storage.transaction(async () => {
    const result = await memoryDb.writeMany(caller.targetGaii, items, {
      ...opts,
      prepare: async (records, existing) => {
        if (opts.prepare) await opts.prepare(records, existing);
        if (kind === 'import') {
          // Importing is transport, not authorship. A same-node, same-account handle must also
          // describe these bytes. An absent/unverifiable source remains unstated.
          const ids = [...new Set(records.map(row => supplied.get(row.key) ?? existing.get(row.key)?.aiProvenanceId)
            .filter((id): id is string => !!id))];
          const sources = new Map((ids.length ? await storage.getAiProvenanceMany(ids) : []).map(row => [row.id, row]));
          for (const record of records) {
            const id = supplied.get(record.key) ?? existing.get(record.key)?.aiProvenanceId;
            const source = id ? sources.get(id) : undefined;
            if (source?.ownerGhii === ownerGhiiOf(caller.principal)
              && source.contentHash === contentHashOf(memoryContentBytes(record.value))) {
              record.aiProvenanceId = source.id;
            }
          }
          return;
        }
        for (const record of records) {
          record.aiProvenanceId = await provenanceForWrite(provenanceStorage, {
            principal: caller.principal, content: memoryContentBytes(record.value),
            pipeline: 'memory.bulk', surface: { visibility: record.visibility, humanAudience: true },
            labelPolicy: config.aiLabelPublic, nodeId: config.nodeId, baseUrl: config.baseUrl,
            enabled: config.aiProvenance, held,
          });
        }
      },
    });
    await storeHeldProvenance(storage, held);
    return result;
  });
}
