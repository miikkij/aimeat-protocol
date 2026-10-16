/**
 * @file src/routes/organisms/share-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes a workspace share is described in, and what a share hands out. Moved out
 *   of shared.ts unchanged so the public collectors (services/workspace-public-collectors.ts, once
 *   routes/organisms/shared-public.ts) can name them without importing shared.ts, which imports
 *   them (an import cycle, check:deps). shared.ts re-exports them, so no importer changes.
 * @structure ShareAccess · ShareMeta · ResolvedShare · PublicDoc · PublicRecord
 * @usage import type { ResolvedShare } from './share-types.js';
 * @version-history
 *   v1.3.0 — 2026-10-16 — `until` on the share (end dates); `kind`, `namespace` and `html` on a public
 *     document that is an HTML page.
 *   v1.2.0 — 2026-10-13 — icsKeyHash on the share: the feed key of the ICS rendering.
 *   v1.1.0 — 2026-10-08 — PublicDoc and PublicRecord carry the row's aiProvenanceId (aiprov E1).
 *   v1.0.0 — 2026-09-29 — Moved from routes/organisms/shared.ts (TARGET-082 V1).
 */

export type ShareAccess = 'open' | 'password' | 'account';
/** `icsKeyHash`: the SHA-256 of the feed key that opens the ICS rendering of a shared records space
 *  to a calendar program, which cannot sign in or send a share token (services/calendar-feed.ts). */
/** `until`: when a target stops being shared, keyed `*` (the workspace), `space:<name>` or
 *  `<space>/<id>`, as an ISO date (services/workspace-share.ts isDocPublicAt). */
export type ShareMeta = {
  public?: boolean; spaces?: Record<string, boolean>; docs?: Record<string, boolean>;
  access?: ShareAccess; passwordHash?: string | null; icsKeyHash?: string | null;
  until?: Record<string, string>;
};
export type ResolvedShare = {
  public: boolean; spaces: Record<string, boolean>; docs: Record<string, boolean>;
  access: ShareAccess; passwordHash: string | null; icsKeyHash: string | null;
  until: Record<string, string>;
};
/** `aiProvenanceId`: the provenance record the published row carries, which the route serves as the
 *  item's `ai_provenance` block (and never as this field). `kind`, `namespace` and `html` are set on an
 *  HTML page (services/html-page.ts): the route turns them into the page's frame address. */
export type PublicDoc = {
  type: string; id: string; title: string; markdown: string; aiProvenanceId?: string | null;
  kind?: 'html'; namespace?: string; html?: string;
};
export type PublicRecord = { type: string; id: string; value: unknown; aiProvenanceId?: string | null };
