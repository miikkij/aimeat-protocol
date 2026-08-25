/**
 * @file src/services/data-map/data-map-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map: what an app is, what it is used for, where its data actually lives,
 *   and why there.
 *
 *   WHO IT IS FOR. An AI that opens an app it does not know. It reads the map and knows in seconds
 *   what the app is for and how its data is arranged, without reading the source. Without that, it
 *   puts a new feature's data wherever it can reach most easily — which is the defect this exists to
 *   prevent: a group CRM whose campaigns, deal stages and follow-up limits all landed in one
 *   person's own memory, invisible to their team.
 *
 *   THE AUDITOR IS THE SECOND AUDIENCE, NOT THE FIRST. Retention windows and personal-data marks are
 *   their columns. They may not crowd out what a builder needs, which is: what is this for, where
 *   does its data live, and why there.
 *
 *   TWO FIELDS CARRY THE VALUE AND NEITHER CAN BE DERIVED: the app's own paragraph (what it is, what
 *   it is used for) and the per-row `why`. They are written once, by whoever built the app. A guess
 *   in either is worse than a blank, because it sits where the answer belongs and reads like one.
 *
 *   Full definition, including every axis and its values: docs/datakartta-maaritelma.md
 * @structure DataMap · DataMapRow · ElsewhereRow · DataMapStamp · publicDataMap()
 * @usage import type { DataMap } from './data-map-types.js';
 * @version-history
 *   v2.0.0 — 2026-08-25 — Rewritten to docs/datakartta-maaritelma.md. v1 described a key family and
 *     its compliance columns and never said what the app was FOR, so the map answered nobody's
 *     question. The app-level paragraph, `usedFor` on both levels, the machinery list and the
 *     loss-risk axis are new; the guessed `form` default is gone.
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 2.
 */
import type { MemoryRecord } from '../../storage/types/commerce.js';

/** The current document version. A map carries its own spec so a newer node can read an older map. */
export const DATA_MAP_SPEC = 'aimeat.datamap/2' as const;

/* ── The axes. Every list is open at the point of use: an unknown value is kept verbatim rather
      than coerced, because coercing is how a map starts lying. ──────────────────────────────── */

/** What shape of program this is. `unstated` is a real answer and NEVER a default we invent. */
export type DataMapForm =
  | 'one-person' | 'private' | 'shared-with-named' | 'group'
  | 'organism-workspace' | 'public-service' | 'static' | 'mixed' | 'unstated';

export const DATA_MAP_FORMS: readonly DataMapForm[] = [
  'one-person', 'private', 'shared-with-named', 'group',
  'organism-workspace', 'public-service', 'static', 'mixed', 'unstated',
] as const;

/** Where a row's data actually lives. */
export type DataLocation =
  | 'nowhere' | 'browser-only' | 'owner-memory-private' | 'owner-memory-public'
  | 'someone-elses-memory' | 'organism-workspace' | 'organism-shared' | 'organism-meta'
  | 'extension-namespace' | 'cortex' | 'file-storage' | 'app-published-record'
  | 'another-node' | 'external-service';

/** What kind of thing the data is. */
export type DataKind =
  | 'settings' | 'user-written' | 'ai-generated' | 'register' | 'event-log' | 'index'
  | 'computed-or-cache' | 'fetched-copy' | 'foreign-identifier' | 'snapshot' | 'metrics'
  | 'preferences' | 'draft' | 'outgoing-message' | 'file' | 'link-between-things'
  | 'permissions' | 'secret';

/** What it is there FOR. The axis that keeps getting dropped, which is why it is required. */
export type DataUse =
  | 'app-cannot-run-without' | 'user-returns-to-read' | 'shown-as-a-list' | 'search-and-filter'
  | 'calculation-and-reporting' | 'app-resumes-where-it-left' | 'to-share-with-others'
  | 'to-send-out' | 'evidence-of-what-happened' | 'speed-only' | 'context-for-an-ai'
  | 'backwards-compatibility';

export type Ownership =
  | 'person' | 'organism' | 'extension' | 'ecosystem-app' | 'someone-else' | 'external-controller'
  | 'nobody';

export type Readers =
  | 'owner-only' | 'owner-and-their-agents' | 'named-people' | 'organism-members' | 'anyone'
  | 'the-app-itself' | 'a-recipient-elsewhere';

export type Writers =
  | 'person-in-the-ui' | 'the-app-for-the-person' | 'an-agent' | 'a-schedule-unattended'
  | 'an-extension-server-side' | 'install-seed' | 'a-foreign-system';

