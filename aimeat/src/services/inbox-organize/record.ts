/**
 * @file src/services/inbox-organize/record.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an owner decided about their own Messages list, in one memory record
 *   (`messages.organize.settings`, under a reserved prefix a granted app or a delegated write cannot reach):
 *   which conversations they archived and which they brought back, whether their own agents' traffic
 *   archives itself after N days, whether copies that share an opener and a subject fold into one row,
 *   and the rules that fold, group or archive. The one implementation behind the REST door, the MCP
 *   tools and the list itself.
 *
 *   ONE RECORD, NOT A KEY PER CONVERSATION. An owner archives dozens of threads in a sitting, and a
 *   key each would spend the account's key budget (1000 by default) on bookkeeping. Timestamps per id
 *   are small; the marks are capped and the oldest fall off first.
 *
 *   RESERVED, because the server acts on it: it decides what the owner is SHOWN. An app or an agent
 *   that could write it through the memory API could archive the message warning the owner about that
 *   very app, and the word that is meant to govern this (`messages:organize-as-owner`) would be a
 *   door beside an open wall.
 * @structure INBOX_ORGANIZE_KEY · types · defaultOrganize · normalizeOrganize · readInboxOrganizeStrict ·
 *   readInboxOrganize · archiveConversations · updateInboxOrganize · organizeView
 * @usage const rec = await readInboxOrganize(storage, ghii); await archiveConversations(storage, ghii, ids, false);
 * @version-history
 *   v1.1.0 -- 2026-09-13 -- The per-owner write queue moved to utils/serial-by-key.ts, shared with the
 *     notification settings record. Behaviour unchanged.
 *   v1.0.0 -- 2026-09-13 -- Initial, with the Messages list's sections, rules and archive.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { InboxOrganizePatch, InboxRuleInput } from '../../models/inbox-organize-schemas.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { serialByKey } from '../../utils/serial-by-key.js';

/** Under the reserved `messages.organize.` prefix (utils/reserved-keys.ts). */
export const INBOX_ORGANIZE_KEY = 'messages.organize.settings';

/** The word an agent needs to organise its owner's list. Outside every wildcard (utils/scope-coverage.ts). */
export const MESSAGES_ORGANIZE_AS_OWNER_SCOPE = 'messages:organize-as-owner';

export const AUTO_ARCHIVE_DEFAULT_DAYS = 14;
const MAX_RULES = 50;
/** Per map. Archived and kept marks are dated, so the oldest decisions are the ones that fall off. */
const MAX_MARKS = 5000;

export type RuleAction = 'fold' | 'group' | 'archive';
export type RuleScope = 'agents' | 'all';

export interface InboxRule {
  id: string;
  name: string;
  enabled: boolean;
  action: RuleAction;
  match: { with?: string; subject?: string; body?: string; scope: RuleScope; olderThanDays?: number };
  /** When the rule was written. An archive rule lets a thread back when somebody other than the
   *  owner's own agents writes into it AFTER this moment. */
  createdAt: string;
}

export interface InboxOrganize {
  autoArchive: { enabled: boolean; days: number };
  foldSameSubject: boolean;
  /** conversationId → when the owner archived it. */
  archived: Record<string, string>;
  /** conversationId → when the owner brought it back. Keeps it out of rule and age archiving. */
  kept: Record<string, string>;
  rules: InboxRule[];
}

export function defaultOrganize(): InboxOrganize {
  return { autoArchive: { enabled: true, days: AUTO_ARCHIVE_DEFAULT_DAYS }, foldSameSubject: true, archived: {}, kept: {}, rules: [] };
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;
const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
};
const days = (v: unknown, fallback: number | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(365, Math.max(1, Math.round(v))) : fallback;

function marks(raw: unknown): Record<string, string> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const entries = Object.entries(o).filter((e): e is [string, string] => typeof e[1] === 'string' && ISO.test(e[1]) && e[0].length <= 128);
  return Object.fromEntries(capMarks(entries));
}

function capMarks(entries: Array<[string, string]>): Array<[string, string]> {
  if (entries.length <= MAX_MARKS) return entries;
  return entries.sort((a, b) => b[1].localeCompare(a[1])).slice(0, MAX_MARKS);
}

