/**
 * @file src/services/inbox-organize/organize.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where each row of the Messages list goes. Rows, the owner's record (record.ts) and a
 *   clock in; the same rows out, each annotated with its section (people, the account's own agents, a
 *   heading a rule names, the archive), why it is archived when it is, and with the rows that collapse
 *   into one carried under their head. Pure, so the page, the MCP tools and the unit tests get one
 *   answer, and nothing here reads storage.
 *
 *   The four decisions it encodes, as the owner made them on 2026-09-13:
 *   - An archived thread comes back when somebody OTHER than the owner's own agents writes into it.
 *     An own agent's ACK is exactly what the archive was for, so it does not.
 *   - Copies that share an opener and a subject fold into one row. A thread somebody answered lifts
 *     back out, the same as a broadcast copy does, EXCEPT between the owner's own agents, where an
 *     answer is the ACK the fold is there to hide.
 *   - The owner's own agents' traffic archives itself after N days without a message, unless
 *     something in it addressed to the owner is unread. On by default at 14 days, and the owner's to
 *     change or switch off.
 *   - Rules fold, group or archive; the first enabled rule that matches a row decides for it.
 * @structure organizeConversations · foldBroadcasts · isOwnAgentRow · ruleMatches · SUBJECT_FOLD_WINDOW_MS
 * @usage const rows = organizeConversations(named, await readInboxOrganize(storage, ghii), ghii);
 * @version-history
 *   v1.0.0 -- 2026-09-13 -- Initial. foldBroadcasts moved here from services/db/messaging-db-service.ts
 *     unchanged, because a fold now happens inside each section rather than over the whole list.
 */
import type { InboxOrganize, InboxRule } from './record.js';

export type InboxSection = 'people' | 'agents' | 'group' | 'archive';
export type ArchiveReason = 'manual' | 'rule' | 'age';

/** Why a row is in the archive, and since when. `rule` names the rule for a rule archive. */
export interface RowArchive { reason: ArchiveReason; since: string; rule?: string }
/** A row standing for several threads that share an opener and a subject, or one rule. */
export interface RowFold { kind: 'subject' | 'rule'; count: number; label: string }

/** The fields this module reads and writes. OwnerConversation (services/db/messaging-db-service.ts) is one. */
export interface OrganizableRow<T> {
  conversationId: string;
  peerGhii: string;
  subject?: string;
  lastMessage: string;
  lastSenderGhii: string;
  unread: number;
  unreadToOwner?: number;
  updatedAt: string;
  broadcastId?: string;
  lastForeignAt?: string;
  openedBy?: string;
  openedTo?: string;
  openedAt?: string;
  viaAgent?: string;
  groupAlias?: string;
  broadcastCount?: number;
  folded?: T[];
  section?: InboxSection;
  archived?: RowArchive;
  group?: string;
  fold?: RowFold;
}

const DAY_MS = 86_400_000;
/** Copies of one announcement sent in a loop land within minutes of each other. An hour is room
 *  for a slow loop and still short enough that a weekly report with the same title is its own row. */
export const SUBJECT_FOLD_WINDOW_MS = 60 * 60 * 1000;

const ms = (iso: string | undefined): number => (iso ? Date.parse(iso) : NaN);

/**
 * A thread between the owner and one of their own agents or apps, or between two of those. The peer
 * of such a row is always `name#owner@node`. A group thread is never one (other people are in it),
 * and neither is an agent's own thread with an outsider, which the list shows read-only.
 */
export function isOwnAgentRow(row: { peerGhii: string; viaAgent?: string; groupAlias?: string }, ownerGhii: string): boolean {
  if (row.viaAgent || row.groupAlias) return false;
  return row.peerGhii.endsWith(`#${ownerGhii}`);
}

/** Does this rule speak for this row? Every condition the rule gives has to hold. */
export function ruleMatches<T>(rule: InboxRule, row: OrganizableRow<T>, own: boolean, now: number): boolean {
  if (!rule.enabled) return false;
  const m = rule.match;
  if (m.scope === 'agents' && !own) return false;
  const has = (hay: string | undefined, needle: string) => !!hay && hay.toLowerCase().includes(needle.toLowerCase());
  if (m.with && ![row.peerGhii, row.openedBy, row.openedTo, row.lastSenderGhii, row.viaAgent].some(x => has(x, m.with!))) return false;
  if (m.subject && !has(row.subject, m.subject)) return false;
  if (m.body && !has(row.lastMessage, m.body)) return false;
  if (m.olderThanDays && !(ms(row.updatedAt) < now - m.olderThanDays * DAY_MS)) return false;
  return true;
}

