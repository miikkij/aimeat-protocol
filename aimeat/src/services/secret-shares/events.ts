/**
 * @file src/services/secret-shares/events.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One event on a secret share: who acted (a person, an agent, or a code holder) and in
 *   whose name. The maker reads every event; a recipient reads their own pickups and the rest.
 *   An event never holds content, a code or a token.
 * @structure record
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import type { Storage } from '../../storage/interface.js';
import type { SecretShareEventKind } from '../../storage/types/secret-shares.js';
import type { CallerContext } from '../caller-context.js';
import { newEventId } from './rules.js';
import { logger } from '../../utils/logger.js';

/** Write one event. A failed write is logged and does not undo the act it records. */
export async function record(
  storage: Storage, shareId: string, kind: SecretShareEventKind, caller: CallerContext | null, detail: Record<string, string>,
): Promise<void> {
  try {
    await storage.addSecretShareEvent({
      id: newEventId(), shareId, at: new Date().toISOString(), kind,
      actor: caller?.principal ?? (kind === 'ended' ? 'node' : 'code'),
      onBehalfOf: caller?.ownerGhii ?? (kind === 'ended' ? 'node' : 'code'),
      detail,
    });
  } catch (err) {
    logger.warn('secret share: an event did not land', { shareId, kind, error: String(err) });
  }
}
