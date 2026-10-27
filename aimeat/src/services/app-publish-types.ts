/**
 * @file src/services/app-publish-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The input shapes of publishApp (services/app-publish.ts). A pure extraction
 *   when app-publish.ts reached the 800-line ceiling; app-publish.ts re-exports every type, so no
 *   importer changed.
 * @structure RequestedManifest · PublishAppInput · PublishAppRefusal
 * @usage import type { PublishAppInput } from './app-publish.js';
 * @version-history
 *   v1.1.0 — 2026-10-27 — PublishAppInput.publishingApp, the app whose grant publishes (secaudit2026oct26).
 *   v1.0.0 — 2026-10-25 — Moved unchanged from services/app-publish.ts.
 */
import type { AppManifest, AppProtection } from '../storage/interface.js';
import type { DeclaredProvenance } from './ai-provenance.js';
import type { PublishAsk } from './publish-requests/ask.js';


/**
 * The manifest fields a caller may state. **`undefined` means "not mentioned"** and is filled from
 * the live app; it never means "clear". Every door maps its own payload onto this one shape, so the
 * carry-forward list is written once instead of once per door.
 */
export interface RequestedManifest {
  name?: string;
  description?: string;
  descriptions?: Record<string, string>;
  version?: string;
  category?: string;
  tags?: string[];
  icon?: string;
  usesCortex?: string[];
  /** Already validated against CrewDefSchema by the door. `[]` clears the section explicitly. */
  cortexAgents?: Record<string, unknown>[];
  /** The pacing amount: `0` clears it explicitly; `undefined` carries the live one forward. */
  tollMorsels?: number;
  licenseType?: AppManifest['licenseType'];
  /** Already run through sanitizeProtection() by the door. */
  protection?: AppProtection;
}

export interface PublishAppInput {
  roadmap?: string;
  /** Bare owner name — the display/URL form. Never the @node-suffixed GHII. */
  ownerName: string;
  /** The canonical app bucket key. Apps are OWNER-scoped whoever publishes them. */
  ownerGhii: string;
  /** WHO pressed publish, resolved server-side: GHII, GAII or GEAI. Audit + provenance principal. */
  callerGaii: string;
  /**
   * The app (`<author>/<filename>`) whose grant publishes, when the caller is a role-'app' token:
   * stamped as `manifest.publishedByApp` (services/app-published-by-app.ts). Server-resolved.
   */
  publishingApp?: string;
  filename: string;
  data: Buffer;
  mimeType: string;
  requested: RequestedManifest;
  /**
   * `explicit` uses the value verbatim (the inline door, whose body carries `access_code`);
   * `carry` keeps whatever the live app has (the presigned and draft doors, which cannot express
   * one). Two modes rather than one nullable value, because "the caller sent nothing" and "the
   * caller asked for no access code" are different acts and conflating them is how a re-publish
   * silently unprotects an app.
   */
  accessCode: { mode: 'explicit'; value?: string } | { mode: 'carry' };
  /**
   * Which door this came through. Recorded in the change-log line so a reader can tell them apart.
   *
   * `package-install` is the app component of a package being registered. It is a publish in every
   * way that matters — the same lints, the same provenance, its own address, the dependency map
   * refreshed — with three announcements muted, because installing a copy of something that already
   * exists is not the event those announcements are for, and a six-app package would put six rows in
   * a feed that stops being read at that point. See `announces` below.
   */
  source: 'inline' | 'presigned' | 'draft' | 'package-install';
  /** The publish gate's answer for the caller, asked by the door (null: a package install). Read on a first publish only (app-publish-gate.ts). */
  publishGate: PublishAsk | null;
  /** A provenance record the caller asked to attach — checked against their own account. */
  declaredProvenanceId?: string;
  /** What the caller said about how the bytes were made. Absent + non-human principal → MINT-3. */
  declaredProvenance?: DeclaredProvenance;
  /** The build-spec digest the caller says they built against (services/app-spec-gate.ts). */
  specToken?: string;
  /** `skipped-by-owner` when the owner decided to publish without the spec. Recorded, not silent. */
  specAck?: string;
  /** A NEW app counts against the per-owner quota. Always on; the parameter exists for tests. */
  enforceQuota?: boolean;
}

/** A refusal the door turns into its own error envelope. */
export interface PublishAppRefusal {
  refusal: {
    status: number; code: string; message: string;
    /** Machine-readable reasons, for a refusal whose remedy is per-finding rather than per-message. */
    details?: Record<string, unknown>;
  };
}