/** Somebody other than the owner's own agents wrote into the thread after this moment. */
const foreignAfter = <T>(row: OrganizableRow<T>, iso: string): boolean =>
  !!row.lastForeignAt && ms(row.lastForeignAt) > ms(iso);

function archiveOf<T>(row: OrganizableRow<T>, rec: InboxOrganize, own: boolean, rule: InboxRule | undefined, now: number): RowArchive | undefined {
  const id = row.conversationId;
  const archivedAt = rec.archived[id];
  const keptAt = rec.kept[id];
  if (archivedAt && (!keptAt || ms(archivedAt) > ms(keptAt)) && !foreignAfter(row, archivedAt)) {
    return { reason: 'manual', since: archivedAt };
  }
  // Brought back by hand: neither a rule nor the age limit may send it back on its own.
  if (keptAt) return undefined;
  if (rule?.action === 'archive' && !foreignAfter(row, rule.createdAt)) {
    return { reason: 'rule', since: rule.createdAt, rule: rule.name };
  }
  // Unread that waits for the OWNER keeps the thread. Their agents' traffic with each other counts
  // as unread in the owner's mailbox too, and letting that hold the thread would keep exactly the
  // threads this setting exists for.
  if (rec.autoArchive.enabled && own && (row.unreadToOwner ?? row.unread) === 0) {
    const limit = ms(row.updatedAt) + rec.autoArchive.days * DAY_MS;
    if (limit < now) return { reason: 'age', since: new Date(limit).toISOString() };
  }
  return undefined;
}

/**
 * May this row fold under a head that stands for several threads? A thread nobody answered can: its
 * newest message is still the opener's. Between the owner's own agents a thread can fold answered
 * too, as long as nobody else ever wrote in it, because there the answer is the ACK.
 */
function foldable<T>(row: OrganizableRow<T>, own: boolean): boolean {
  if (own && !row.lastForeignAt) return true;
  return !!row.openedBy && row.lastSenderGhii === row.openedBy;
}

/** The head of a fold: the newest copy, carrying the rest and the unread count of all of them. */
function foldHead<T extends OrganizableRow<T>>(copies: T[], mark: (head: T) => Partial<OrganizableRow<T>>): T {
  copies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [head, ...rest] = copies;
  return {
    ...head,
    // The badge is what the person is owed: unread in a folded row means unread ANYWHERE under it,
    // or opening the newest copy would clear a count that belonged to the others.
    unread: copies.reduce((n, c) => n + c.unread, 0),
    ...mark(head),
    folded: rest,
  };
}

/**
 * Collapse the copies of one broadcast into a single row.
 *
 * One announcement to twenty recipients is twenty separate 1:1 threads, and that is deliberate: each
 * recipient answers privately, and the answer belongs to them. What it is not is twenty rows in one
 * list within the same minute, which is what a real inbox looked like on 2026-09-06 — a list of 149
 * conversations whose three unread ones were buried under the repetition.
 *
 * THE RULE IS THE LAST MESSAGE'S BROADCAST ID, and everything follows from that one choice. A copy
 * nobody has answered still ends on the announcement, so it folds. The moment someone REPLIES their
 * thread's newest message is the reply, which carries no broadcastId, and their row lifts out on its
 * own with nothing having to detect a reply. An answer cannot be folded away.
 *
 * A row is grouped by the broadcast AND by whose mailbox it came from: `viaAgent` rows are an agent's
 * outbound copies read from outside, and the owner's own rows are what arrived. Folding those two
 * together would put "what my agent sent" and "what I received" under one heading, which is two
 * different facts.
 *
 * A group of one is left alone: there is nothing to fold, and a lone copy that renders as a broadcast
 * would be a worse row than the thread it actually is.
 */
