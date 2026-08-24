/**
 * @file src/services/data-map/data-map-lint.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE publish-time data-map check — one function, so the REST publish, the draft
 *   publish, the MCP tools and the backfill cannot disagree about what a program's map is. The same
 *   shape `lintAppAiDisclosure` has, deliberately: one stored `gap` for the owner, a `hints` array
 *   for whoever is publishing, and it NEVER blocks a publish.
 *
 *   Not blocking is a decision, not an oversight (developer, 2026-08-24). A gate that refuses on a
 *   missing map would break the next publish of all 169 apps in production, and a map is a statement
 *   about storage rather than a property of the bytes — the one blocking check on this path,
 *   lintAppArtifact, refuses things that are broken, not things that are unfinished.
 *
 *   The hints are written for the model that built the app, because that is who reads a publish
 *   response in practice: each one names the exact line to paste, so the fix happens in the same
 *   session instead of becoming a task nobody picks up.
 *
 *   TWO KINDS OF FINDING, and only one of them belongs here. What the bytes and the manifest can
 *   show is checked at publish. What only observation can show — a family being written that no row
 *   covers, a declared row that has never received a write — needs the write tally and therefore
 *   time, so it surfaces on the coverage route and lands on the stamp at the NEXT publish. One
 *   writer per field; the observed half never rewrites a published manifest behind its back.
 * @structure DATA_MAP_GAP_CODES · DataMapLintInput · DataMapLintResult · lintDataMap(input)
 * @usage import { lintDataMap } from './data-map-lint.js';
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 5.
 */
import { RESERVED_OWNER_KEY_PREFIXES } from '../../utils/reserved-keys.js';
import { checkFormRequirements } from './form-requirements.js';
import { formatDataMapMeta } from './data-map-meta.js';
import type { DataMap, DataMapGap } from './data-map-types.js';

/**
 * Every code this check can produce at publish time, worst first. The order IS the severity: one gap
 * is stored, and it is the first of these that fires.
 */
export const DATA_MAP_GAP_CODES = [
  /** It writes, and nothing anywhere says where. */
  'DATAMAP_MISSING',
  /** A row claims a prefix the server itself reads and trusts. Wrong on its face. */
  'DATAMAP_RESERVED_CLAIM',
  /** It asked for a permission no row uses — either the map is short or the permission is. */
  'DATAMAP_SCOPE_UNMAPPED',
  /** A row claims more than the permissions allow. The map over-claims. */
  'DATAMAP_ROW_UNSCOPED',
  /** A row does not say what deleting it does. */
  'DATAMAP_DELETION_UNANSWERED',
  /** The map does not meet what its own declared shape requires. */
  'DATAMAP_FORM_INCOMPLETE',
  /** A row nobody has explained. */
  'DATAMAP_NO_WHY',
  /** The node drafted the whole thing and nobody has looked at it yet. */
  'DATAMAP_DERIVED_UNCONFIRMED',
] as const;

export type DataMapGapCode = (typeof DATA_MAP_GAP_CODES)[number];

export interface DataMapLintInput {
  map: DataMap;
  /** From `parseAppScopes(html)`. */
  scopes: string[];
  programId: string;
  at: string;
  /** True when the app carries no `<meta name="aimeat-datamap">` and published no document. */
  declaresNothing: boolean;
}

export interface DataMapLintResult {
  /** The map with `gap` set when there is one, ready to store. */
  map: DataMap;
  hints: string[];
}

/** Which scope words imply the program stores something at all. */
const WRITING_SCOPES = ['memory:write', 'storage:write', 'knowledge:write', 'organism:write'];

/** Map a scope word to the area a row would have to name for it to be accounted for. */
const SCOPE_AREA: Record<string, string> = {
  'memory:read': 'memory', 'memory:write': 'memory', 'memory:delete': 'memory',
  'storage:read': 'storage', 'storage:write': 'storage',
  'knowledge:read': 'knowledge', 'knowledge:write': 'knowledge',
  'organism:read': 'organisms', 'organism:write': 'organisms',
};