export type RecordShape =
  | 'one-record' | 'one-per-thing' | 'collection-under-one-key' | 'rolled-up-per-period'
  | 'index-plus-bodies' | 'files' | 'no-record';

export type Retention =
  | 'until-deleted' | 'ttl' | 'rolling-window' | 'version-capped' | 'append-only' | 'session-only';

/** What losing it would cost. Decides whether a placement is acceptable at all. */
export type LossRisk =
  | 'only-copy' | 'recoverable-from-source' | 'recomputable' | 'user-can-rewrite' | 'may-vanish';

/** Machinery the app leans on. Free-form beyond these; an unknown name is kept as written. */
export type Machinery =
  | 'iam-and-roles' | 'workflows' | 'extensions' | 'cortex' | 'ai-generation' | 'scheduling'
  | 'connections-and-publish' | 'payments' | 'federation';

/* ── The two tables ──────────────────────────────────────────────────────────────────────────── */

/** One key family. Eleven things, and `why` is the one the whole feature exists for. */
export interface DataMapRow {
  /** The key family or record type. A FAMILY, never one key: `news.<date>.*`, not 300 rows. */
  what: string;
  /** In the app's own words, one short line: "people and leads", "meeting transcripts". */
  holds: string;
  kind: DataKind;
  usedFor: DataUse;
  where: DataLocation;
  /** Where exactly, when the location alone is not an address: an organism + workspace, a bucket. */
  whereExactly?: string;
  owner: Ownership;
  readers: Readers;
  writers: Writers[];
  shape: RecordShape;
  keptFor: Retention;
  lossRisk: LossRisk;
  /** Personal data. Tri-state on purpose: silence is not a considered "no". */
  personalData: 'yes' | 'no' | 'unstated';
  /** One sentence: why HERE and not somewhere else. Empty means nobody has said. Never invented. */
  why: string;
}

/** The second table: what is unresolved, or is not ours. */
export interface ElsewhereRow {
  what: string;
  status: 'work-in-progress' | 'copy-of-anothers-record' | 'already-left' | 'account-in-a-foreign-system';
  /** Where the real one is. */
  where: string;
  /** Who decides about it. */
  controlledBy: string;
  /** What deleting our side actually does. */
  deletion: string;
}

/** What the app sends out of the house, if anything. */
export interface LeavesRow {
  what: string;
  to: string;
  /** Whether it can be recalled. Sent mail cannot. */
  recallable: boolean;
}

export interface DataMap {
  spec: typeof DATA_MAP_SPEC;

  /* ── The app level. The first two are the ones that keep getting dropped. ── */

  /** What this app IS, in human words. One paragraph. Not derivable — written once. */
  what: string;
  /** What it is USED FOR, and what someone achieves with it. Not derivable — written once. */
  usedFor: string;
  form: DataMapForm;
  /** Where the data is, as prose: the actual arrangement, not an assumed one. */
  arrangement: string;
  machinery: (Machinery | string)[];
  leaves: LeavesRow[];

  /* ── The rows ── */

  held: DataMapRow[];
  elsewhere: ElsewhereRow[];

  /** Who wrote this map. 'declared' = a person or the app's builder. 'none' = there is no map. */
  source: 'declared' | 'none';
  at: string;
  /** Owner-only. Never stored on the public record; stripped on the way in. */
  gap?: DataMapGap;
}

export interface DataMapGap {
  code: string;
  message: string;
  at: string;
}

/** The summary carried on the app manifest, so a list can render without reading the document. */
export interface DataMapStamp {
  spec: typeof DATA_MAP_SPEC;
  form: DataMapForm;
  /** One line for a list: where this app's data is. Built from the rows, never invented. */
  summary: string;
  heldRows: number;
  rowsWithoutWhy: number;
  /** True when the app carries no map at all. A missing map says so; it is never guessed. */
  missing: boolean;
  docKey: string;
  at: string;
  gap?: DataMapGap;
}

/** The memory key holding one app's map, beside the app rather than inside it. */
export const appDataMapKey = (appId: string): string => `apps.${appId}.datamap`;

/**
 * The public form. The rows are the promise the app makes to whoever installs it; the finding is the
 * owner's own unfinished business, so it is stripped rather than hidden by a reader.
 */
export function publicDataMap(map: DataMap): DataMap {
  const { gap, ...rest } = map;
  void gap;
  return rest as DataMap;
}

/** True when a stored record is a map of this spec. */
export function isDataMapRecord(rec: MemoryRecord | null | undefined): boolean {
  const v = rec?.value as { spec?: unknown } | undefined;
  return !!v && typeof v === 'object' && v.spec === DATA_MAP_SPEC;
}
