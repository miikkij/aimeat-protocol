/**
 * @file src/storage/types/help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Ask someone who knows ("Kysy osaajalta"): a member of this node asks a question, the
 *   node finds one or two members whose chosen topics match, and the question arrives in their inbox
 *   as an ordinary direct message thread. They answer themselves, or their AI answers within the
 *   level they allowed. When the question is solved, the helper may get morsels and the answer may be
 *   kept for the next person who asks. Same node only (Jouni, 2026-11-14).
 *
 *   WHY TABLES AND NOT MEMORY RECORDS. Routing reads every helper's topics, status and weekly load in
 *   one query, and the operator's report counts the whole node. Memory keys would sit in each owner's
 *   own namespace, and a node-wide read of them is a scan of every account.
 *
 *   THREE TABLES.
 *   - HelpParticipant: one row per member who has set their choices: may others ask them, about what,
 *     how often, and what their AI may do. A member without a row has the node's defaults.
 *   - HelpQuestion: one question, its state, who answered, the thanks and the reward, and whether its
 *     answer is kept for others.
 *   - HelpRoute: one row per helper a question was sent to, with the thread it lives in and what that
 *     helper did (answered, passed, referred, timed out). "What was asked of me" and "how many
 *     questions did this helper get this week" are each one indexed query.
 *
 *   WHAT IS NEVER HERE. A member's memory, their private interview answers, or anything the asker did
 *   not write into the question. The routing history (who passed) is shown to nobody but the helper
 *   who passed.
 * @structure HelpAudience · HelpAiMode · HelpParticipantRecord · HelpQuestionState · HelpAttachment · HelpQuestionRecord ·
 *   HelpRouteOutcome · HelpDraft · HelpRouteRecord · HelpListOptions · HelpQuestionFilter · HelpRepository
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */

/** Who may send a helper questions: every member of this node, or only members of the organisms the
 *  helper belongs to. */
export type HelpAudience = 'node' | 'organisms';

/** What a helper's AI may do with a question. off: nothing, the helper answers. draft: the AI writes a
 *  draft and the helper approves it. auto: the AI answers on its own in `autoTopics`, and drafts in
 *  every other topic. */
export type HelpAiMode = 'off' | 'draft' | 'auto';

/** A helper's own status. away and busy take them out of routing until `statusUntil`, when set. */
export type HelpStatus = 'available' | 'busy' | 'away';

export interface HelpParticipantRecord {
  /** The member, as a GHII. */
  ownerGhii: string;
  /** Others may send this member questions. */
  helper: boolean;
  /** This member may ask. Null means the node's default for new members. */
  asker: boolean | null;
  /** The topics this member chose, in their own words, at most 40. */
  topics: string[];
  audience: HelpAudience;
  /** At most this many questions in seven days. */
  capPerWeek: number;
  status: HelpStatus;
  statusUntil: string | null;
  aiMode: HelpAiMode;
  /** The topics in which the AI may answer on its own (aiMode auto). A subset of `topics`. */
  autoTopics: string[];
  /** The member's AI may write and send questions in their name; it shows each one first. */
  aiMaySend: boolean;
  /** The member's agents may ask in their name. */
  agentsMayAsk: boolean;
  createdAt: string;
  updatedAt: string;
}

/** open: sent, waiting for an answer. answered: a helper answered, the asker has not closed it.
 *  solved: the asker said it was solved. expired: nobody answered before the deadline. cancelled:
 *  the asker withdrew it. */
export type HelpQuestionState = 'open' | 'answered' | 'solved' | 'expired' | 'cancelled';

/** people: sent to named helpers or to the ones routing found. board: on the shared list, where any
 *  helper may take it. */
export type HelpQuestionAudience = 'people' | 'board';

/** One attached file, as a direct message carries it (models/message-schemas.ts MessageAttachmentInputSchema). */
export interface HelpAttachment {
  storage_key: string;
  mime: string;
  size: number;
  kind: 'image' | 'audio' | 'video' | 'file';
  name?: string;
}

