/**
 * @file src/services/exposure/exposure-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exposure report: everything of one person that someone outside can read, at
 *   which level, and how to close each (plan doc-mvcn6c7e4e5q, V6.2). It answers the question a
 *   person asks before they put anything in with their AI: "what can a stranger see of mine?"
 *
 *   ONE IMPLEMENTATION for GET /v1/exposure/mine, the MCP tool aimeat_exposure_report on both MCP
 *   surfaces and the CLI dispatch (which proxies the route), and the operator's node-wide variant
 *   behind GET /v1/admin/exposure, which runs the same sources for every account and keeps only the
 *   numbers.
 *
 *   HONEST ABOUT ITS EDGES. A source that fails is named in `failed` and the rest of the report
 *   stands: a report that went blank because one kind could not be read would say "nothing is
 *   exposed". The item list of a kind stops at EXPOSURE_ITEM_CAP and the kind is named in `capped`;
 *   the counts are always of everything found. `notes` says what the report does not count and why.
 *   On a node set to show its content to its own accounts only (config contentAccess 'signed-in'),
 *   every public and link item is listed as signed-in, and the first note says why.
 *
 *   A RECORD THE CALLER MAY NOT SEE IS NOT LISTED TO THEM. Each record or file item, and each app,
 *   board, organism and workspace share, passes the caller's classification reader before it is
 *   listed, decided on its EFFECTIVE label (classification/effective.ts: its own, raised to its
 *   workspace's, organism's, board's or app's), so an AI is not handed the key of a record the
 *   person's classification hides from AI; it is counted, and `hidden_by_classification` says how
 *   many.
 *   A report with every source failed is no report: exposureUnreadable() says so, and the doors
 *   answer it as a failure.
 * @structure ExposureReport · NodeExposureReport · buildExposureReport · buildNodeExposureReport ·
 *   exposureUnreadable · EXPOSURE_UNREADABLE_MESSAGE
 * @usage
 *   const report = await buildExposureReport(createExposureContext(storage, config), 'alice', reader);
 * @version-history
 *   v1.3.0 — 2026-10-18 — The places carry a classification address too, and the reader decides on
 *     the effective label (plan doc-mvdipuyqraas, L1.3).
 *   v1.2.0 — 2026-10-18 — NODE_SIGNED_IN_NOTE says that what is made public now is saved for signed-in accounts (plan V1.6).
 *   v1.1.0 — 2026-10-18 — exposureUnreadable: every source failed is answered as a failure, not as an
 *     empty report (test/unit/node-mcp-error-flag.test.ts).
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.2).
 */
import { logger } from '../../utils/logger.js';
import { errorFields } from '../../utils/error-fields.js';
import type { ContentReader } from '../classification/reader.js';
import { signedInOnly } from '../../config-visibility.js';
import {
  type ExposureContext, type ExposureFound, type ExposureItem, type ExposureKind, type ExposureLevel,
  KINDS, LEVELS, EXPOSURE_ITEM_CAP,
} from './exposure-types.js';
import { EXPOSURE_SOURCES } from './exposure-sources.js';

/** How many things, at which level, overall and per kind. */
export interface ExposureCounts {
  total: number;
  by_level: Record<ExposureLevel, number>;
  /** Only the kinds with something exposed. */
  by_kind: Partial<Record<ExposureKind, Record<ExposureLevel, number>>>;
}

export interface ExposureReport {
  /** The account the report is about, as a GHII. */
  owner: string;
  generated_at: string;
  counts: ExposureCounts;
  /** Widest level first, then by kind. At most EXPOSURE_ITEM_CAP per kind. */
  items: ExposureItem[];
  /** The kinds whose item list was cut at EXPOSURE_ITEM_CAP. Their counts are complete. */
  capped: ExposureKind[];
  /** The kinds that could not be read this time. Their counts are missing, not zero. */
  failed: ExposureKind[];
  /**
   * How many items are counted but not listed because their classification hides them from this
   * caller (an AI, when the person's or an organism's classification hides content from AI).
   */
  hidden_by_classification: number;
  /** What the report does not count, and why. */
  notes: string[];
}

