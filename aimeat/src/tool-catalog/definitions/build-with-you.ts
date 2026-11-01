/**
 * @file build-with-you.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for "build it with you" ("Rakennamme kanssasi"): the place's one build
 *   request, sent and read by the owner's AI in conversation (aimeat_build_request_submit,
 *   aimeat_build_request_status), and the place's trail (aimeat_trail_list). The operations are in
 *   services/build-with-you.ts and services/place-trail.ts; REST: routes/build-with-you.ts.
 * @structure buildWithYouTools — the three definitions
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.2.0 — 2026-11-01 — With a build code aimeat_build_request_submit sends the request itself, with the
 *     person's own account through the server they attached (BUILD_CONNECT_FIRST, BUILD_SEND_FAILED).
 *   v1.1.0 — 2026-11-01 — buildCode and `send` on the status: the request goes with the person's own
 *     aimeat.io account; the place's own submit is refused where a build code is set.
 *   v1.0.0 — 2026-11-01 — Initial ("Rakennamme kanssasi"; Jouni, 1.11 16.22).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const buildWithYouTools = [
  {
    name: 'aimeat_build_request_submit',
    description: 'Send this place\'s one build request: the first thing the person wants built WITH the operator\'s builders, one agent or one small app (bigger work is a separate paid service). FILL IT IN WITH THE PERSON FIRST, in their words: what to build, who it is for, what it is used for, and when it is ready (a sentence the person can check). Read aimeat_build_request_status before you offer it: it says whether the offer is open and whether a request was already sent. One request per place; a second one is refused. The request waits on the place until the operator takes it to their build queue, usually within minutes, and its status then shows the queue\'s state and place in line. Never promise a time. ON A PLACE WITH A BUILD CODE (aimeat_build_request_status answers buildCode) this one call sends it at once, with the person\'s own account on the builders\' node, through the server they attached for it: call nothing else to send it. BUILD_CONNECT_FIRST means that server is not attached or needs a new sign-in; tell the person the answer\'s sentence. BUILD_SEND_FAILED means the builders\' node did not take it; nothing was stored, so it can be sent again.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Build request: send', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scope: 'memory:write',
    surfaces: ['agent'],
    input: {
      what: { type: 'string', required: true, description: 'What to build, in the person\'s words.' },
      forWhom: { type: 'string', required: true, description: 'Who it is for.' },
      use: { type: 'string', required: true, description: 'What it is used for: the work it does for them.' },
      readyWhen: { type: 'string', required: true, description: 'When it is ready, as a sentence the person can check.' },
      lang: { type: 'string', enum: ['en', 'fi', 'es'], description: 'The language the builders answer in; omit it for the person\'s own.' },
      email: { type: 'string', description: 'Where the builders write, when the person gave an address for it; omit it for the one in their notification settings.' },
    },
  },
  {
    name: 'aimeat_build_request_status',
    description: 'Read this place\'s build request: whether the offer is open (offer.available, and offer.reason: off when the place has no build queue, not-yet before an AI or the chat has been used, used when the request was sent), and the request as it stands: state (waiting-for-operator until the operator takes it to the queue, then queued, building, invited, done or declined), position and queueLength (no time estimate exists, so never give one), and, once the builders invited the person, the organism they work in (organism.name, organism.url) and the address the invitation went to (inviteEmail). Tell the person what it means in their words, and what happens next. buildCode is the store\'s code for this place\'s one request (RK-XXXX-XXXX-XXXX). On such a place, send the request with aimeat_build_request_submit, which calls the builders\' node with the person\'s own account; `send` only describes that call (the node\'s MCP address `send.mcp`, the tool and its arguments), for an AI of the person\'s that is connected to the builders\' node itself.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Build request: status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'memory:read',
    surfaces: ['agent'],
    input: {},
  },
  {
    name: 'aimeat_trail_list',
    description: 'What has been done on this account, newest first: each entry says when (at), who (actorName, and actorKind: person, ai for the person\'s AI over MCP or in the chat, agent, app, operator), what (action, and code: the MCP tool or the REST route), and to what (target). readOnly marks a call that only read. Use it to answer "what did you do", "what has my agent done today" or "who changed this". since (ISO time) and limit (default 100, at most 500) narrow it; next is the before value for the following page.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Trail: what was done', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'memory:read',
    surfaces: ['agent'],
    input: {
      since: { type: 'string', description: 'Only entries at or after this ISO time.' },
      before: { type: 'string', description: 'Only entries before this ISO time: the `next` of the page before.' },
      limit: { type: 'number', description: 'How many entries, 1 to 500 (default 100).' },
    },
  },
] as const satisfies readonly AimeatToolDefinition[];
