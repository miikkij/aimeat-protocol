/**
 * @file src/services/compliance-app-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who can see an app's personal data, read from the app's own data map: nobody (it is
 *   not kept on the node), only the person who uses the app, the people it is shared with, or the
 *   app's maker, the public or a service outside the node.
 *
 *   WHY IT EXISTS. Until 2026-10-29 the compliance documents asked one thing of an app: does its map
 *   hold personal data. A notes app whose every row sits in the user's own private memory got a
 *   register with its maker as the controller, a "no register" gap and a "no privacy notice" gap,
 *   the same three as an app that publishes people's names to anyone. On aimeat.io that made every
 *   app read as unlawful and the report ran past 180 pages. The map already said, row by row, where
 *   the data lives and who reads it; nothing read those two columns.
 *
 *   THE FOUR GROUPS (Jouni, 2026-10-29). `none` and `self` get no register and no privacy notice of
 *   their own: data only its owner sees is the person's own account content, covered by the node's
 *   record of processing (`node-user-content`, compliance-derived.ts), and an app's maker who never
 *   receives the data is not its controller (EDPB guidelines 07/2020). `shared` and `exposed` keep
 *   every requirement. `unknown` is a map the node cannot read, and its maker is asked to fix it.
 *   One exception, decided where the register is drafted (compliance-derived.ts): an app that keeps
 *   regulated data, such as TalentGrid's ratings of colleagues, needs a record whoever reads it,
 *   because that data is about other people. Reach stays what it says: who can see the data.
 *
 *   THE MAP'S OWN WORDS, AND THE KNOWN OTHER SPELLINGS OF THEM. Maps written by an AI to its own
 *   shape say `own-memory` for `owner-memory-private` and `only-me` for `owner-only`. Those are read
 *   as the word they spell (measured on aimeat.io, 2026-10-29: 543 rows in 152 maps). A word that is
 *   neither, such as a sentence in the readers column, is never guessed: the row is unreadable and
 *   the maker is asked.
 *
 *   PURE. No storage: the same map always gives the same answer.
 * @structure AppReach · REACH_ORDER · AppReachReading · appReach()
 * @usage const r = appReach(map); if (r.reach === 'self') // no app register
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial.
 */
import type { DataMap, DataMapRow } from './data-map/data-map-types.js';

/**
 * Who can see the app's personal data. `none`: it is not kept on the node (no personal data, or
 * only in the browser). `self`: only the person who uses the app and their own agents. `shared`:
 * named people or an organism's members. `exposed`: anyone, the app's maker or a service outside
 * the node. `unknown`: the node cannot tell from the map, or there is no map.
 */
export type AppReach = 'none' | 'self' | 'shared' | 'exposed' | 'unknown';

/** Worst last: an app takes the widest reach of any of its rows. */
export const REACH_ORDER: readonly AppReach[] = ['none', 'self', 'shared', 'unknown', 'exposed'];

const wider = (a: AppReach, b: AppReach): AppReach => (REACH_ORDER.indexOf(a) >= REACH_ORDER.indexOf(b) ? a : b);

/**
 * A location word as reach. `null` is a location that does not decide by itself (the readers
 * column does): file storage, an extension's space, a cortex.
 */
const LOCATION: Readonly<Record<string, AppReach | null>> = {
  'nowhere': 'none', 'browser-only': 'none',
  'owner-memory-private': 'self',
  'file-storage': null, 'extension-namespace': null, 'cortex': null,
  'organism-workspace': 'shared', 'organism-rows': 'shared', 'organism-shared': 'shared', 'organism-meta': 'shared',
  'owner-memory-public': 'exposed', 'app-published-record': 'exposed', 'someone-elses-memory': 'exposed',
  'another-node': 'exposed', 'external-service': 'exposed',
  // Other spellings maps use for the words above.
  'browser': 'none', 'browser-local': 'none',
  'own-memory': 'self', 'owner-memory-owner': 'self', 'own-storage': 'self',
  'extension-memory': null, 'extension-memory-private': null,
  'owner-storage-public': 'exposed',
};

