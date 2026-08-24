/**
 * @file src/services/data-map/data-map-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map: what a program stores, where, into whose ownership, who reads it, how
 *   long it is kept, what deleting it means, whether it is personal data, and WHY it is there.
 *
 *   The `why` is the field this whole feature exists for. Four separate defects in one app on
 *   2026-08-24 turned out to be one cause: nowhere could anyone read why data was where it was, so a
 *   session reconstructed months-old storage decisions from source and guessed wrong four times the
 *   same way. Source says what a program does, never why. One sentence per row, sitting on the row,
 *   is read exactly when someone is about to change that row — which a separate decision log is not.
 *
 *   THE CORE TRIPLE IS `EcoDataAreaGrant`, BY CONTAINMENT AND NOT BY EXTENSION. That interface is
 *   already persisted on every approved ecosystem app, so adding a required field to it would break
 *   every stored grant against its own reader, and adding optional ones would let a half-filled grant
 *   pass as a map row. `DataMapRow.grant` holds it untouched instead, which means the GEAI approval
 *   path needs no change and a stored `dataAreas` entry lifts into a row with one wrapper.
 * @structure DataMapForm · IdentificationBasis · DeletionAnswer · DataMapRow · ElsewhereRow ·
 *   DataMap · DataMapStamp · DataMapGap · publicDataMap()
 * @usage import type { DataMap } from './data-map-types.js';
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 2.
 */
import type { EcoDataAreaGrant } from '../../storage/types/identity.js';
import type { MemoryRecord } from '../../storage/types/commerce.js';
import type { IdentificationTier } from '../../utils/key-family.js';

/** The current document version. A map carries its own spec so a newer node can read an older map. */
export const DATA_MAP_SPEC = 'aimeat.datamap/1' as const;

/**
 * What SHAPE of program this is, which decides what its map has to contain.
 *
 * A one-person app claiming organism rows is describing something it cannot do; a group app with no
 * other readers named has not finished its map. Same document, different obligations.
 */
export type DataMapForm =
  /** One person, their own store, nobody else reads it. */
  | 'single-person'
  /** One person, but holding things they would not want read — the map must answer deletion. */
  | 'private'
  /** Named individuals read it besides the owner. */
  | 'shared'
  /** A group reads it; membership decides, not a name list. */
  | 'group'
  /** It lives in an organism workspace, so it outlives the person who wrote it. */
  | 'organism-workspace'
  /** More than one of the above. The lint says which row forced it. */
  | 'mixed';

export const DATA_MAP_FORMS: readonly DataMapForm[] = [
  'single-person', 'private', 'shared', 'group', 'organism-workspace', 'mixed',
] as const;

/** On what basis we can say what this family is, and the evidence for it. */
export interface IdentificationBasis {
  tier: IdentificationTier;
  /** Checkable evidence: a prefix, `schema:{pattern}`, `space:{organism}/{ws}/{space}`, `app:{name}`. */
  by: string;
}

/**
 * What deleting actually does. REQUIRED on every row of both tables.
 *
 * A map that lists where things are and cannot answer this is the compliance half-answer that made
 * the feature necessary: a deletion request does not reach an email sent last week, and what is kept
 * of it has to be decided before the feature exists rather than after the request arrives.
 */
export interface DeletionAnswer {
  effect:
    /** Deleting removes it. Nothing else holds a copy. */
    | 'gone'
    /** It goes from here, and a copy somewhere else does not. Say where in `says`. */
    | 'gone-here-copy-remains'
    /** A marker stays behind on purpose — say what the marker holds. */
    | 'tombstoned'
    /** Somebody else controls it. `controller` on the row names who. */
    | 'not-ours-to-delete'
    /** Nobody has answered this yet. The lint reports it; it is never a resting state. */
    | 'unknown';
  /** The sentence a person reads. Plain words, not a restatement of `effect`. */
  says: string;
  /** What else goes with it, when deleting reaches further than the record itself. */
  alsoRemoves?: ('versions' | 'history' | 'files' | 'derived-index')[];
  /**
   * What deliberately SURVIVES the delete. The write tally is always named here when the row is a
   * memory family, because a permanent count of who touched a key is the point of that ledger and a
   * map that quietly omitted it would be describing a deletion that does not happen.
   */
  survives?: string[];
}

/** How long it is kept, and by what mechanism — not a wish, a mechanism. */
export interface RetentionAnswer {
  kind:
    | 'until-deleted'      // it stays until somebody removes it
    | 'ttl'                // the record carries ttlHours and the sweep removes it
    | 'rolling-window'     // only the last N days exist
    | 'version-capped'     // only the last N versions exist
    | 'unknown';
  days?: number;
  note?: string;
}