export interface NodeExposureReport {
  generated_at: string;
  /** Accounts read. */
  owners: number;
  /** True when the node holds more accounts than one report reads (NODE_OWNER_CAP). */
  owners_capped: boolean;
  /** Each thing once, however many accounts can close it. */
  counts: ExposureCounts;
  /** The accounts with the most exposed, widest first: numbers only, no item. */
  top_owners: Array<{ owner: string; total: number; by_level: Record<ExposureLevel, number> }>;
  /** The kinds that could not be read for at least one account, with how many accounts. */
  failed: Partial<Record<ExposureKind, number>>;
  notes: string[];
}

/** The most accounts the node-wide report reads in one run. */
export const NODE_OWNER_CAP = 5000;
/** How many accounts the node-wide report names. */
const TOP_OWNERS = 50;

/** Kinds whose item id is unique only within one account (a memory key, a filename). */
const ACCOUNT_SCOPED_IDS: ReadonlySet<ExposureKind> = new Set(['memory', 'file', 'app', 'knowledge', 'skill', 'portfolio']);

export const EXPOSURE_NOTES: readonly string[] = [
  'A download address made to hand out one file (a presigned link) is not counted: it ends by itself, and the person gave it to someone on purpose.',
  'An app with an access code, an app an operator hid, and a workspace share behind a password are not counted: a stranger needs the code or the password as well.',
  'Sharing groups, workspace rosters and records shared into a workspace are not counted: each names the people who read.',
  'A shared workspace page is counted as an anonymous visitor would be given it. It is listed for the workspace\'s creator and for the organism\'s creator, owners and admins, because each of them can close it.',
  'An exchange offering or need stays a public record after it leaves the market; it is counted until the record is deleted.',
  `Each kind lists at most ${EXPOSURE_ITEM_CAP} items. The counts include everything found.`,
  'Some lists are read up to a limit of the store: exchange offerings and needs (5000 each on the node) and the records of one shared workspace space (5000).',
];

function emptyLevels(): Record<ExposureLevel, number> {
  return { public: 0, link: 0, 'signed-in': 0, organism: 0 };
}

/** An item as a node set to signed-in content access serves it: no wider than its own accounts. */
function lowerToSignedIn(f: ExposureFound): ExposureFound {
  return f.level === 'public' || f.level === 'link' ? { ...f, level: 'signed-in' } : f;
}

/** The notes, with the node's own setting when it narrows every level. */
function notesFor(ctx: ExposureContext): string[] {
  return signedInOnly(ctx.config)
    ? [NODE_SIGNED_IN_NOTE, ...EXPOSURE_NOTES]
    : [...EXPOSURE_NOTES];
}

export const NODE_SIGNED_IN_NOTE = 'This node shows its content to its own signed-in accounts only (the operator\'s setting), so nothing here is open to strangers or to someone who only holds a link: what would otherwise be public is listed as signed-in, and what is made public now is saved for signed-in accounts.';

/** An item as the report hands it out: the content address a source attached stays behind. */
function outward(f: ExposureFound): ExposureItem {
  return {
    kind: f.kind, id: f.id, title: f.title, level: f.level,
    ...(f.organism_id ? { organism_id: f.organism_id } : {}),
    ...(f.url ? { url: f.url } : {}),
    how_to_close: f.how_to_close,
  };
}

function countItems(items: Iterable<ExposureItem>): ExposureCounts {
  const counts: ExposureCounts = { total: 0, by_level: emptyLevels(), by_kind: {} };
  for (const it of items) {
    counts.total++;
    counts.by_level[it.level]++;
    (counts.by_kind[it.kind] ??= emptyLevels())[it.level]++;
  }
  return counts;
}

/** Every source over one account: what each found, and which could not be read. */
async function readAll(
  ctx: ExposureContext, ownerName: string, ownerGhii: string,
): Promise<{ found: Map<ExposureKind, ExposureFound[]>; failed: ExposureKind[] }> {
  const found = new Map<ExposureKind, ExposureFound[]>();
  const failed: ExposureKind[] = [];
  // One source after another: on SQLite every read shares one connection, and the memo lets a later
  // source reuse what an earlier one read.
  // A node that shows its content to its own accounts only serves nothing to a stranger or to a
  // link holder (middleware/content-access-gate.ts), so what would be public or link is signed-in.
  const lower = signedInOnly(ctx.config);
  for (const source of EXPOSURE_SOURCES) {
    try {
      const items = await source.list(ctx, ownerName, ownerGhii);
      found.set(source.kind, lower ? items.map(lowerToSignedIn) : items);
    } catch (err) {
      logger.warn('exposure: a source could not be read', { ...errorFields(err), kind: source.kind, owner: ownerName });
      failed.push(source.kind);
    }
  }
  return { found, failed };
}