/** A readers word as reach. */
const READERS: Readonly<Record<string, AppReach>> = {
  'owner-only': 'self', 'owner-and-their-agents': 'self', 'the-app-itself': 'self',
  'named-people': 'shared', 'organism-members': 'shared',
  'anyone': 'exposed', 'a-recipient-elsewhere': 'exposed',
  // Other spellings maps use for the words above.
  'only-me': 'self', 'the-person-and-their-agents': 'self',
  'members': 'shared',
  'anyone-with-the-address': 'exposed',
};

export interface AppReachReading {
  reach: AppReach;
  hasMap: boolean;
  /** A row the map marks personal is kept on the node. */
  personal: boolean;
  /** The rows that decide the reach: personal ones, and unsaid ones others can read. */
  rows: Array<{ what: string; reach: AppReach; personal: 'yes' | 'unstated' }>;
  /** Rows others can read whose map does not say whether they hold personal data. */
  personalUnstated: string[];
  /** Rows whose location or readers are words the node does not know. */
  unreadable: Array<{ what: string; where: string | null; readers: string | null }>;
}

const rowName = (r: DataMapRow): string => r.what || (r as DataMapRow & { key?: string }).key || '(unnamed)';

/** The personal-data mark, with the spellings maps use: a boolean, `maybe`, `unknown`. */
function personalOf(r: DataMapRow): 'yes' | 'no' | 'unstated' {
  const mark: unknown = r.personalData;
  if (mark === 'yes' || mark === true) return 'yes';
  if (mark === 'no' || mark === false) return 'no';
  if (mark === undefined && r.isA === 'schema:Person') return 'yes';
  return 'unstated';
}

/** One row's reach, or null when its words cannot be read. */
function rowReach(r: DataMapRow): AppReach | null {
  const where = typeof r.where === 'string' ? r.where : '';
  const readers = typeof r.readers === 'string' ? r.readers : '';
  const loc = where in LOCATION ? LOCATION[where] : undefined;
  const rd = readers in READERS ? READERS[readers] : undefined;
  if (loc === 'none') return 'none';
  if (loc === 'exposed' || rd === 'exposed') return 'exposed';
  if (loc === undefined || rd === undefined) return null;
  if (loc === 'shared' || rd === 'shared') return 'shared';
  return 'self';
}

/** Read one app's map. A missing map is `unknown`: nobody has said where the data goes. */
export function appReach(map: DataMap | null): AppReachReading {
  if (!map) return { reach: 'unknown', hasMap: false, personal: false, rows: [], personalUnstated: [], unreadable: [] };
  const out: AppReachReading = { reach: 'none', hasMap: true, personal: false, rows: [], personalUnstated: [], unreadable: [] };
  for (const r of Array.isArray(map.held) ? map.held : []) {
    const personal = personalOf(r);
    if (personal === 'no') continue;
    const reach = rowReach(r);
    if (reach === 'none') continue;
    if (reach === null) {
      // An unsaid row the node cannot place could be anything; a personal one certainly matters.
      out.unreadable.push({ what: rowName(r), where: typeof r.where === 'string' ? r.where : null, readers: typeof r.readers === 'string' ? r.readers : null });
      out.rows.push({ what: rowName(r), reach: 'unknown', personal });
      out.reach = wider(out.reach, 'unknown');
      if (personal === 'yes') out.personal = true;
      continue;
    }
    // Whether an unsaid row holds personal data matters only when someone else can read it: data
    // only its owner sees asks nothing of the app either way.
    if (personal === 'unstated' && reach === 'self') continue;
    if (personal === 'unstated') out.personalUnstated.push(rowName(r));
    else out.personal = true;
    out.rows.push({ what: rowName(r), reach, personal });
    out.reach = wider(out.reach, reach);
  }
  return out;
}
