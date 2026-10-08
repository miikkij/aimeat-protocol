/**
 * @file memory-batch-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Commit accepted batch rows with their provenance; restores retain source attribution.
 * @structure writeMemoryBatch
 * @version-history
 *   1.2.1 2026-10-08 A row's provenance record states its medium (text or data).
 *   1.2.0 2026-10-08 The import check accepts a source record whose hash matches the value in its
 *     canonical form or in the form it was written in (utils/memory-content.ts), so a backup taken on
 *     Postgres, where JSONB reorders object keys, keeps its provenance on restore (aiprov E4).
 *   1.1.0 2026-09-29 Rows that landed are scheduled for write-time classification
 *     (services/classify-on-write.ts, TARGET-082 V3).
 *   1.0.0 2026-09-27 Share the existing batch storage and provenance services.
 */
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { MemoryDbService, BulkWriteItem, BulkWriteOptions } from './db/memory-db-service.js';
import { provenanceForWrite, storeHeldProvenance } from './ai-provenance.js';
import { memoryContentBytes, memoryContentHashes } from '../utils/memory-content.js';
import { mediaKindOfValue } from '../models/ai-provenance-schemas.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { classifyAfterWrite } from './classify-on-write.js';

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
  const result = await storage.transaction(async () => {
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
            // Either hash form matches: the canonical one new records carry, or the as-written one
            // a record minted before 2026-10-08 carries (utils/memory-content.ts).
            if (source?.ownerGhii === ownerGhiiOf(caller.principal)
              && !!source.contentHash && memoryContentHashes(record.value).includes(source.contentHash)) {
              record.aiProvenanceId = source.id;
            }
          }
          return;
        }
        for (const record of records) {
          record.aiProvenanceId = await provenanceForWrite(provenanceStorage, {
            principal: caller.principal, content: memoryContentBytes(record.value),
            mediaKind: mediaKindOfValue(record.value),
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
  // Write-time classification of every row that landed (TARGET-082 V3): scheduled after the
  // transaction committed, never awaited, and nothing while classification is off.
  if (config.classificationMode !== 'off') {
    const values = new Map(items.map(item => [item.key, item.value]));
    for (const row of result.items) {
      if (row.status === 'created' || row.status === 'updated') {
        classifyAfterWrite({ storage, config }, caller.targetGaii, row.key, values.get(row.key));
      }
    }
  }
  return result;
}