export function lintDataMap(input: DataMapLintInput): DataMapLintResult {
  const { map, scopes, at } = input;
  const hints: string[] = [];
  const found: { code: DataMapGapCode; message: string }[] = [];

  const writes = scopes.some(s => WRITING_SCOPES.includes(s));
  const rows = [...map.held, ...map.elsewhere];

  // 1. It writes and says nothing at all.
  if (writes && input.declaresNothing && rows.length === 0) {
    found.push({
      code: 'DATAMAP_MISSING',
      message: 'This app asks to write and nothing says where it puts what. Add a data map.',
    });
    hints.push(
      'This app can write and has no data map, so nobody can tell where its data lands without reading '
      + 'the source. Add one line to the head: '
      + formatDataMapMeta({ form: 'single-person', areas: [{ pattern: `${input.programId}.*`, rights: ['read', 'write'], personalData: 'unstated', area: 'memory' }] })
      + ' The full answers — why each area is where it is, and what deleting it means — go in a memory '
      + `record at apps.${input.programId}.datamap.`,
    );
  }

  // 2. A row claiming a reserved prefix. The server changes what it DOES because of what it finds
  //    there, so a program cannot hold one, and a map saying it does is describing an impossibility.
  for (const row of map.held) {
    const reserved = RESERVED_OWNER_KEY_PREFIXES.find(p => row.grant.pattern.startsWith(p));
    if (!reserved) continue;
    found.push({
      code: 'DATAMAP_RESERVED_CLAIM',
      message: `The map claims "${row.grant.pattern}", and "${reserved}" is a place only the node writes.`,
    });
    hints.push(
      `The row "${row.grant.pattern}" claims an area this node keeps for itself: it reads "${reserved}" `
      + 'to decide what to do, so no app writes there and the write would be refused. Remove the row, or '
      + 'point it at a place this app actually uses.',
    );
  }

  // 3. A permission with no row to account for it.
  const declaredAreas = new Set(map.held.map(r => r.grant.area));
  const unmapped = scopes.filter(s => SCOPE_AREA[s] && !declaredAreas.has(SCOPE_AREA[s]));
  if (rows.length > 0 && unmapped.length > 0) {
    found.push({
      code: 'DATAMAP_SCOPE_UNMAPPED',
      message: `Asks for ${unmapped.join(', ')} and the map has no row for that.`,
    });
    hints.push(
      `This app asks the owner for ${unmapped.join(', ')}, and its data map never mentions that. Either add `
      + 'the rows that use it, or drop the permission — an unused permission the owner granted is one they '
      + 'were asked for and did not need to give.',
    );
  }

  // 4. A row claiming more than the permissions allow. The map over-claims, which is the direction
  //    that matters: it promises the reader something the app cannot actually do.
  for (const row of map.held) {
    if (!row.grant.rights.includes('write')) continue;
    const needed = Object.entries(SCOPE_AREA).find(([word, area]) => area === row.grant.area && word.endsWith(':write'))?.[0];
    if (needed && !scopes.includes(needed)) {
      found.push({
        code: 'DATAMAP_ROW_UNSCOPED',
        message: `The map says it writes "${row.grant.pattern}", and it never asks for ${needed}.`,
      });
      hints.push(
        `The row "${row.grant.pattern}" says this app writes there, but the app does not ask for ${needed}, `
        + 'so that write would be refused. One of the two is out of date.',
      );
    }
  }

  // FINDINGS 5-7 ARE ABOUT A STATEMENT SOMEBODY MADE, so they are asked only of the rows somebody
  // wrote. A wholly derived map has no author yet: holding it to a declaration's standard fires
  // three findings at once on every app on day one, and the one true thing to say about it —
  // "nobody has confirmed this" — would then be outranked by three that misdescribe it. Findings 1-4
  // stay unconditional: they compare rows against permissions, which is true of a draft too.
  const authored = map.source !== 'derived';
  const declaredHeld = map.held.filter(r => r.source === 'declared');
  const declaredRows = authored ? [...declaredHeld, ...map.elsewhere.filter(r => r.source === 'declared')] : [];

  // 5. Deletion unanswered. The question a deletion request arrives asking.
  const unanswered = declaredRows.filter(r => r.deletion.effect === 'unknown');
  if (unanswered.length > 0) {
    found.push({
      code: 'DATAMAP_DELETION_UNANSWERED',
      message: `${unanswered.length} row(s) do not say what deleting them does.`,
    });
    hints.push(
      `${unanswered.length} row(s) — ${unanswered.slice(0, 3).map(r => r.grant.pattern).join(', ')} — do not say `
      + 'what deleting them does. That is the question a deletion request arrives asking, and the answer is '
      + 'decided before the request rather than after it.',
    );
  }

  // 6. The map does not meet what its own declared shape requires.
  const violations = authored ? checkFormRequirements(map) : [];
  if (violations.length > 0) {
    found.push({
      code: 'DATAMAP_FORM_INCOMPLETE',
      message: `This says it is a "${map.form}" program, and ${violations.length} thing(s) that shape needs are missing.`,
    });
    for (const v of violations.slice(0, 5)) {
      hints.push(v.pattern ? `${v.pattern}: ${v.says}` : v.says);
    }
  }

  // 7. Rows nobody has explained. The whole point of the map, so it is a finding rather than a blank.
  const noWhy = declaredHeld.filter(r => !r.why.trim());
  if (authored && noWhy.length > 0 && !input.declaresNothing) {
    found.push({
      code: 'DATAMAP_NO_WHY',
      message: `${noWhy.length} row(s) do not say why the data is there.`,
    });
    hints.push(
      `${noWhy.length} row(s) say where data goes and not why it goes there. One sentence each — "campaigns `
      + 'live on the organism because they belong to the customer and not to whoever sent them" — is what '
      + 'stops the next person moving it by mistake.',
    );
  }

  // 8. Nobody has looked at the draft. Last, because it is true of every app on day one and a
  //    finding that fires on everything teaches people to ignore findings.
  if (map.source === 'derived' && rows.length > 0) {
    found.push({
      code: 'DATAMAP_DERIVED_UNCONFIRMED',
      message: 'This map was worked out by the node from what it could see. Nobody has confirmed it.',
    });
  }

  const worst = pickWorst(found);
  if (!worst) {
    // No key at all rather than `gap: undefined`: a stored record carrying an empty field reads to
    // the next person as "there was a finding once", which is a different thing from a clean map.
    const clean: DataMap = { ...map };
    delete clean.gap;
    return { map: clean, hints };
  }
  const gap: DataMapGap = { code: worst.code, message: worst.message, at };
  return { map: { ...map, gap }, hints };
}

/** The first code in DATA_MAP_GAP_CODES order that fired. One gap is stored; hints carry the rest. */
function pickWorst(found: { code: DataMapGapCode; message: string }[]): { code: DataMapGapCode; message: string } | null {
  for (const code of DATA_MAP_GAP_CODES) {
    const hit = found.find(f => f.code === code);
    if (hit) return hit;
  }
  return null;
}