/**
 * True when no source could be read at all. Such a report would say "nothing is exposed" about an
 * account nobody looked at, so the doors answer it as a failure instead (503, an MCP error).
 */
export function exposureUnreadable(report: { failed: readonly unknown[] }): boolean {
  return report.failed.length > 0 && report.failed.length >= EXPOSURE_SOURCES.length;
}

/** The sentence both doors answer an unreadable report with. */
export const EXPOSURE_UNREADABLE_MESSAGE = 'None of the places your content lives could be read just now, so no report was made. Try again in a moment.';

/** Widest level first, then the order of KINDS, then the title. */
function byExposure(a: ExposureItem, b: ExposureItem): number {
  return LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level)
    || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
    || a.title.localeCompare(b.title);
}

/**
 * Everything of one account that someone outside can read. `ownerName` is the bare account name;
 * `reader` is the caller's classification reader (services/classification/reader.ts): a record or a
 * file whose classification hides it from this caller is counted and not listed.
 */
export async function buildExposureReport(ctx: ExposureContext, ownerName: string, reader: ContentReader): Promise<ExposureReport> {
  const ownerGhii = `${ownerName}@${ctx.config.nodeId}`;
  const { found, failed } = await readAll(ctx, ownerName, ownerGhii);
  const all: ExposureItem[] = [];
  const shown: ExposureItem[] = [];
  const capped: ExposureKind[] = [];
  let hidden = 0;
  for (const [kind, items] of found) {
    all.push(...items);
    const visible = await reader.show(items, f => f.content ?? null);
    hidden += items.length - visible.length;
    const ordered = visible.map(outward).sort(byExposure);
    if (ordered.length > EXPOSURE_ITEM_CAP) capped.push(kind);
    shown.push(...ordered.slice(0, EXPOSURE_ITEM_CAP));
  }
  return {
    owner: ownerGhii,
    generated_at: new Date(ctx.nowMs).toISOString(),
    counts: countItems(all),
    items: shown.sort(byExposure),
    capped,
    failed,
    hidden_by_classification: hidden,
    notes: notesFor(ctx),
  };
}

/**
 * The node-wide numbers for the operator: every account read with the same sources, each thing
 * counted once however many accounts can close it, and the accounts with the most exposed. No item
 * leaves this function, only counts.
 */
export async function buildNodeExposureReport(ctx: ExposureContext): Promise<NodeExposureReport> {
  const owners = await ctx.storage.listOwners();
  const read = owners.slice(0, NODE_OWNER_CAP);
  const unique = new Map<string, ExposureItem>();
  const perOwner: NodeExposureReport['top_owners'] = [];
  const failed: Partial<Record<ExposureKind, number>> = {};
  for (const o of read) {
    const { found, failed: f } = await readAll(ctx, o.name, `${o.name}@${ctx.config.nodeId}`);
    for (const k of f) failed[k] = (failed[k] ?? 0) + 1;
    const mine: ExposureItem[] = [];
    for (const items of found.values()) {
      for (const it of items) {
        mine.push(it);
        unique.set(`${it.kind}|${ACCOUNT_SCOPED_IDS.has(it.kind) ? o.name : ''}|${it.id}|${it.level}`, it);
      }
    }
    if (mine.length) {
      const c = countItems(mine);
      perOwner.push({ owner: o.name, total: c.total, by_level: c.by_level });
    }
  }
  perOwner.sort((a, b) => LEVELS.reduce((d, lv) => d || b.by_level[lv] - a.by_level[lv], 0) || b.total - a.total);
  return {
    generated_at: new Date(ctx.nowMs).toISOString(),
    owners: read.length,
    owners_capped: owners.length > read.length,
    counts: countItems(unique.values()),
    top_owners: perOwner.slice(0, TOP_OWNERS),
    failed,
    notes: notesFor(ctx),
  };
}
