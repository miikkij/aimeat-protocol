/**
 * @file src/routes/memory-hands.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How many hands have been on a memory key, and whose.
 *
 *   `GET /v1/memory/:key/hands` answers about ONE record — the question a deletion request arrives
 *   asking, and the one nothing on this node could answer before: a key gets rewritten, the value
 *   changes, and who touched it was never written down anywhere.
 *
 *   Owner-scoped and read-only. The tally holds no values, only names and counts, but who has been
 *   writing to an account is that account's business, so it is resolved against the caller's own
 *   identity and never a supplied one.
 *
 *   EVERY ANSWER CARRIES WHAT IT DOES NOT COVER. The tally started on the day it shipped, so a key
 *   written before that and never written since has no hands recorded and never will — and it counts
 *   the doors a PRINCIPAL comes through, not the hundred places the node writes to memory on its own
 *   behalf. A count that hides either of those reads as complete when it is not, which is the exact
 *   failure the data map exists to prevent, so both travel with the number.
 * @structure memoryHandsRouter(config, storage)
 * @usage mounted in server-bootstrap/routes-loader.ts
 * @version-history
 *   2026-10-22 — The answer comes from handsOnKey, the function MCP aimeat_memory_hands calls, and follows the owner-scope read rule: an agent without memory:read-as-owner gets no row for a record of the owner or a sibling agent that GET /v1/memory/:key answers as absent, and an ecosystem app or a visitor gets its own namespace only. A `note` says what such an answer leaves out (secaudit 2026-10, v88).
 *   2026-10-15 — The hands from all the caller's namespaces are sorted by last_at, newest first, as openapi.yaml states (feature-list audit #50).
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 10.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { TALLY_DOORS } from '../services/data-map/write-tally-buffer.js';
import { handsOnKey } from '../services/data-map/data-map-access.js';

/** Said the same way wherever a tally number is rendered, so the number is never read as complete. */
const NOT_COVERED = [
  'Counting started when this was switched on. A key written before that and never written since has no hands here, and never will.',
  'It counts what came in through a door somebody was behind. AIMEAT also writes to your store on its own, and that is not a hand.',
];

export function memoryHandsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/memory/:key/hands — who has written to this key, and how often.
  router.get('/v1/memory/:key/hands', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const key = req.params.key as string;
    // Resolved from the caller's own session, never from anything they supplied: there is no key to
    // name here that reaches an account the caller is not in.
    //
    // OWNER SCOPE, because a namespace is not an account: an agent writing its own copy of a key
    // lands under the AGENT's namespace. Which namespaces this caller gets, and which of their rows,
    // is the owner-scope read rule GET /v1/memory/:key applies, decided once in handsOnKey
    // (services/data-map/data-map-access.ts), which MCP aimeat_memory_hands calls too (secaudit
    // 2026-10, v88).
    const out = await handsOnKey(storage, config, callerOf(req, config.nodeId, storage), key);

    res.json(success(config.nodeId, {
      key,
      hands: out.hands.map(h => ({
        writer: h.writer,
        writes: h.writes,
        deletes: h.deletes,
        first_at: h.firstAt,
        last_at: h.lastAt,
        namespace: h.namespace,
      })),
      counted_doors: TALLY_DOORS,
      not_covered: NOT_COVERED,
      ...(out.note ? { note: out.note } : {}),
    }));
  });

  return router;
}
