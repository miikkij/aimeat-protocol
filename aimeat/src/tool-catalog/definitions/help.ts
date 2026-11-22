/**
 * @file src/tool-catalog/definitions/help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Ask someone who knows ("Kysy osaajalta") on MCP: find a kept answer or a helper, ask,
 *   read what is asked of the owner and what they asked, answer or pass, close a question with
 *   thanks, set the owner's choices, and, for an operator, the report about what people asked. Each
 *   tool is the REST route of the same purpose in routes/help/ and calls the same function in
 *   services/help/, so the AI level, the weekly limits, the morsels and every refusal are decided there.
 *
 *   BEHIND help:ask AND help:answer, outside every wildcard (utils/scope-coverage.ts): both speak to
 *   other people in the owner's name. The owner's own choices still apply on top: an AI sends a
 *   question only when the owner allowed it, and answers on its own only in the owner's chosen topics.
 * @structure HELP_*_FIELDS · helpTools — aimeat_help_find · _ask · _inbox · _respond · _close ·
 *   _profile_set · _report_data · _report_write
 * @usage imported by tool-catalog/definitions.ts into the catalog
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const HELP_PROFILE_FIELDS = ['helper', 'asker', 'topics', 'audience', 'cap_per_week', 'status', 'status_until', 'ai_mode', 'auto_topics', 'ai_may_send', 'agents_may_ask'] as const;
export const HELP_FIND_FIELDS = ['question', 'query', 'topics'] as const;
export const HELP_ASK_FIELDS = ['question', 'subject', 'tried', 'topics', 'people', 'helpers', 'to_board', 'attachments'] as const;
export const HELP_RESPOND_FIELDS = ['action', 'answer', 'to', 'keep_allowed'] as const;
export const HELP_CLOSE_FIELDS = ['action', 'helper', 'thanks', 'keep', 'days'] as const;
export const HELP_REPORT_WRITE_FIELDS = ['text', 'suggestions', 'decisions', 'dry_run'] as const;

const ASK_NOTE = 'Needs help:ask, which no wildcard includes: the owner ticks it per agent. The skill aimeat-ask-someone-who-knows has the whole way of working.';
const ANSWER_NOTE = 'Needs help:answer, which no wildcard includes: the owner ticks it per agent. The skill aimeat-ask-someone-who-knows has the whole way of working.';

const topics = { type: 'array', description: 'Topics in plain words, such as "Entra" or "invoicing report". At most 40.', zod: z.array(z.string().max(60)).max(40) } as const;
const questionId = { type: 'string', required: true, description: 'The question\'s id (hq_…), from aimeat_help_inbox or the answer of aimeat_help_ask.', zod: z.string().max(INPUT_LIMITS.id) } as const;

export const helpTools = [
    {
        name: 'aimeat_help_find',
        description: 'Before anyone is asked: find a kept answer to the same question on this node, and the members who could answer it. `kept` lists answers helpers allowed to keep for the next person, confirmed ones first (a `stale` one has not been confirmed lately; say so when you offer it). `helpers` lists members who chose to receive questions about these topics, with the topics that matched; it never shows how busy anyone is. When a kept answer solves it, nobody needs to be asked. Give the question in the person\'s words and the topics you read from it. '
            + ASK_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Find a Kept Answer or a Helper', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'help:ask',
        surfaces: ['agent', 'admin'],
        input: {
            question: { type: 'string', description: 'The question in the person\'s words.', zod: z.string().max(8000) },
            query: { type: 'string', description: 'Or a few search words.', zod: z.string().max(2000) },
            topics,
        },
    },
    {
        name: 'aimeat_help_ask',
        description: 'Ask a member of this node a question in your owner\'s name. Show your owner the question exactly as it will be sent, and send it only on their yes. The node sends it to the best matching helper (or `helpers: 2` for two at once, or the members named in `people`), as an ordinary message thread in their inbox; they answer themselves or through their AI. '
            + 'Write `question` so a colleague understands it without the conversation: what the person is doing, what they want, and in `tried` what they already tried. Attach files in the direct-message attachment shape (storage_key, mime, size, kind) only when your owner agreed. '
            + 'When nobody matches, the answer says `nobody_found: true` and nothing was sent: offer to put it on the shared list (`to_board: true`), where any helper can take it, or to name someone. '
            + 'Refusals say what to do: ASKING_OFF (your owner switched asking off), AI_MAY_NOT_ASK (your owner has not let their AI send; show them the question so they send it themselves), NOT_A_HELPER (a named person cannot take it now). '
            + ASK_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Ask Someone Who Knows', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'help:ask',
        surfaces: ['agent', 'admin'],
        input: {
            question: { type: 'string', required: true, description: 'The question, in the asker\'s words, complete enough for someone who did not see the conversation.', zod: z.string().min(1).max(8000) },
            subject: { type: 'string', description: 'One line that names it (the thread\'s title). Default: the first line of the question.', zod: z.string().max(200) },
            tried: { type: 'string', description: 'What the asker already tried.', zod: z.string().max(4000) },
            topics,
            people: { type: 'array', description: 'Optional: one or two members to ask, as account names. They must have chosen to receive questions.', zod: z.array(z.string().max(INPUT_LIMITS.email)).max(2) },
            helpers: { type: 'number', description: '1 (the default) or 2: how many matching helpers get it at once.', zod: z.number().int().min(1).max(2) },
            to_board: { type: 'boolean', description: 'Put it on the shared list instead, where any helper can take it.' },
            attachments: {
                type: 'array', description: 'Files to send with it, in the form a direct message uses.',
                zod: z.array(z.object({ storage_key: z.string().max(512), mime: z.string().max(128), size: z.number().int().nonnegative(), kind: z.enum(['image', 'audio', 'video', 'file']), name: z.string().max(256).optional() })).max(10),
            },
        },
    },
    {
        name: 'aimeat_help_inbox',
        description: 'Your owner\'s side of Ask someone who knows in one read: `me` (their choices: `helper` (may others ask them), `topics`, and what their AI may do: `aiMode` off, draft or auto, with `autoTopics`), `asked_of_me` (questions sent to them, each with its conversation_id, the asker, the topics, any `draft` their AI wrote, and `my_outcome`), `mine` (their own questions, with the answers and whether a helper is still deciding), and `board` (the shared list, when they are a helper). Go through `asked_of_me` with your owner when they look at their questions: for each, say who asks and what, and offer to answer, draft, pass or refer. Within `me.autoTopics` you may answer on your own; elsewhere write a draft. '
            + ASK_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Questions Asked of Me, and Mine', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'help:ask',
        surfaces: ['agent', 'admin'],
        input: {
            include_closed: { type: 'boolean', description: 'Also list closed questions (solved, expired, cancelled).' },
        },
    },
    {
        name: 'aimeat_help_respond',
        description: 'Act on a question sent to your owner. action "answer" (the default): send `answer` into the question\'s thread in your owner\'s name. The node decides by your owner\'s AI level: with "auto" and the question in their auto topics it is sent and marked as written by you; otherwise it is stored as a DRAFT your owner approves (the answer says `outcome: "drafted"`), and with "off" it is refused. Write the answer from your owner\'s own memory and knowledge only. "approve": your owner approves the draft (a person only). "pass": your owner has no time; it goes to the next helper and nobody is told who passed. "refer": send it to member `to`, who must have chosen to receive questions. "take": take a question from the shared list. "confirm_kept": your owner confirms that a kept answer of theirs still holds. `keep_allowed: true` on an answer lets the asker keep it for the next person who asks. '
            + ANSWER_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Answer, Pass or Refer a Question', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'help:answer',
        surfaces: ['agent', 'admin'],
        input: {
            question_id: questionId,
            action: { type: 'string', enum: ['answer', 'approve', 'pass', 'refer', 'take', 'confirm_kept'], description: 'answer (the default), approve, pass, refer, take or confirm_kept.' },
            answer: { type: 'string', description: 'The answer, for answer; for approve, an edited version of the draft (optional).', zod: z.string().max(16000) },
            to: { type: 'string', description: 'For refer: the member\'s account name.', zod: z.string().max(INPUT_LIMITS.email) },
            keep_allowed: { type: 'boolean', description: 'The helper allows this answer to be kept for others when the asker marks it solved.' },
        },
    },
    {
        name: 'aimeat_help_close',
        description: 'Close a question your owner asked. action "solved" (the default): with `thanks` in their words, and `helper` when two answered (default: the first who answered). The helper is told and, when the operator has it on, gets morsels: a pacer, not a payment. `keep: true` keeps the answer for the next person, when the helper allowed it. "cancel": withdraw it. "extend": give it `days` more (1 to 30). Ask your owner before you close: it is their judgement whether it was solved. '
            + ASK_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Close a Question', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'help:ask',
        surfaces: ['agent', 'admin'],
        input: {
            question_id: questionId,
            action: { type: 'string', enum: ['solved', 'cancel', 'extend'], description: 'solved (the default), cancel or extend.' },
            helper: { type: 'string', description: 'For solved: whose answer solved it, as an account name.', zod: z.string().max(INPUT_LIMITS.email) },
            thanks: { type: 'string', description: 'For solved: the thanks, in your owner\'s words.', zod: z.string().max(1000) },
            keep: { type: 'boolean', description: 'For solved: keep the answer for the next person who asks (only when the helper allowed it).' },
            days: { type: 'number', description: 'For extend: how many more days, 1 to 30.', zod: z.number().int().min(1).max(30) },
        },
    },
    {
        name: 'aimeat_help_profile_set',
        description: 'Change your owner\'s choices in Ask someone who knows; only the fields given change, and the answer is the whole set. `helper`: others may ask them. `topics`: what they may be asked about, in their words; suggest them from their business card (the card\'s knowsAbout and skills), never from their private interview answers, and set them only on their yes. `audience`: "node" (every member) or "organisms" (only members of their shared places). `cap_per_week`: at most this many questions in seven days (1 to 50). `status`: available, busy or away, with `status_until`. `asker`: they may ask. You may lower what you are allowed (a lower AI level, fewer auto topics) but not raise it: a higher `ai_mode`, more `auto_topics`, `ai_may_send` or `agents_may_ask` is the person\'s own change, on the page Ask someone who knows. The answer\'s `participant` names the same choices in camelCase (aiMode, autoTopics, capPerWeek, statusUntil, aiMaySend, agentsMayAsk). '
            + ANSWER_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Set My Choices: Ask Someone Who Knows', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'help:answer',
        surfaces: ['agent', 'admin'],
        input: {
            helper: { type: 'boolean', description: 'Others may send them questions.' },
            asker: { type: 'boolean', description: 'They may ask.' },
            topics,
            audience: { type: 'string', enum: ['node', 'organisms'], description: 'Who may ask them.' },
            cap_per_week: { type: 'number', description: 'At most this many questions in seven days, 1 to 50.', zod: z.number().int().min(1).max(50) },
            status: { type: 'string', enum: ['available', 'busy', 'away'], description: 'Their status; busy and away take them out of routing.' },
            status_until: { type: 'string', description: 'When the status ends, ISO 8601, or empty.', zod: z.string().max(64) },
            ai_mode: { type: 'string', enum: ['off', 'draft', 'auto'], description: 'What their AI may do: nothing, write drafts, or answer on its own in auto_topics.' },
            auto_topics: { ...topics, description: 'The topics in which their AI may answer on its own; each must be one of their topics.' },
            ai_may_send: { type: 'boolean', description: 'Their AI may write and send questions in their name, showing each one first.' },
            agents_may_ask: { type: 'boolean', description: 'Their agents running on their own may ask in their name.' },
        },
    },
    {
        name: 'aimeat_help_report_data',
        description: 'For an operator: the figures of one report of Ask someone who knows, without names (what was asked, solved, expired; the first answer\'s median time; kept answers; morsels; topics with no helper; how the load spreads), the previous report\'s suggestions, and `prompt`, the instructions for writing it. Without `id`, the newest. With `make` ("monthly" or "weekly"), the figures of the period that ended are made now when the scheduled job has not made them. Write the report from these, show it to the operator, then store it with aimeat_help_report_write (dry_run first). Needs an operator account; its agent needs operator:admin.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Help Report: Figures', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', description: 'The period: YYYY-MM for a month, YYYY-Www for a week.', zod: z.string().max(16) },
            make: { type: 'string', enum: ['monthly', 'weekly'], description: 'Make the figures of the month or week that ended, if they are not made yet.' },
        },
    },
    {
        name: 'aimeat_help_report_write',
        description: 'For an operator: store the report you wrote from aimeat_help_report_data. `text` is the report in Markdown, in the operator\'s language: a summary, what help was needed and where (each group as a process, an application or a shared place), repeating questions, topics with no helper, and how the load spreads, never naming anyone. `suggestions` are at most five next steps, each `{ title, why }`. Call with `dry_run: true` first, show the operator, and store on their yes. `decisions` (`[{ n, decision: "queue" | "reject" }]`) decide stored suggestions; "queue" writes one into the development queue the operator named in the settings. Needs an operator account; its agent needs operator:admin.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Help Report: Store the Text', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', required: true, description: 'The period, as aimeat_help_report_data answered it.', zod: z.string().max(16) },
            text: { type: 'string', description: 'The report in Markdown.', zod: z.string().max(40000) },
            suggestions: { type: 'array', description: 'At most eight next steps, each { title, why }.', zod: z.array(z.object({ title: z.string().max(300), why: z.string().max(600).optional() })).max(8) },
            decisions: { type: 'array', description: 'Decisions on stored suggestions: [{ n, decision: "queue" | "reject" }].', zod: z.array(z.object({ n: z.number().int(), decision: z.enum(['queue', 'reject']) })).max(8) },
            dry_run: { type: 'boolean', description: 'Show what would be stored, store nothing.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
