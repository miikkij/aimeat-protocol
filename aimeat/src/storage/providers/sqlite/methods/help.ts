/**
 * @file src/storage/providers/sqlite/methods/help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HelpRepository on SQLite (tables help_participants, help_questions, help_routes;
 *   schema-help.ts). Mirrors the PostgreSQL methods of the same file name. A question is replaced by
 *   ONE UPDATE conditional on its version, so two writers acting on the same question (two helpers
 *   answering, the asker closing while the sweep expires it) cannot both win. Times are ISO strings
 *   from the caller's clock and compare as TEXT.
 * @structure helpMethods · toParticipant · toQuestion · toRoute · listLimit · parse helpers
 * @usage Object.assign(SqliteStorage.prototype, helpMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial
 */
import type Database from 'better-sqlite3';
import { logger } from '../../../../utils/logger.js';
import type {
  HelpParticipantRecord, HelpQuestionRecord, HelpRouteRecord, HelpListOptions, HelpQuestionFilter,
  HelpQuestionState, HelpDraft, HelpAttachment,
} from '../../../types/help.js';

/**
 * Only `db` is used here, so the `this` type names that field rather than the whole storage class.
 * Importing SqliteStorage from ../index.js would be an import cycle, because index.ts binds this
 * module onto the prototype.
 */
type Db = { db: Database.Database };
type Row = Record<string, unknown>;

/** Parse a JSON text column; a missing or malformed value answers undefined. */
function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    // A malformed column reads as its empty default (repository contract), and the fault is logged.
    logger.warn('help: a JSON column did not parse', { error: String(err) });
    return undefined;
  }
}

