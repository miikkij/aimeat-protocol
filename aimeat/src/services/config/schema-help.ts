/**
 * @file src/services/config/schema-help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows of Ask someone who knows (config/help.ts). Its own file because
 *   schema.ts is at the line ceiling; spread into CONFIG_FIELDS. The operator edits them on
 *   Admin › Ask someone who knows › Settings and on the Config tab.
 * @structure HELP_CONFIG_FIELDS
 * @usage import { HELP_CONFIG_FIELDS } from './schema-help.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { HelpConfig } from '../../config/help.js';
import type { ConfigFieldShape } from './field-def.js';
import { oneOf } from './schema-validators.js';

const whole = (min: number, max: number) => (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const bool = (v: unknown): boolean => typeof v === 'boolean';
const names = (v: unknown): boolean => Array.isArray(v) && v.length <= 50
  && v.every(s => typeof s === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(s));
const backlog = (v: unknown): boolean => typeof v === 'string' && (v === '' || /^[\w-]{1,128}\/[\w-]{1,128}(\/[\w.-]{1,128})?$/.test(v));

export const HELP_CONFIG_FIELDS: ConfigFieldShape<keyof HelpConfig>[] = [
  { key: 'helpEnabled', dotPath: 'help.enabled', envVar: 'AIMEAT_HELP_ENABLED', type: 'boolean', validate: bool, immutable: false, description: 'Ask someone who knows: members ask each other, and helpers answer themselves or through their AI. Off removes the home block, the page, the tools and the skill' },
  { key: 'helpParticipation', dotPath: 'help.participation', envVar: 'AIMEAT_HELP_PARTICIPATION', type: 'string', ...oneOf('members', 'organism-members'), immutable: false, description: 'Who may take part: every member, or only members of at least one organism' },
  { key: 'helpBoardEnabled', dotPath: 'help.board_enabled', envVar: 'AIMEAT_HELP_BOARD_ENABLED', type: 'boolean', validate: bool, immutable: false, description: 'A question nobody was found for may go on the shared list, where any helper can take it' },
  { key: 'helpAskerDefault', dotPath: 'help.asker_default', envVar: 'AIMEAT_HELP_ASKER_DEFAULT', type: 'boolean', validate: bool, immutable: false, description: 'A member who has not chosen may ask' },
  { key: 'helpHelperDefault', dotPath: 'help.helper_default', envVar: 'AIMEAT_HELP_HELPER_DEFAULT', type: 'boolean', validate: bool, immutable: false, description: 'A member who has not chosen receives questions. Off by default: helping is the member\'s own choice' },
  { key: 'helpCapPerWeekDefault', dotPath: 'help.cap_per_week_default', envVar: 'AIMEAT_HELP_CAP_PER_WEEK_DEFAULT', type: 'number', validate: whole(1, 50), immutable: false, description: 'The most questions a new helper gets in seven days; each helper may change their own', range: '1-50' },
  { key: 'helpAiAutoAllowed', dotPath: 'help.ai_auto_allowed', envVar: 'AIMEAT_HELP_AI_AUTO_ALLOWED', type: 'boolean', validate: bool, immutable: false, description: 'A helper may let their AI answer on its own in topics they choose. Off: an AI only drafts, and the helper approves every answer' },
  { key: 'helpRewardEnabled', dotPath: 'help.reward_enabled', envVar: 'AIMEAT_HELP_REWARD_ENABLED', type: 'boolean', validate: bool, immutable: false, description: 'A helper gets morsels when a question they answered is solved. Morsels are not a payment' },
  { key: 'helpReward', dotPath: 'help.reward', envVar: 'AIMEAT_HELP_REWARD', type: 'number', validate: whole(0, 1000), immutable: false, description: 'Morsels for one solved question', range: '0-1000' },
  { key: 'helpRewardKnowledge', dotPath: 'help.reward_knowledge', envVar: 'AIMEAT_HELP_REWARD_KNOWLEDGE', type: 'number', validate: whole(0, 1000), immutable: false, description: 'More morsels when the helper lets the answer be kept for the next person who asks', range: '0-1000' },
  { key: 'helpRewardAi', dotPath: 'help.reward_ai', envVar: 'AIMEAT_HELP_REWARD_AI', type: 'string', ...oneOf('same', 'half', 'none'), immutable: false, description: 'What an answer the helper\'s AI wrote on its own earns: the same, half, or nothing. The morsels go to the helper' },
  { key: 'helpRewardMonthlyCap', dotPath: 'help.reward_monthly_cap', envVar: 'AIMEAT_HELP_REWARD_MONTHLY_CAP', type: 'number', validate: whole(0, 100000), immutable: false, description: 'At most this many help morsels to one helper in a calendar month', range: '0-100000' },
  { key: 'helpRewardPairCap', dotPath: 'help.reward_pair_cap', envVar: 'AIMEAT_HELP_REWARD_PAIR_CAP', type: 'number', validate: whole(0, 100), immutable: false, description: 'At most this many rewarded questions between the same asker and helper in a month, so two people cannot feed each other', range: '0-100' },
  { key: 'helpQuestionDays', dotPath: 'help.question_days', envVar: 'AIMEAT_HELP_QUESTION_DAYS', type: 'number', validate: whole(1, 60), immutable: false, description: 'Days a question waits for an answer. A day before the end the asker is asked whether to continue', range: '1-60' },
  { key: 'helpRerouteHours', dotPath: 'help.reroute_hours', envVar: 'AIMEAT_HELP_REROUTE_HOURS', type: 'number', validate: whole(1, 720), immutable: false, description: 'Hours a helper has to answer before the question goes to the next one', range: '1-720' },
  { key: 'helpReviewMonths', dotPath: 'help.review_months', envVar: 'AIMEAT_HELP_REVIEW_MONTHS', type: 'number', validate: whole(1, 36), immutable: false, description: 'How often a helper confirms a kept answer still holds; an unconfirmed one is marked out of date', range: '1-36' },
  { key: 'helpTopicReviewDays', dotPath: 'help.topic_review_days', envVar: 'AIMEAT_HELP_TOPIC_REVIEW_DAYS', type: 'number', validate: whole(7, 730), immutable: false, description: 'A topic nobody asked about in this many days: the helper is asked whether to keep it', range: '7-730' },
  { key: 'helpReportCadence', dotPath: 'help.report_cadence', envVar: 'AIMEAT_HELP_REPORT_CADENCE', type: 'string', ...oneOf('monthly', 'weekly', 'both', 'off'), immutable: false, description: 'How often the report about what was asked is made' },
  { key: 'helpReportWriter', dotPath: 'help.report_writer', envVar: 'AIMEAT_HELP_REPORT_WRITER', type: 'string', ...oneOf('operator-ai', 'node-ai'), immutable: false, description: 'Who writes the report: the operator\'s own AI (through MCP or a ready prompt) or the node\'s own model' },
  { key: 'helpReportReads', dotPath: 'help.report_reads', envVar: 'AIMEAT_HELP_REPORT_READS', type: 'string', ...oneOf('topics', 'questions'), immutable: false, description: 'What the report\'s writer reads: topics, times and states only, or also the question texts. Never names' },
  { key: 'helpReportRecipients', dotPath: 'help.report_recipients', envVar: 'AIMEAT_HELP_REPORT_RECIPIENTS', type: 'object', list: true, validate: names, immutable: false, description: 'Account names who are told about a new report besides the operators' },
  { key: 'helpReportPrompt', dotPath: 'help.report_prompt', envVar: 'AIMEAT_HELP_REPORT_PROMPT', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 8000, immutable: false, description: 'The operator\'s own instructions for the report. Empty uses the built-in ones' },
  { key: 'helpReportRetentionMonths', dotPath: 'help.report_retention_months', envVar: 'AIMEAT_HELP_REPORT_RETENTION_MONTHS', type: 'number', validate: whole(1, 120), immutable: false, description: 'Months a report is kept', range: '1-120' },
  { key: 'helpBacklogWorkspace', dotPath: 'help.backlog_workspace', envVar: 'AIMEAT_HELP_BACKLOG_WORKSPACE', type: 'string', validate: backlog, immutable: false, description: 'Where a report\'s suggestion goes when the operator adds it to the development queue, as <organism id>/<workspace id>, optionally /<document space> (notes when left out). Empty: the button is off' },
  { key: 'helpRoutingExtension', dotPath: 'help.routing_extension', envVar: 'AIMEAT_HELP_ROUTING_EXTENSION', type: 'string', validate: v => typeof v === 'string' && /^[a-z0-9._-]{0,64}$/i.test(v as string), immutable: false, description: 'An installed extension whose rank action orders the candidate helpers. Empty: the built-in order (fewest questions this week first)' },
];
