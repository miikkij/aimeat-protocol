/**
 * @file src/config/help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's settings for Ask someone who knows ("Kysy osaajalta",
 *   services/help/): whether it is on, the defaults a new member gets, the morsels a helper earns,
 *   the times a question lives, and the report about what was asked. Its own file because config.ts
 *   and config-types.ts are at the line ceiling. The rows that make these editable are in
 *   services/config/schema-help.ts.
 *
 *   MORSELS ARE A PACER, NOT A PAYMENT. A helper earns them for a solved question; they buy nothing,
 *   and the operator decides whether and how many (Jouni, 2026-11-14: "tämä ajaa yhteistyöhön").
 *   The monthly cap and the pair cap keep two people from feeding each other.
 *
 *   THE REPORT IS WRITTEN BY THE OPERATOR'S OWN AI BY DEFAULT. The scheduled job only counts, without
 *   names; the operator's AI writes the text through MCP or a ready prompt and stores it after the
 *   operator saw it, as the compliance report does (Jouni, 2026-11-14). `helpReportWriter` 'node-ai'
 *   has the node's own model write it instead, when the operator set one.
 * @structure HelpConfig · helpDefaults()
 * @usage
 *   import { helpDefaults } from './help.js';
 *   const config = { ...helpDefaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */

/** Declared here, not picked from AimeatConfig, so this file imports nothing (config/decide.ts gives the reason). */
export interface HelpConfig {
  /** The whole feature. Off: the home block, the page, the tools and the skill leave this node. */
  helpEnabled: boolean;
  /** Who may take part: every member ('members') or only members of at least one organism ('organism-members'). */
  helpParticipation: string;
  /** The shared list: a question nobody was found for may be put where any helper can take it. */
  helpBoardEnabled: boolean;
  /** A member who has not chosen may ask. On by default (Jouni, 2026-11-14, for an organisation node). */
  helpAskerDefault: boolean;
  /** A member who has not chosen receives questions. Off by default: helping is always the person's own choice. */
  helpHelperDefault: boolean;
  /** The weekly limit a new helper starts with. */
  helpCapPerWeekDefault: number;
  /** A helper may let their AI answer on its own in topics they pick. Off: an AI only drafts. */
  helpAiAutoAllowed: boolean;
  /** Morsels for a solved question at all. */
  helpRewardEnabled: boolean;
  /** Morsels for one solved question. */
  helpReward: number;
  /** More morsels when the helper lets the answer be kept for others. */
  helpRewardKnowledge: number;
  /** An answer the helper's AI wrote on its own earns 'same', 'half' or 'none'. */
  helpRewardAi: string;
  /** At most this many help morsels to one helper in a calendar month. */
  helpRewardMonthlyCap: number;
  /** At most this many rewarded questions between the same asker and helper in a month. */
  helpRewardPairCap: number;
  /** A question waits this many days for an answer before it expires. */
  helpQuestionDays: number;
  /** A helper who does not answer in this many hours is skipped and the next one asked. */
  helpRerouteHours: number;
  /** A kept answer is confirmed by its helper this often, in months; unconfirmed it is marked stale. */
  helpReviewMonths: number;
  /** A helper's topic nobody asked about in this many days: the helper is asked whether to keep it. */
  helpTopicReviewDays: number;
  /** The report: 'monthly', 'weekly', 'both' or 'off'. */
  helpReportCadence: string;
  /** Who writes the report: 'operator-ai' (the operator's own AI, the default) or 'node-ai'. */
  helpReportWriter: string;
  /** What the report's writer reads: 'topics' (topics, times, states) or 'questions' (also the question texts, without names). */
  helpReportReads: string;
  /** Account names who receive the report besides the operators. */
  helpReportRecipients: string[];
  /** The operator's own instructions for the report; empty uses the built-in prompt. */
  helpReportPrompt: string;
  /** Months a written report is kept. */
  helpReportRetentionMonths: number;
  /** Where "Add to the development queue" writes a suggestion: `<organism id>/<workspace id>`. Empty: the button is off. */
  helpBacklogWorkspace: string;
  /** An installed extension whose `rank` action orders the candidate helpers. Empty: the built-in order. */
  helpRoutingExtension: string;
}

const int = (raw: string | undefined, fallback: number): number => {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const oneOf = (raw: string | undefined, values: readonly string[], fallback: string): string =>
  raw && values.includes(raw) ? raw : fallback;

/** The settings of Ask someone who knows, from the environment. */
export function helpDefaults(): HelpConfig {
  return {
    helpEnabled: process.env.AIMEAT_HELP_ENABLED !== 'false',
    helpParticipation: oneOf(process.env.AIMEAT_HELP_PARTICIPATION, ['members', 'organism-members'], 'members'),
    helpBoardEnabled: process.env.AIMEAT_HELP_BOARD_ENABLED !== 'false',
    helpAskerDefault: process.env.AIMEAT_HELP_ASKER_DEFAULT !== 'false',
    helpHelperDefault: process.env.AIMEAT_HELP_HELPER_DEFAULT === 'true',
    helpCapPerWeekDefault: int(process.env.AIMEAT_HELP_CAP_PER_WEEK_DEFAULT, 2),
    helpAiAutoAllowed: process.env.AIMEAT_HELP_AI_AUTO_ALLOWED !== 'false',
    helpRewardEnabled: process.env.AIMEAT_HELP_REWARD_ENABLED !== 'false',
    helpReward: int(process.env.AIMEAT_HELP_REWARD, 5),
    helpRewardKnowledge: int(process.env.AIMEAT_HELP_REWARD_KNOWLEDGE, 2),
    helpRewardAi: oneOf(process.env.AIMEAT_HELP_REWARD_AI, ['same', 'half', 'none'], 'same'),
    helpRewardMonthlyCap: int(process.env.AIMEAT_HELP_REWARD_MONTHLY_CAP, 100),
    helpRewardPairCap: int(process.env.AIMEAT_HELP_REWARD_PAIR_CAP, 3),
    helpQuestionDays: int(process.env.AIMEAT_HELP_QUESTION_DAYS, 7),
    helpRerouteHours: int(process.env.AIMEAT_HELP_REROUTE_HOURS, 48),
    helpReviewMonths: int(process.env.AIMEAT_HELP_REVIEW_MONTHS, 6),
    helpTopicReviewDays: int(process.env.AIMEAT_HELP_TOPIC_REVIEW_DAYS, 90),
    helpReportCadence: oneOf(process.env.AIMEAT_HELP_REPORT_CADENCE, ['monthly', 'weekly', 'both', 'off'], 'monthly'),
    helpReportWriter: oneOf(process.env.AIMEAT_HELP_REPORT_WRITER, ['operator-ai', 'node-ai'], 'operator-ai'),
    helpReportReads: oneOf(process.env.AIMEAT_HELP_REPORT_READS, ['topics', 'questions'], 'topics'),
    helpReportRecipients: (process.env.AIMEAT_HELP_REPORT_RECIPIENTS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    helpReportPrompt: process.env.AIMEAT_HELP_REPORT_PROMPT ?? '',
    helpReportRetentionMonths: int(process.env.AIMEAT_HELP_REPORT_RETENTION_MONTHS, 24),
    helpBacklogWorkspace: process.env.AIMEAT_HELP_BACKLOG_WORKSPACE ?? '',
    helpRoutingExtension: process.env.AIMEAT_HELP_ROUTING_EXTENSION ?? '',
  };
}