function strings(raw: unknown): string[] {
  const v = parseJson(raw);
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/** The attachments column: objects with a storage key; anything else is dropped. */
function attachmentsOf(raw: unknown): HelpAttachment[] {
  const v = parseJson(raw);
  if (!Array.isArray(v)) return [];
  return v.filter((a): a is HelpAttachment => !!a && typeof a === 'object' && typeof (a as HelpAttachment).storage_key === 'string');
}

function draftOf(raw: unknown): HelpDraft | null {
  const v = parseJson(raw);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return typeof o.answer === 'string' && typeof o.by === 'string' && typeof o.at === 'string'
    ? { answer: o.answer, by: o.by, at: o.at } : null;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Number(v) === 1;
const bit = (v: boolean): number => (v ? 1 : 0);

function toParticipant(r: Row): HelpParticipantRecord {
  return {
    ownerGhii: r.ownerGhii as string,
    helper: bool(r.helper),
    asker: r.asker === null || r.asker === undefined ? null : bool(r.asker),
    topics: strings(r.topics),
    audience: r.audience as HelpParticipantRecord['audience'],
    capPerWeek: Number(r.capPerWeek ?? 2),
    status: r.status as HelpParticipantRecord['status'],
    statusUntil: str(r.statusUntil),
    aiMode: r.aiMode as HelpParticipantRecord['aiMode'],
    autoTopics: strings(r.autoTopics),
    aiMaySend: bool(r.aiMaySend),
    agentsMayAsk: bool(r.agentsMayAsk),
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

function toQuestion(r: Row): HelpQuestionRecord {
  return {
    id: r.id as string,
    ownerGhii: r.ownerGhii as string,
    askedBy: r.askedBy as string,
    subject: r.subject as string,
    question: r.question as string,
    tried: (r.tried as string) ?? '',
    topics: strings(r.topics),
    attachments: attachmentsOf(r.attachments),
    audience: r.audience as HelpQuestionRecord['audience'],
    state: r.state as HelpQuestionState,
    answeredBy: str(r.answeredBy),
    answeredByAi: bool(r.answeredByAi),
    answer: (r.answer as string) ?? '',
    thanks: (r.thanks as string) ?? '',
    rewardMorsels: Number(r.rewardMorsels ?? 0),
    saved: bool(r.saved),
    savedConfirmedAt: str(r.savedConfirmedAt),
    stale: bool(r.stale),
    deadline: r.deadline as string,
    remindedAt: str(r.remindedAt),
    version: Number(r.version ?? 1),
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
    closedAt: str(r.closedAt),
  };
}

function toRoute(r: Row): HelpRouteRecord {
  return {
    id: r.id as string,
    questionId: r.questionId as string,
    helperGhii: r.helperGhii as string,
    conversationId: r.conversationId as string,
    routedAt: r.routedAt as string,
    outcome: r.outcome as HelpRouteRecord['outcome'],
    outcomeAt: str(r.outcomeAt),
    referredTo: str(r.referredTo),
    draft: draftOf(r.draft),
    answer: (r.answer as string) ?? '',
    answeredByAi: bool(r.answeredByAi),
    keepAllowed: bool(r.keepAllowed),
  };
}

/** The row count a list answers: opts.limit, 200 by default, between 1 and 1000. */
function listLimit(opts?: HelpListOptions): number {
  const n = Number(opts?.limit ?? 200);
  return Number.isFinite(n) ? Math.min(1000, Math.max(1, Math.floor(n))) : 200;
}

/** The named parameters of one question row. */
function questionParams(q: HelpQuestionRecord): Record<string, unknown> {
  return {
    id: q.id, ownerGhii: q.ownerGhii, askedBy: q.askedBy, subject: q.subject, question: q.question,
    tried: q.tried ?? '', topics: JSON.stringify(q.topics ?? []), attachments: JSON.stringify(q.attachments ?? []),
    audience: q.audience, state: q.state, answeredBy: q.answeredBy, answeredByAi: bit(q.answeredByAi),
    answer: q.answer ?? '', thanks: q.thanks ?? '', rewardMorsels: q.rewardMorsels ?? 0, saved: bit(q.saved),
    savedConfirmedAt: q.savedConfirmedAt, stale: bit(q.stale), deadline: q.deadline, remindedAt: q.remindedAt,
    createdAt: q.createdAt, updatedAt: q.updatedAt, closedAt: q.closedAt,
  };
}

/** The named parameters of one route row. */
function routeParams(r: HelpRouteRecord): Record<string, unknown> {
  return {
    id: r.id, questionId: r.questionId, helperGhii: r.helperGhii, conversationId: r.conversationId,
    routedAt: r.routedAt, outcome: r.outcome, outcomeAt: r.outcomeAt, referredTo: r.referredTo,
    draft: r.draft ? JSON.stringify(r.draft) : null, answer: r.answer ?? '', answeredByAi: bit(r.answeredByAi),
    keepAllowed: bit(r.keepAllowed),
  };
}

export const helpMethods = {
  async getHelpParticipant(this: Db, ownerGhii: string): Promise<HelpParticipantRecord | null> {
    const row = this.db.prepare('SELECT * FROM help_participants WHERE ownerGhii = ?').get(ownerGhii) as Row | undefined;
    return row ? toParticipant(row) : null;
  },

  async putHelpParticipant(this: Db, p: HelpParticipantRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO help_participants (ownerGhii, helper, asker, topics, audience, capPerWeek, status, statusUntil,
         aiMode, autoTopics, aiMaySend, agentsMayAsk, createdAt, updatedAt)
       VALUES (@ownerGhii, @helper, @asker, @topics, @audience, @capPerWeek, @status, @statusUntil,
         @aiMode, @autoTopics, @aiMaySend, @agentsMayAsk, @createdAt, @updatedAt)
       ON CONFLICT(ownerGhii) DO UPDATE SET helper = excluded.helper, asker = excluded.asker, topics = excluded.topics,
         audience = excluded.audience, capPerWeek = excluded.capPerWeek, status = excluded.status,
         statusUntil = excluded.statusUntil, aiMode = excluded.aiMode, autoTopics = excluded.autoTopics,
         aiMaySend = excluded.aiMaySend, agentsMayAsk = excluded.agentsMayAsk, updatedAt = excluded.updatedAt`,
    ).run({
      ownerGhii: p.ownerGhii, helper: bit(p.helper), asker: p.asker === null ? null : bit(p.asker),
      topics: JSON.stringify(p.topics ?? []), audience: p.audience, capPerWeek: p.capPerWeek, status: p.status,
      statusUntil: p.statusUntil, aiMode: p.aiMode, autoTopics: JSON.stringify(p.autoTopics ?? []),
      aiMaySend: bit(p.aiMaySend), agentsMayAsk: bit(p.agentsMayAsk), createdAt: p.createdAt, updatedAt: p.updatedAt,
    });
  },

  async listHelpers(this: Db, opts?: HelpListOptions): Promise<HelpParticipantRecord[]> {
    const rows = this.db.prepare('SELECT * FROM help_participants WHERE helper = 1 ORDER BY ownerGhii LIMIT ?')
      .all(listLimit(opts)) as Row[];
    return rows.map(toParticipant);
  },

  async createHelpQuestion(this: Db, q: HelpQuestionRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO help_questions (id, ownerGhii, askedBy, subject, question, tried, topics, attachments, audience,
         state, answeredBy, answeredByAi, answer, thanks, rewardMorsels, saved, savedConfirmedAt, stale, deadline,
         remindedAt, version, createdAt, updatedAt, closedAt)
       VALUES (@id, @ownerGhii, @askedBy, @subject, @question, @tried, @topics, @attachments, @audience,
         @state, @answeredBy, @answeredByAi, @answer, @thanks, @rewardMorsels, @saved, @savedConfirmedAt, @stale, @deadline,
         @remindedAt, @version, @createdAt, @updatedAt, @closedAt)`,
    ).run({ ...questionParams(q), version: q.version ?? 1 });
  },

  async getHelpQuestion(this: Db, id: string): Promise<HelpQuestionRecord | null> {
    const row = this.db.prepare('SELECT * FROM help_questions WHERE id = ?').get(id) as Row | undefined;
    return row ? toQuestion(row) : null;
  },

  async updateHelpQuestion(this: Db, q: HelpQuestionRecord, expectedVersion: number): Promise<boolean> {
    const res = this.db.prepare(
      `UPDATE help_questions SET subject = @subject, question = @question, tried = @tried, topics = @topics,
         attachments = @attachments, audience = @audience, state = @state, answeredBy = @answeredBy,
         answeredByAi = @answeredByAi, answer = @answer, thanks = @thanks, rewardMorsels = @rewardMorsels,
         saved = @saved, savedConfirmedAt = @savedConfirmedAt, stale = @stale, deadline = @deadline,
         remindedAt = @remindedAt, updatedAt = @updatedAt, closedAt = @closedAt, version = @nextVersion
       WHERE id = @id AND version = @expectedVersion`,
    ).run({ ...questionParams(q), nextVersion: expectedVersion + 1, expectedVersion });
    return res.changes === 1;
  },

  async listHelpQuestionsByOwner(this: Db, ownerGhii: string, opts?: HelpListOptions): Promise<HelpQuestionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM help_questions WHERE ownerGhii = ? ORDER BY createdAt DESC, id DESC LIMIT ?')
      .all(ownerGhii, listLimit(opts)) as Row[];
    return rows.map(toQuestion);
  },

  async listHelpQuestions(this: Db, filter?: HelpQuestionFilter): Promise<HelpQuestionRecord[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter?.states?.length) {
      where.push(`state IN (${filter.states.map(() => '?').join(', ')})`);
      args.push(...filter.states);
    }
    if (filter?.audience) { where.push('audience = ?'); args.push(filter.audience); }
    if (filter?.saved !== undefined) { where.push('saved = ?'); args.push(bit(filter.saved)); }
    if (filter?.since) { where.push('createdAt >= ?'); args.push(filter.since); }
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM help_questions ${sqlWhere} ORDER BY createdAt DESC, id DESC LIMIT ?`)
      .all(...args, listLimit(filter)) as Row[];
    return rows.map(toQuestion);
  },

  async listHelpQuestionsDue(this: Db, states: HelpQuestionState[], before: string, opts?: HelpListOptions): Promise<HelpQuestionRecord[]> {
    if (states.length === 0) return [];
    const rows = this.db.prepare(
      `SELECT * FROM help_questions WHERE state IN (${states.map(() => '?').join(', ')}) AND deadline <= ?
       ORDER BY deadline ASC, id ASC LIMIT ?`,
    ).all(...states, before, listLimit(opts)) as Row[];
    return rows.map(toQuestion);
  },

  async addHelpRoute(this: Db, route: HelpRouteRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO help_routes (id, questionId, helperGhii, conversationId, routedAt, outcome, outcomeAt, referredTo,
         draft, answer, answeredByAi, keepAllowed)
       VALUES (@id, @questionId, @helperGhii, @conversationId, @routedAt, @outcome, @outcomeAt, @referredTo,
         @draft, @answer, @answeredByAi, @keepAllowed)`,
    ).run(routeParams(route));
  },

  async updateHelpRoute(this: Db, route: HelpRouteRecord): Promise<void> {
    this.db.prepare(
      `UPDATE help_routes SET conversationId = @conversationId, outcome = @outcome, outcomeAt = @outcomeAt,
         referredTo = @referredTo, draft = @draft, answer = @answer, answeredByAi = @answeredByAi,
         keepAllowed = @keepAllowed
       WHERE id = @id`,
    ).run(routeParams(route));
  },

  async listHelpRoutes(this: Db, questionId: string, opts?: HelpListOptions): Promise<HelpRouteRecord[]> {
    const rows = this.db.prepare('SELECT * FROM help_routes WHERE questionId = ? ORDER BY routedAt ASC, id ASC LIMIT ?')
      .all(questionId, listLimit(opts)) as Row[];
    return rows.map(toRoute);
  },

  async listHelpRoutesForHelper(this: Db, helperGhii: string, opts?: HelpListOptions & { since?: string }): Promise<HelpRouteRecord[]> {
    const rows = opts?.since
      ? this.db.prepare('SELECT * FROM help_routes WHERE helperGhii = ? AND routedAt >= ? ORDER BY routedAt DESC, id DESC LIMIT ?')
        .all(helperGhii, opts.since, listLimit(opts)) as Row[]
      : this.db.prepare('SELECT * FROM help_routes WHERE helperGhii = ? ORDER BY routedAt DESC, id DESC LIMIT ?')
        .all(helperGhii, listLimit(opts)) as Row[];
    return rows.map(toRoute);
  },

  async getHelpRouteByConversation(this: Db, conversationId: string): Promise<HelpRouteRecord | null> {
    const row = this.db.prepare('SELECT * FROM help_routes WHERE conversationId = ? ORDER BY routedAt DESC LIMIT 1')
      .get(conversationId) as Row | undefined;
    return row ? toRoute(row) : null;
  },

  async listPendingHelpRoutes(this: Db, before: string, opts?: HelpListOptions): Promise<HelpRouteRecord[]> {
    const rows = this.db.prepare(
      `SELECT * FROM help_routes WHERE outcome = 'pending' AND routedAt <= ? ORDER BY routedAt ASC, id ASC LIMIT ?`,
    ).all(before, listLimit(opts)) as Row[];
    return rows.map(toRoute);
  },

  async deleteHelpDataByOwner(this: Db, ownerGhii: string): Promise<number> {
    return this.db.transaction(() => {
      const ids = (this.db.prepare('SELECT id FROM help_questions WHERE ownerGhii = ?').all(ownerGhii) as Row[])
        .map(r => r.id as string);
      let n = 0;
      for (const id of ids) n += this.db.prepare('DELETE FROM help_routes WHERE questionId = ?').run(id).changes;
      n += this.db.prepare('DELETE FROM help_questions WHERE ownerGhii = ?').run(ownerGhii).changes;
      n += this.db.prepare('DELETE FROM help_routes WHERE helperGhii = ?').run(ownerGhii).changes;
      n += this.db.prepare('DELETE FROM help_participants WHERE ownerGhii = ?').run(ownerGhii).changes;
      return n;
    })();
  },

  async purgeClosedHelpQuestions(this: Db, before: string): Promise<number> {
    return this.db.transaction(() => {
      const ids = (this.db.prepare(
        `SELECT id FROM help_questions WHERE state IN ('solved', 'expired', 'cancelled') AND saved = 0
           AND closedAt IS NOT NULL AND closedAt < ?`,
      ).all(before) as Row[]).map(r => r.id as string);
      for (const id of ids) {
        this.db.prepare('DELETE FROM help_routes WHERE questionId = ?').run(id);
        this.db.prepare('DELETE FROM help_questions WHERE id = ?').run(id);
      }
      return ids.length;
    })();
  },
};
