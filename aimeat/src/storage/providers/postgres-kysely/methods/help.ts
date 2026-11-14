/**
 * @file src/storage/providers/postgres-kysely/methods/help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HelpRepository on PostgreSQL (tables "HelpParticipant", "HelpQuestion", "HelpRoute";
 *   migration 0131). Mirrors the SQLite methods of the same file name. A question is replaced by ONE
 *   UPDATE conditional on its version, so under READ COMMITTED a second writer re-reads the row the
 *   first one changed and its version test fails: two helpers answering, or the asker closing while
 *   the sweep expires the question, cannot both win. JSON fields are TEXT, read and written whole, so
 *   both backends store the same bytes. Times are ISO strings from the caller's clock and compare as
 *   TEXT.
 * @structure helpMethods · toParticipant · toQuestion · toRoute · listLimit · parse helpers
 * @usage Object.assign(PostgresKyselyStorage.prototype, helpMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial
 */
import type { Kysely } from 'kysely';
import { logger } from '../../../../utils/logger.js';
import type { DB } from '../db-types.js';
import type {
  HelpParticipantRecord, HelpQuestionRecord, HelpRouteRecord, HelpListOptions, HelpQuestionFilter,
  HelpQuestionState, HelpDraft, HelpAttachment,
} from '../../../types/help.js';

/**
 * Only `db` and `transaction` are used here, so the `this` type names those rather than the whole
 * storage class. Importing PostgresKyselyStorage from ../index.js would be an import cycle, because
 * index.ts binds this module onto the prototype.
 */
type Db = { db: Kysely<DB>; transaction<T>(fn: () => Promise<T>): Promise<T> };
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
const bool = (v: unknown): boolean => v === true || v === 1 || v === 't';

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

/** The columns of one question row, without id and version. */
function questionColumns(q: HelpQuestionRecord) {
  return {
    ownerGhii: q.ownerGhii, askedBy: q.askedBy, subject: q.subject, question: q.question, tried: q.tried ?? '',
    topics: JSON.stringify(q.topics ?? []), attachments: JSON.stringify(q.attachments ?? []), audience: q.audience,
    state: q.state, answeredBy: q.answeredBy, answeredByAi: q.answeredByAi, answer: q.answer ?? '',
    thanks: q.thanks ?? '', rewardMorsels: q.rewardMorsels ?? 0, saved: q.saved, savedConfirmedAt: q.savedConfirmedAt,
    stale: q.stale, deadline: q.deadline, remindedAt: q.remindedAt, createdAt: q.createdAt, updatedAt: q.updatedAt,
    closedAt: q.closedAt,
  };
}

/** The columns of one route row, without id. */
function routeColumns(r: HelpRouteRecord) {
  return {
    questionId: r.questionId, helperGhii: r.helperGhii, conversationId: r.conversationId, routedAt: r.routedAt,
    outcome: r.outcome, outcomeAt: r.outcomeAt, referredTo: r.referredTo,
    draft: r.draft ? JSON.stringify(r.draft) : null, answer: r.answer ?? '', answeredByAi: r.answeredByAi,
    keepAllowed: r.keepAllowed,
  };
}

