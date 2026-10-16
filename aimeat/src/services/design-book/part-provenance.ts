/**
 * @file src/services/design-book/part-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which provenance record each Design Book part carries, for the read routes that show
 *   a part to a person (GET /v1/designbook and /v1/designbook/:id).
 *
 *   A part's title, summary and body are text people read in the gallery, and propose() stamps
 *   them like every other write (service.ts): an agent's part carries a record that says a model
 *   wrote it. The read routes handed the parts out without it, so the AI label a public part owes
 *   could not be shown anywhere. The parts are public memory rows of the node's system identity,
 *   so this reads only their keys and the record id on each, in one query for the whole shelf.
 * @structure partProvenanceIds(storage, config, ids)
 * @usage const ids = await partProvenanceIds(storage, config, rows.map(r => r.id));
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (the AI label on every public page).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { systemGhiiFor } from '../compliance-register.js';
import { PART_KEY_PREFIX, partKey } from './service.js';

/** Part id → the provenance record id its stored row carries; parts without one are absent. */
export async function partProvenanceIds(storage: Storage, config: AimeatConfig, ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const wanted = new Map(ids.map(id => [partKey(id), id]));
    const rows = await storage.listMemory(systemGhiiFor(config.nodeId), { prefix: PART_KEY_PREFIX, tags: ['designbook'] });
    for (const row of rows) {
        const id = wanted.get(row.key);
        if (id && row.aiProvenanceId) out.set(id, row.aiProvenanceId);
    }
    return out;
}