function normalizeRule(raw: unknown): InboxRule | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const m = (o.match && typeof o.match === 'object' ? o.match : {}) as Record<string, unknown>;
  const name = text(o.name, 80);
  const action = o.action === 'fold' || o.action === 'group' || o.action === 'archive' ? o.action : null;
  if (!name || !action || typeof o.id !== 'string') return null;
  return {
    id: o.id.slice(0, 40),
    name,
    enabled: o.enabled !== false,
    action,
    match: {
      ...(text(m.with, 200) ? { with: text(m.with, 200) } : {}),
      ...(text(m.subject, 200) ? { subject: text(m.subject, 200) } : {}),
      ...(text(m.body, 200) ? { body: text(m.body, 200) } : {}),
      scope: m.scope === 'all' ? 'all' : 'agents',
      ...(days(m.olderThanDays, undefined) ? { olderThanDays: days(m.olderThanDays, undefined) } : {}),
    },
    createdAt: typeof o.createdAt === 'string' && ISO.test(o.createdAt) ? o.createdAt : new Date(0).toISOString(),
  };
}

/** The record as the node will act on it: unknown fields dropped, bad values replaced by defaults. */
export function normalizeOrganize(raw: unknown): InboxOrganize {
  const d = defaultOrganize();
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const a = (o.autoArchive && typeof o.autoArchive === 'object' ? o.autoArchive : {}) as Record<string, unknown>;
  return {
    autoArchive: { enabled: a.enabled !== false, days: days(a.days, d.autoArchive.days)! },
    foldSameSubject: o.foldSameSubject !== false,
    archived: marks(o.archived),
    kept: marks(o.kept),
    rules: (Array.isArray(o.rules) ? o.rules : []).map(normalizeRule).filter((r): r is InboxRule => !!r).slice(0, MAX_RULES),
  };
}

/**
 * The record as it is, and a storage failure THROWN. Every write reads through this: a write that
 * read the forgiving defaults below after a failed read would save them over the owner's archive and
 * rules. The settings door and the settings tool read through it too, so a caller asking what the
 * settings are is told the read failed instead of being handed defaults as the answer.
 */
export async function readInboxOrganizeStrict(storage: Storage, ownerGhii: string): Promise<InboxOrganize> {
  const rec = await storage.getMemory(ownerGhii, INBOX_ORGANIZE_KEY);
  return rec ? normalizeOrganize(rec.value) : defaultOrganize();
}

/** For composing the list: a failed read shows every conversation unorganised rather than none. */
export async function readInboxOrganize(storage: Storage, ownerGhii: string): Promise<InboxOrganize> {
  try {
    return await readInboxOrganizeStrict(storage, ownerGhii);
  } catch (err) {
    // A read failure shows the whole list rather than hiding any of it: nothing archived, no rules.
    logger.warn('inbox-organize: reading the record failed, showing the list unorganised', { error: String(err) });
    return { ...defaultOrganize(), autoArchive: { enabled: false, days: AUTO_ARCHIVE_DEFAULT_DAYS }, foldSameSubject: false };
  }
}

/**
 * Writes for one owner run one after another in this process, so two archive clicks in quick
 * succession cannot read the same record and overwrite each other's mark.
 */
const serialized = <T>(ownerGhii: string, work: () => Promise<T>): Promise<T> => serialByKey(`inbox-organize ${ownerGhii}`, work);

async function writeInboxOrganize(storage: Storage, ownerGhii: string, rec: InboxOrganize): Promise<InboxOrganize> {
  const clean = normalizeOrganize(rec);
  const existing = await storage.getMemory(ownerGhii, INBOX_ORGANIZE_KEY);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: INBOX_ORGANIZE_KEY, ownerGaii: ownerGhii, value: clean, visibility: 'private', tags: ['settings', 'messages'],
    ttlHours: null, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || now, updatedAt: now,
  });
  // The list is composed with this record, so every open Messages page has to look again.
  emitChange('messages');
  return clean;
}

/**
 * Archive conversations, or bring them back. Restoring also marks the thread kept, which is what
 * stops a rule or the age limit from sending it straight back to the archive the moment it left.
 * Archiving clears that mark, so the newer decision is the one that holds.
 */
export function archiveConversations(
  storage: Storage, ownerGhii: string, conversationIds: string[], restore: boolean,
): Promise<{ changed: number; organize: InboxOrganize }> {
  return serialized(ownerGhii, async () => {
    const rec = await readInboxOrganizeStrict(storage, ownerGhii);
    const at = new Date().toISOString();
    const ids = [...new Set(conversationIds)];
    for (const id of ids) {
      if (restore) { delete rec.archived[id]; rec.kept[id] = at; }
      else { rec.archived[id] = at; delete rec.kept[id]; }
    }
    return { changed: ids.length, organize: await writeInboxOrganize(storage, ownerGhii, rec) };
  });
}

