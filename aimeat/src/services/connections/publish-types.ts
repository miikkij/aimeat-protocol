/**
 * @file publish-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The interface every publish recipe shares: what it is handed and what it answers.
 *   Moved out of publish.ts on 2026-10-15 so the recipes in publish-social.ts and publish-x-long.ts
 *   can name it without importing the file that registers them (dependency-cruiser counts a type
 *   import as an edge, and that pair would have been a cycle). publish.ts re-exports all three, so
 *   every existing import keeps working.
 * @structure PublishInput · PublishOutcome · PublishRecipe
 * @usage import type { PublishRecipe } from './publish-types.js';
 * @version-history
 *   v1.0.0 — 2026-10-15 — Moved from publish.ts unchanged, with `publicBase` added to PublishInput.
 */

import type { ConnectionCredential, ConnectionRecord } from '../../models/connection-schemas.js';
import type { OutboundProvider } from './providers.js';

/** What a recipe is handed. `params` already has the delegation's fixed values layered on top. */
export interface PublishInput {
  /** The provider descriptor, so a recipe reads its own endpoints instead of being handed them. */
  provider: OutboundProvider;
  connection: ConnectionRecord;
  credential: ConnectionCredential;
  caption: string;
  params: Record<string, unknown>;
  file: { bytes: Buffer; mimeType: string; name: string } | null;
  /**
   * The node's public base address, for a recipe whose provider FETCHES the file rather than taking
   * it in the request (Instagram). Absent means no such address, and that recipe refuses.
   */
  publicBase?: string;
}

export type PublishOutcome =
  | { ok: true; externalRef: string }
  | {
    ok: false;
    /**
     * True when the provider refused the CONTENT or the grant — retrying changes nothing and the
     * owner has to act. False for anything transport-shaped, which is worth another attempt.
     */
    permanent: boolean;
    reason: string;
  };

export type PublishRecipe = (input: PublishInput) => Promise<PublishOutcome>;