export function foldBroadcasts<T extends OrganizableRow<T>>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  const singles: T[] = [];
  for (const row of rows) {
    if (!row.broadcastId) { singles.push(row); continue; }
    const key = `${row.broadcastId} ${row.viaAgent ?? ''}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const out = [...singles];
  for (const copies of groups.values()) {
    if (copies.length === 1) { out.push(copies[0]); continue; }
    out.push(foldHead(copies, () => ({ broadcastCount: copies.length })));
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** Rows a fold rule matched collapse into one row per rule, when there are two or more of them. */
function foldByRule<T extends OrganizableRow<T>>(rows: T[], ruleOf: Map<T, InboxRule | undefined>, own: Map<T, boolean>): T[] {
  const byRule = new Map<string, { rule: InboxRule; copies: T[] }>();
  const out: T[] = [];
  for (const row of rows) {
    const rule = ruleOf.get(row);
    if (row.folded?.length || rule?.action !== 'fold' || !foldable(row, own.get(row) ?? false)) { out.push(row); continue; }
    const entry = byRule.get(rule.id) ?? { rule, copies: [] };
    entry.copies.push(row);
    byRule.set(rule.id, entry);
  }
  for (const { rule, copies } of byRule.values()) {
    if (copies.length === 1) { out.push(copies[0]); continue; }
    out.push(foldHead(copies, () => ({ fold: { kind: 'rule', count: copies.length, label: rule.name } })));
  }
  return out;
}

/** Threads with the same opener and subject, opened within SUBJECT_FOLD_WINDOW_MS of the first, fold. */
function foldBySubject<T extends OrganizableRow<T>>(rows: T[], own: Map<T, boolean>): T[] {
  const buckets = new Map<string, T[]>();
  const out: T[] = [];
  for (const row of rows) {
    if (row.folded?.length || !row.subject || !row.openedBy || !row.openedAt || !foldable(row, own.get(row) ?? false)) { out.push(row); continue; }
    const key = `${row.openedBy} ${row.subject.trim().toLowerCase()} ${row.viaAgent ?? ''}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => ms(a.openedAt) - ms(b.openedAt));
    let cluster: T[] = [];
    const flush = () => {
      if (cluster.length === 1) out.push(cluster[0]);
      else if (cluster.length > 1) {
        const copies = cluster;
        out.push(foldHead(copies, head => ({ fold: { kind: 'subject', count: copies.length, label: head.subject ?? '' } })));
      }
      cluster = [];
    };
    for (const row of bucket) {
      if (cluster.length && ms(row.openedAt) - ms(cluster[0].openedAt) > SUBJECT_FOLD_WINDOW_MS) flush();
      cluster.push(row);
    }
    flush();
  }
  return out;
}

/**
 * Place every row. Sections first (archive wins over everything, then a group rule, then own agents,
 * then people), then the folds inside each section: a broadcast, a fold rule, a shared subject. The
 * result is newest first, as the list has always been; a client groups it by `section`.
 */
export function organizeConversations<T extends OrganizableRow<T>>(rows: T[], rec: InboxOrganize, ownerGhii: string, now: number = Date.now()): T[] {
  const ruleOf = new Map<T, InboxRule | undefined>();
  const ownOf = new Map<T, boolean>();
  const buckets = new Map<string, T[]>();

  for (const row of rows) {
    const own = isOwnAgentRow(row, ownerGhii);
    const rule = rec.rules.find(r => ruleMatches(r, row, own, now));
    const archived = archiveOf(row, rec, own, rule, now);
    const section: InboxSection = archived ? 'archive' : rule?.action === 'group' ? 'group' : own ? 'agents' : 'people';
    const placed = {
      ...row,
      section,
      ...(archived ? { archived } : {}),
      ...(section === 'group' && rule ? { group: rule.name } : {}),
    } as T;
    ruleOf.set(placed, rule);
    ownOf.set(placed, own);
    const key = section === 'group' ? `group ${placed.group}` : section;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(placed);
    else buckets.set(key, [placed]);
  }

  const out: T[] = [];
  for (const bucket of buckets.values()) {
    let rowsIn = foldBroadcasts(bucket);
    rowsIn = foldByRule(rowsIn, ruleOf, ownOf);
    if (rec.foldSameSubject) rowsIn = foldBySubject(rowsIn, ownOf);
    out.push(...rowsIn);
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}
