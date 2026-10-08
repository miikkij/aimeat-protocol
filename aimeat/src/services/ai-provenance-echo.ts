/**
 * @file src/services/ai-provenance-echo.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a write route tells its caller about the provenance it was sent (aiprov E7, E8,
 *   E12). A route that records a declaration itself answers with this block, so the connector and
 *   the CLI dispatch pass it through instead of declaring a second time after the write
 *   (tool-dispatch/ai-provenance-carry.ts, `recorded-by-route`).
 *
 *   The shape is the connector's ProvenanceEcho: `{ recorded, id, via, record, record_url, level,
 *   human_involvement, principal }`, which is the read surfaces' `{ id, record, record_url }` with
 *   three facts added. aimeat-crewai's read_provenance() keys off `record.spec`, so a crew reads a
 *   write result with the parser it reads everything else with.
 *
 *   An id that did not attach (not the caller's own, or no such record) is `recorded: false` with
 *   the reason, never `recorded: true`: the write carries the node's own answer instead, and the
 *   caller has to be able to see that.
 * @structure provenanceWriteEcho(storage, config, input)
 * @usage
 *   ...(await provenanceWriteEcho(storage, config, { storedId: record.aiProvenanceId, declared, declaredId }))
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (aiprov E7, E8, E12).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { DeclaredProvenance } from './ai-provenance.js';
import { loadServedProvenance } from './ai-provenance-marks.js';

/**
 * `{ ai_provenance: echo }` when the caller declared something or named an id, `{}` when it said
 * nothing (a write that declares nothing gets no echo, as on the connector before).
 */
export async function provenanceWriteEcho(
  storage: Storage, config: AimeatConfig,
  input: { storedId: string | null | undefined; declared?: DeclaredProvenance; declaredId?: string },
): Promise<{ ai_provenance: Record<string, unknown> } | Record<string, never>> {
  if (!input.declared && !input.declaredId) return {};
  const attached = !!input.declaredId && input.storedId === input.declaredId;
  if (input.declaredId && !attached && !input.declared) {
    return {
      ai_provenance: {
        recorded: false,
        declared: { ai_provenance_id: input.declaredId },
        reason: `Record ${input.declaredId} was NOT attached: only a record of your own account can be attached. `
          + (input.storedId ? `The write carries the node's own record ${input.storedId} instead.` : 'The write carries no record.'),
      },
    };
  }
  const served = await loadServedProvenance(storage, config, input.storedId, { full: true });
  if (!served) return {};
  const generator = (served.record.generator ?? {}) as { principal?: string };
  return {
    ai_provenance: {
      recorded: true,
      id: served.id,
      via: attached ? 'attached' : 'declared',
      record: served.record,
      record_url: served.recordUrl,
      level: served.record.level,
      human_involvement: served.record.humanInvolvement,
      ...(generator.principal ? { principal: generator.principal } : {}),
    },
  };
}