export interface HelpQuestionRecord {
  id: string;
  /** The person who asks, as a GHII. */
  ownerGhii: string;
  /** Who wrote it: the person in person (their GHII) or their agent (its GAII). */
  askedBy: string;
  /** One line that names the question; the thread's subject. */
  subject: string;
  /** The question itself. */
  question: string;
  /** What the asker already tried. */
  tried: string;
  topics: string[];
  /** The files the asker attached, in the direct-message attachment shape; each helper's copy of the
   *  question carries them, and the message path checks the asker holds each one. */
  attachments: HelpAttachment[];
  audience: HelpQuestionAudience;
  state: HelpQuestionState;
  /** The helper whose answer the asker accepted, or who answered first. */
  answeredBy: string | null;
  /** The accepted answer was written by the helper's AI. */
  answeredByAi: boolean;
  /** The accepted answer's text, kept when `saved` so the next asker can find it. */
  answer: string;
  /** The asker's thanks, shown to the helper. */
  thanks: string;
  /** Morsels credited to the helper when it was solved. */
  rewardMorsels: number;
  /** The helper allowed the question and its answer to be found by others on this node. */
  saved: boolean;
  /** When the helper last confirmed a saved answer still holds. */
  savedConfirmedAt: string | null;
  /** A saved answer nobody confirmed in time; the AI offers it last. */
  stale: boolean;
  /** The question ends here when nobody answered. */
  deadline: string;
  /** The asker was asked whether to continue (one day before the deadline). */
  remindedAt: string | null;
  /** Bumped by every update; an update names the version it read. */
  version: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/** pending: waiting for this helper. answered: they answered. passed: they had no time (shown to no
 *  one). referred: they named someone else. timeout: no answer in the routing window. closed: the
 *  question ended while this route waited. */
export type HelpRouteOutcome = 'pending' | 'answered' | 'passed' | 'referred' | 'timeout' | 'closed';

/** A draft answer the helper's AI wrote and the helper has not yet approved. */
export interface HelpDraft {
  answer: string;
  /** The agent that wrote it, as a GAII. */
  by: string;
  at: string;
}

export interface HelpRouteRecord {
  id: string;
  questionId: string;
  /** The helper, as a GHII. */
  helperGhii: string;
  /** The direct-message thread the question lives in for this helper. */
  conversationId: string;
  routedAt: string;
  outcome: HelpRouteOutcome;
  outcomeAt: string | null;
  /** Whom this helper referred the question to. */
  referredTo: string | null;
  draft: HelpDraft | null;
  /** This helper's answer, as sent. */
  answer: string;
  /** This helper's answer was written by their AI. */
  answeredByAi: boolean;
  /** The helper allows this answer to be kept for others when the asker marks it solved. */
  keepAllowed: boolean;
}

/** How many rows a list answers: `limit` defaults to 200 and is capped at 1000. */
export interface HelpListOptions {
  limit?: number;
}

export interface HelpQuestionFilter extends HelpListOptions {
  states?: HelpQuestionState[];
  audience?: HelpQuestionAudience;
  /** Only questions whose answer is kept for others. */
  saved?: boolean;
  /** Only questions created at or after this time. */
  since?: string;
}

export interface HelpRepository {
  getHelpParticipant(ownerGhii: string): Promise<HelpParticipantRecord | null>;
  /** Insert or replace the member's row. */
  putHelpParticipant(record: HelpParticipantRecord): Promise<void>;
  /** Members who let others ask them, at most `opts.limit` (200 by default, 1000 at most). */
  listHelpers(opts?: HelpListOptions): Promise<HelpParticipantRecord[]>;

  createHelpQuestion(record: HelpQuestionRecord): Promise<void>;
  getHelpQuestion(id: string): Promise<HelpQuestionRecord | null>;
  /**
   * Replace the question when its stored version is `expectedVersion`, in one conditional statement,
   * and store it with version `expectedVersion + 1`. False when another writer got there first.
   */
  updateHelpQuestion(record: HelpQuestionRecord, expectedVersion: number): Promise<boolean>;
  /** The questions this person asked, newest first. */
  listHelpQuestionsByOwner(ownerGhii: string, opts?: HelpListOptions): Promise<HelpQuestionRecord[]>;
  /** Questions across the node, newest first, narrowed by the filter. */
  listHelpQuestions(filter?: HelpQuestionFilter): Promise<HelpQuestionRecord[]>;
  /** Questions whose state is in `states` and whose deadline is at or before `before`. */
  listHelpQuestionsDue(states: HelpQuestionState[], before: string, opts?: HelpListOptions): Promise<HelpQuestionRecord[]>;

  addHelpRoute(route: HelpRouteRecord): Promise<void>;
  /** Replace one route by id. */
  updateHelpRoute(route: HelpRouteRecord): Promise<void>;
  /** The routes of one question, oldest first, at most `opts.limit` (200 by default, 1000 at most). */
  listHelpRoutes(questionId: string, opts?: HelpListOptions): Promise<HelpRouteRecord[]>;
  /** The routes that sent questions to this helper, newest first. */
  listHelpRoutesForHelper(helperGhii: string, opts?: HelpListOptions & { since?: string }): Promise<HelpRouteRecord[]>;
  getHelpRouteByConversation(conversationId: string): Promise<HelpRouteRecord | null>;
  /** Pending routes sent at or before `before`, oldest first. */
  listPendingHelpRoutes(before: string, opts?: HelpListOptions): Promise<HelpRouteRecord[]>;

  /**
   * Remove this person from the feature: the questions they asked and those questions' routes, the
   * routes that sent questions to them, and their participant row. Answers the rows removed.
   */
  deleteHelpDataByOwner(ownerGhii: string): Promise<number>;
  /** Delete closed questions (solved, expired, cancelled) not kept for others, closed before
   *  `before`, with their routes. Answers the questions removed. */
  purgeClosedHelpQuestions(before: string): Promise<number>;
}
