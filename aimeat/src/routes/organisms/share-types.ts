/**
 * @file src/routes/organisms/share-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes a workspace share is described in, and what a share hands out. Moved out
 *   of shared.ts unchanged so shared-public.ts can name them without importing shared.ts, which
 *   imports it (an import cycle, check:deps). shared.ts re-exports them, so no importer changes.
 * @structure ShareAccess · ShareMeta · ResolvedShare · PublicDoc · PublicRecord
 * @usage import type { ResolvedShare } from './share-types.js';
 * @version-history
 *   v1.1.0 — 2026-10-08 — PublicDoc and PublicRecord carry the row's aiProvenanceId (aiprov E1).
 *   v1.0.0 — 2026-09-29 — Moved from routes/organisms/shared.ts (TARGET-082 V1).
 */

export type ShareAccess = 'open' | 'password' | 'account';
export type ShareMeta = {
  public?: boolean; spaces?: Record<string, boolean>; docs?: Record<string, boolean>;
  access?: ShareAccess; passwordHash?: string | null;
};
export type ResolvedShare = {
  public: boolean; spaces: Record<string, boolean>; docs: Record<string, boolean>;
  access: ShareAccess; passwordHash: string | null;
};
/** `aiProvenanceId`: the provenance record the published row carries, which the route serves as the
 *  item's `ai_provenance` block (and never as this field). */
export type PublicDoc = { type: string; id: string; title: string; markdown: string; aiProvenanceId?: string | null };
export type PublicRecord = { type: string; id: string; value: unknown; aiProvenanceId?: string | null };
