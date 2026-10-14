/**
 * @file src/storage/repositories/otk.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic repository interface for one-time keys (OTK): create and read. No
 *   route mints or redeems a key any more (the connectivity-key routes were removed on 2026-10-14);
 *   the rows already stored stay until their account is erased, which deletes them (deleteOwner).
 *
 * @structure
 *   - OtkRepository: createOtk/getOtk
 *
 * @version-history
 *   v1.1.0 — 2026-10-14 — consumeOtk removed with POST /v1/agents/connect, its only caller
 *     (feature-list audit row 202).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { OtkRecord } from '../interface.js';

export interface OtkRepository {
  createOtk(otk: OtkRecord): Promise<OtkRecord>;
  getOtk(key: string): Promise<OtkRecord | null>;
}
