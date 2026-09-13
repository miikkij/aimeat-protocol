/**
 * @file src/services/exchange-projection-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes the EXCHANGE projection works in: one outcome line of a reconcile, the report
 *   those lines make, and a listing the sources say should exist. Moved out of
 *   services/exchange-projection.ts unchanged so that file stays under the line limit; it re-exports
 *   ReconcileChange and ReconcileReport, so every importer keeps its import.
 * @structure ReconcileChange · ReconcileReport · DesiredListing
 * @usage
 *   import type { ReconcileChange, DesiredListing } from './exchange-projection-types.js';
 * @version-history
 *   v1.0.0 — 2026-09-13 — Extracted from services/exchange-projection.ts. ReconcileChange.reason and
 *     message now also describe the list-once skip (DUPLICATE_OF {app}/{tool} with a sentence).
 */
import type { Offering, OfferingPlan, UsageTerms } from './exchange-market.js';
import type { EntitlementUnit } from './metered-entitlements.js';
import type { Provenance, OdpsExtras } from '../models/odps-schemas.js';

/** One outcome line of a reconcile — the dry-run report is exactly this list. */
export interface ReconcileChange {
  action: 'created' | 'updated' | 'adopted' | 'delisted' | 'unchanged' | 'skipped' | 'warning';
  offeringId: string | null;
  kind: Offering['kind'];
  label: string;                 // human coordinate, e.g. "prh.html/getStatistics"
  unit: EntitlementUnit | null;
  currency: string | null;
  reason?: string;               // why it was skipped (DUPLICATE_OF {label} ...), or which warning: ALSO_LISTED_AS {label} / ODPS_FIELD_TOO_LONG {path}
  /** A warning row's sentence for the owner, and a list-once skip's: what happened, and what they can do about it. */
  message?: string;
  /** ALSO_LISTED_AS: the other listing that sells the same call. */
  otherListing?: { kind: Offering['kind']; label: string; offeringId: string | null };
  /** ODPS_FIELD_TOO_LONG: the field of the listing's ODPS document, its length and the schema's cap. */
  odpsField?: { path: string; length: number; maxLength: number };
}

export interface ReconcileReport {
  owner: string;
  dryRun: boolean;
  changes: ReconcileChange[];
  created: number; updated: number; adopted: number; delisted: number; unchanged: number; skipped: number; warnings: number;
}

/** A listing the sources say SHOULD exist. `key` is its identity — price is deliberately not part of it. */
export interface DesiredListing {
  key: string;
  kind: Offering['kind'];
  ext: string;
  action: string;
  surface: Offering['surface'];
  title: string;
  description: string;
  unit: EntitlementUnit;
  basePrice: number;
  currency: string | null;
  plans: OfferingPlan[];
  taskSpec?: Offering['taskSpec'];
  usageTerms: UsageTerms;
  /** Provider descriptor data carried from the source onto the listing + its ODPS document. */
  provenance: Provenance | null;
  odps: OdpsExtras | null;
  /**
   * What the provider states about how much of this capability's OUTPUT a model wrote (TARGET-058).
   * Optional on the interface as well as on the manifest: a source that predates the field, and one
   * whose block failed to parse, look identical here — absent — and both still list.
   */
  aiProvenance?: Record<string, unknown> | null;
  /** The provider's declared pacing burn, projected so a contract can capture it at accept. */
  tollMorsels: number | null;
  tags: string[];
  sourceHash: string;
  /** A bound app-tool's `action_id` (`ext:{name}:{action}`): how the ext-action listing of the same call is found. */
  binding?: string;
  /** The tool pins part of its input, which makes it a different product from the raw action. */
  lockedInput?: boolean;
}