export const helpMethods = {
  async getHelpParticipant(this: Db, ownerGhii: string): Promise<HelpParticipantRecord | null> {
    const row = await this.db.selectFrom('HelpParticipant').selectAll().where('ownerGhii', '=', ownerGhii).executeTakeFirst();
    return row ? toParticipant(row as unknown as Row) : null;
  },

  async putHelpParticipant(this: Db, p: HelpParticipantRecord): Promise<void> {
    const cols = {
      helper: p.helper, asker: p.asker, topics: JSON.stringify(p.topics ?? []), audience: p.audience,
      capPerWeek: p.capPerWeek, status: p.status, statusUntil: p.statusUntil, aiMode: p.aiMode,
      autoTopics: JSON.stringify(p.autoTopics ?? []), aiMaySend: p.aiMaySend, agentsMayAsk: p.agentsMayAsk,
      updatedAt: p.updatedAt,
    };
    await this.db.insertInto('HelpParticipant').values({ ownerGhii: p.ownerGhii, ...cols, createdAt: p.createdAt })
      .onConflict(oc => oc.column('ownerGhii').doUpdateSet(cols))
      .execute();
  },

  async listHelpers(this: Db, opts?: HelpListOptions): Promise<HelpParticipantRecord[]> {
    const rows = await this.db.selectFrom('HelpParticipant').selectAll().where('helper', '=', true)
      .orderBy('ownerGhii').limit(listLimit(opts)).execute();
    return rows.map(r => toParticipant(r as unknown as Row));
  },

  async createHelpQuestion(this: Db, q: HelpQuestionRecord): Promise<void> {
    await this.db.insertInto('HelpQuestion').values({ id: q.id, ...questionColumns(q), version: q.version ?? 1 }).execute();
  },

  async getHelpQuestion(this: Db, id: string): Promise<HelpQuestionRecord | null> {
    const row = await this.db.selectFrom('HelpQuestion').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toQuestion(row as unknown as Row) : null;
  },

  async updateHelpQuestion(this: Db, q: HelpQuestionRecord, expectedVersion: number): Promise<boolean> {
    // The owner and the creation time never change; every other column is the record as given.
    const cols: Partial<ReturnType<typeof questionColumns>> = questionColumns(q);
    delete cols.ownerGhii;
    delete cols.createdAt;
    const res = await this.db.updateTable('HelpQuestion')
      .set({ ...cols, version: expectedVersion + 1 })
      .where('id', '=', q.id).where('version', '=', expectedVersion)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) === 1;
  },

  async listHelpQuestionsByOwner(this: Db, ownerGhii: string, opts?: HelpListOptions): Promise<HelpQuestionRecord[]> {
    const rows = await this.db.selectFrom('HelpQuestion').selectAll().where('ownerGhii', '=', ownerGhii)
      .orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(listLimit(opts)).execute();
    return rows.map(r => toQuestion(r as unknown as Row));
  },

  async listHelpQuestions(this: Db, filter?: HelpQuestionFilter): Promise<HelpQuestionRecord[]> {
    let q = this.db.selectFrom('HelpQuestion').selectAll();
    if (filter?.states?.length) q = q.where('state', 'in', filter.states);
    if (filter?.audience) q = q.where('audience', '=', filter.audience);
    if (filter?.saved !== undefined) q = q.where('saved', '=', filter.saved);
    if (filter?.since) q = q.where('createdAt', '>=', filter.since);
    const rows = await q.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(listLimit(filter)).execute();
    return rows.map(r => toQuestion(r as unknown as Row));
  },

  async listHelpQuestionsDue(this: Db, states: HelpQuestionState[], before: string, opts?: HelpListOptions): Promise<HelpQuestionRecord[]> {
    if (states.length === 0) return [];
    const rows = await this.db.selectFrom('HelpQuestion').selectAll()
      .where('state', 'in', states).where('deadline', '<=', before)
      .orderBy('deadline', 'asc').orderBy('id', 'asc').limit(listLimit(opts)).execute();
    return rows.map(r => toQuestion(r as unknown as Row));
  },

  async addHelpRoute(this: Db, route: HelpRouteRecord): Promise<void> {
    await this.db.insertInto('HelpRoute').values({ id: route.id, ...routeColumns(route) }).execute();
  },

  async updateHelpRoute(this: Db, route: HelpRouteRecord): Promise<void> {
    // The question, the helper and the time it was sent never change.
    const cols: Partial<ReturnType<typeof routeColumns>> = routeColumns(route);
    delete cols.questionId;
    delete cols.helperGhii;
    delete cols.routedAt;
    await this.db.updateTable('HelpRoute').set(cols).where('id', '=', route.id).execute();
  },

  async listHelpRoutes(this: Db, questionId: string, opts?: HelpListOptions): Promise<HelpRouteRecord[]> {
    const rows = await this.db.selectFrom('HelpRoute').selectAll().where('questionId', '=', questionId)
      .orderBy('routedAt', 'asc').orderBy('id', 'asc').limit(listLimit(opts)).execute();
    return rows.map(r => toRoute(r as unknown as Row));
  },

  async listHelpRoutesForHelper(this: Db, helperGhii: string, opts?: HelpListOptions & { since?: string }): Promise<HelpRouteRecord[]> {
    let q = this.db.selectFrom('HelpRoute').selectAll().where('helperGhii', '=', helperGhii);
    if (opts?.since) q = q.where('routedAt', '>=', opts.since);
    const rows = await q.orderBy('routedAt', 'desc').orderBy('id', 'desc').limit(listLimit(opts)).execute();
    return rows.map(r => toRoute(r as unknown as Row));
  },

  async getHelpRouteByConversation(this: Db, conversationId: string): Promise<HelpRouteRecord | null> {
    const row = await this.db.selectFrom('HelpRoute').selectAll().where('conversationId', '=', conversationId)
      .orderBy('routedAt', 'desc').limit(1).executeTakeFirst();
    return row ? toRoute(row as unknown as Row) : null;
  },

  async listPendingHelpRoutes(this: Db, before: string, opts?: HelpListOptions): Promise<HelpRouteRecord[]> {
    const rows = await this.db.selectFrom('HelpRoute').selectAll()
      .where('outcome', '=', 'pending').where('routedAt', '<=', before)
      .orderBy('routedAt', 'asc').orderBy('id', 'asc').limit(listLimit(opts)).execute();
    return rows.map(r => toRoute(r as unknown as Row));
  },

  async deleteHelpDataByOwner(this: Db, ownerGhii: string): Promise<number> {
    return this.transaction(async () => {
      const ids = (await this.db.selectFrom('HelpQuestion').select('id').where('ownerGhii', '=', ownerGhii).execute())
        .map(r => r.id);
      let n = 0;
      if (ids.length) {
        const r1 = await this.db.deleteFrom('HelpRoute').where('questionId', 'in', ids).executeTakeFirst();
        n += Number(r1.numDeletedRows);
      }
      const r2 = await this.db.deleteFrom('HelpQuestion').where('ownerGhii', '=', ownerGhii).executeTakeFirst();
      const r3 = await this.db.deleteFrom('HelpRoute').where('helperGhii', '=', ownerGhii).executeTakeFirst();
      const r4 = await this.db.deleteFrom('HelpParticipant').where('ownerGhii', '=', ownerGhii).executeTakeFirst();
      return n + Number(r2.numDeletedRows) + Number(r3.numDeletedRows) + Number(r4.numDeletedRows);
    });
  },

  async purgeClosedHelpQuestions(this: Db, before: string): Promise<number> {
    return this.transaction(async () => {
      const ids = (await this.db.selectFrom('HelpQuestion').select('id')
        .where('state', 'in', ['solved', 'expired', 'cancelled']).where('saved', '=', false)
        .where('closedAt', 'is not', null).where('closedAt', '<', before)
        .execute()).map(r => r.id);
      if (ids.length === 0) return 0;
      await this.db.deleteFrom('HelpRoute').where('questionId', 'in', ids).execute();
      await this.db.deleteFrom('HelpQuestion').where('id', 'in', ids).execute();
      return ids.length;
    });
  },
};