/** What the tally observed about a family. NEVER accepted from a declaration — only measured. */
export interface ObservedTrace {
  writers: string[];
  writeCount: number;
  keyCount: number;
  firstAt: string;
  lastAt: string;
  /**
   * True when keys exist in this family but no tally row does. A different statement from "no
   * writers": the node writes to memory from about a hundred places that carry no principal, and
   * pretending those were nobody would make a coverage number look complete when it is not.
   */
  writersUnknown?: boolean;
}

/** One row of what the node holds. */
export interface DataMapRow {
  /** `{ area, pattern, rights }` exactly as the ecosystem approval path already stores it. */
  grant: EcoDataAreaGrant;
  basis: IdentificationBasis;
  /**
   * Why it is HERE and not somewhere else. One sentence. Empty means the node derived this row and
   * nobody has said why — which is a finding the lint reports, not a blank to be tidied away.
   */
  why: string;
  ownership: 'owner' | 'agent' | 'extension' | 'ecosystem' | 'organism' | 'foreign';
  readers: { visibility: MemoryRecord['visibility'] | 'mixed'; alsoNamed?: string[] };
  deletion: DeletionAnswer;
  retention: RetentionAnswer;
  /** Tri-state on purpose: silence is not "no". Same rule the AI posture uses for public interest. */
  personalData: 'yes' | 'no' | 'unstated';
  source: 'declared' | 'derived' | 'observed';
  observed?: ObservedTrace;
}

/**
 * One row of what is unresolved, or is not ours.
 *
 * Every map leaves these out and every one of them is where a deletion request goes wrong. The third
 * status is the one to design against: what has already left the building cannot be recalled, so the
 * map states what is kept of it rather than implying it can be undone.
 */
export interface ElsewhereRow {
  grant: EcoDataAreaGrant;
  basis: IdentificationBasis;
  why: string;
  status:
    | 'work-in-progress'            // half-written, and nobody has decided where it belongs
    | 'copy-of-anothers-record'     // a copy; the original is somewhere else and moves without us
    | 'already-left'                // sent, delivered, published — gone from our reach
    | 'account-in-a-foreign-system'; // a login somewhere we do not run
  /** Where the real one is, in words a person can act on. */
  where: string;
  /** Who to ask, when deleting is not ours to do. */
  controller?: string;
  deletion: DeletionAnswer;
  retention: RetentionAnswer;
  personalData: 'yes' | 'no' | 'unstated';
  source: 'declared' | 'derived' | 'observed';
}

/** The publish check's finding. OWNER-ONLY — `publicDataMap()` strips it. */
export interface DataMapGap {
  code: string;
  message: string;
  at: string;
}

export interface DataMap {
  spec: typeof DATA_MAP_SPEC;
  form: DataMapForm;
  /** What the node holds. */
  held: DataMapRow[];
  /** What is unresolved or belongs to somebody else. */
  elsewhere: ElsewhereRow[];
  source: 'declared' | 'derived' | 'mixed';
  at: string;
  gap?: DataMapGap;
}

/**
 * The summary that rides on the app manifest, so a listing can show the state without opening the
 * document. On the manifest for the reason `aiPosture` is: a JSON blob on both storage providers, so
 * no migration and no second place to keep in sync, and it survives update, fork, backup and the
 * purchase snapshot.
 */
export interface DataMapStamp {
  spec: typeof DATA_MAP_SPEC;
  form: DataMapForm;
  source: 'declared' | 'derived' | 'mixed';
  heldRows: number;
  elsewhereRows: number;
  /** The weakest basis anywhere in the map — what a reader should trust it to the level of. */
  weakestTier: IdentificationTier;
  /** Rows with no `why`. The single number that says how much of this nobody has explained. */
  rowsWithoutWhy: number;
  /** Where the full document lives, so a reader does not have to guess the key. */
  docKey: string;
  at: string;
  gap?: DataMapGap;
}

/** An empty map, which is a statement ("this stores nothing") and not an absence. */
export function emptyDataMap(form: DataMapForm, at: string): DataMap {
  return { spec: DATA_MAP_SPEC, form, held: [], elsewhere: [], source: 'derived', at };
}

/**
 * The map as anyone but the owner may see it.
 *
 * The rows are the promise a program makes to whoever installs it, so they stay. The gap is the
 * publish check talking to the owner about their own unfinished work, and it goes — the same split
 * `publicPosture()` makes, for the same reason.
 */
export function publicDataMap<T extends DataMap | DataMapStamp>(map: T): T {
  if (!map.gap) return map;
  const copy = { ...map };
  delete copy.gap;
  return copy;
}

/** Where an app's full map document lives. A stable address, mirroring `appToolsKey`. */
export function appDataMapKey(appId: string): string {
  return `apps.${appId}.datamap`;
}

/** The app id a data-map key belongs to, or null when the key is not one. */
export function appIdFromDataMapKey(key: string): string | null {
  const m = /^apps\.(.+)\.datamap$/.exec(key);
  return m ? m[1] : null;
}