export type OrganizeUpdate = { ok: true; organize: InboxOrganize } | { ok: false; code: 'INVALID_INPUT' | 'NOT_FOUND'; message: string };

function ruleFromInput(input: InboxRuleInput, existing: InboxRule | undefined, at: string): InboxRule | string {
  const m = input.match;
  const scope = m.scope ?? 'agents';
  // A rule over EVERY thread with nothing to match on would fold, group or archive the whole list.
  // Over the owner's own agents it is a real wish ("put all my agents' traffic under one heading").
  if (scope === 'all' && !m.with && !m.subject && !m.body && !m.older_than_days) {
    return `Rule "${input.name}" applies to every conversation and names nothing to match. Give it at least one of with, subject, body or older_than_days, or scope it to your agents.`;
  }
  return {
    id: existing?.id ?? input.id ?? randomUUID().slice(0, 8),
    name: input.name,
    enabled: input.enabled ?? existing?.enabled ?? true,
    action: input.action,
    match: {
      ...(m.with ? { with: m.with } : {}), ...(m.subject ? { subject: m.subject } : {}), ...(m.body ? { body: m.body } : {}),
      scope, ...(m.older_than_days ? { olderThanDays: m.older_than_days } : {}),
    },
    createdAt: existing?.createdAt ?? at,
  };
}

/** Change the settings and the rules. `rules` replaces the list; `add_rule` and `remove_rule` edit it. */
export function updateInboxOrganize(storage: Storage, ownerGhii: string, patch: InboxOrganizePatch): Promise<OrganizeUpdate> {
  return serialized(ownerGhii, async () => {
    const rec = await readInboxOrganizeStrict(storage, ownerGhii);
    const at = new Date().toISOString();
    if (patch.auto_archive) {
      rec.autoArchive = {
        enabled: patch.auto_archive.enabled ?? rec.autoArchive.enabled,
        days: patch.auto_archive.days ?? rec.autoArchive.days,
      };
    }
    if (typeof patch.fold_same_subject === 'boolean') rec.foldSameSubject = patch.fold_same_subject;

    const byId = new Map(rec.rules.map(r => [r.id, r] as const));
    let rules = rec.rules;
    if (patch.rules) {
      const next: InboxRule[] = [];
      for (const input of patch.rules) {
        const built = ruleFromInput(input, input.id ? byId.get(input.id) : undefined, at);
        if (typeof built === 'string') return { ok: false, code: 'INVALID_INPUT', message: built };
        next.push(built);
      }
      rules = next;
    }
    if (patch.remove_rule) {
      if (!rules.some(r => r.id === patch.remove_rule)) {
        return { ok: false, code: 'NOT_FOUND', message: `No rule with id "${patch.remove_rule}".` };
      }
      rules = rules.filter(r => r.id !== patch.remove_rule);
    }
    if (patch.add_rule) {
      const existing = patch.add_rule.id ? rules.find(r => r.id === patch.add_rule!.id) : undefined;
      const built = ruleFromInput(patch.add_rule, existing, at);
      if (typeof built === 'string') return { ok: false, code: 'INVALID_INPUT', message: built };
      rules = existing ? rules.map(r => (r.id === existing.id ? built : r)) : [...rules, built];
    }
    if (rules.length > MAX_RULES) return { ok: false, code: 'INVALID_INPUT', message: `At most ${MAX_RULES} rules.` };
    rec.rules = rules;
    return { ok: true, organize: await writeInboxOrganize(storage, ownerGhii, rec) };
  });
}

/** The record as the REST door and the MCP tools show it: snake_case, and counts instead of the id maps. */
export function organizeView(rec: InboxOrganize): Record<string, unknown> {
  return {
    auto_archive: { enabled: rec.autoArchive.enabled, days: rec.autoArchive.days },
    fold_same_subject: rec.foldSameSubject,
    rules: rec.rules.map(r => ({
      id: r.id, name: r.name, enabled: r.enabled, action: r.action,
      match: {
        ...(r.match.with ? { with: r.match.with } : {}), ...(r.match.subject ? { subject: r.match.subject } : {}),
        ...(r.match.body ? { body: r.match.body } : {}), scope: r.match.scope,
        ...(r.match.olderThanDays ? { older_than_days: r.match.olderThanDays } : {}),
      },
      created_at: r.createdAt,
    })),
    archived_count: Object.keys(rec.archived).length,
    kept_count: Object.keys(rec.kept).length,
  };
}
