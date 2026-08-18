/**
 * @file src/storage/repositories/otk.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic repository interface for one-time keys (OTK) — create, single-use
 *   consume (with optional grace window), and session-scoped listing/expiry that storage providers implement.
 *
 * @structure
 *   - OtkRepository: createOtk/getOtk/consumeOtk + listOtksBySession/expireSessionOtks
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { OtkRecord } from '../interface.js';

export interface OtkRepository {
  createOtk(otk: OtkRecord): Promise<OtkRecord>;
  getOtk(key: string): Promise<OtkRecord | null>;
  consumeOtk(key: string, graceMs?: number): Promise<OtkRecord | null>;
  listOtksBySession(sessionId: string): Promise<OtkRecord[]>;
  expireSessionOtks(sessionId: string): Promise<number>;
}
