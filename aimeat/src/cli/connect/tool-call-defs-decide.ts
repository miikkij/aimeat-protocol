/**
 * @file cli/connect/tool-call-defs-decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decision tools for the shell / local-call dispatch (TARGET-080): ask, read, review,
 *   run over many records, read the settings.
 *
 *   THE THIRD SURFACE, the one a fleet daemon calls. Every field the node MCP declares is forwarded
 *   here, and test/unit/cli-tool-param-forwarding.test.ts proves each one leaves the process: a
 *   parameter dropped on this door makes the call come back ok having done less than asked.
 * @structure decideTools[] -- the shell handler table, registered by tool-call.ts
 * @usage import { decideTools } from './tool-call-defs-decide.js';
 * @version-history
 *   v1.0.0 -- 2026-09-19 -- Initial (TARGET-080).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import {
  requiredString, optionalString, optionalNumber, optionalBoolean, optionalArray, optionalRecord,
  requiredValue, requiredRecord,
} from './tool-call-helpers.js';

/** The optional fields decide and a run start share, copied across when present. */
function common(input: JsonObject, body: JsonObject): JsonObject {
  const gates = optionalString(input, 'gates');
  const thresholds = optionalRecord(input, 'thresholds');
  const names = optionalArray(input, 'names');
  const appId = optionalString(input, 'app_id');
  if (gates !== undefined) body.gates = gates;
  if (thresholds) body.thresholds = thresholds;
  if (names) body.names = names.filter((n): n is string => typeof n === 'string');
  if (appId !== undefined) body.app_id = appId;
  return body;
}

export const decideTools: ConnectCliToolDefinition[] = [
  {
    // → POST /v1/ai/decide
    name: 'aimeat_decide',
    description: 'Ask the decision model typed questions (noul, choice, score) about a state; the node scrubs personal data first, meters the call and records the decision. Instructions and criteria in English.',
    input: {
      state: { type: 'object', required: true, description: 'What is being judged: a string, an object with named fields, or an array.' },
      questions: { type: 'object', required: true, description: 'Your ids to { type, instructions, criteria }.' },
      subject: { type: 'string', description: 'What the decision is about.' },
      gates: { type: 'string', description: 'What the answer decides.' },
      thresholds: { type: 'object', description: 'The thresholds you will apply.' },
      names: { type: 'array', description: 'Extra person names to remove before sending.' },
      public_content: { type: 'boolean', description: 'The content is already public; honoured only when the owner allows it.' },
      cache: { type: 'boolean', description: 'Reuse an identical earlier decision (default true).' },
      app_id: { type: 'string', description: 'App attribution for the per-app quota.' },
    },
    handler: ({ client }, input) => {
      const body: JsonObject = {
        state: requiredValue(input, 'state') as JsonObject,
        questions: requiredRecord(input, 'questions'),
      };
      const subject = optionalString(input, 'subject');
      const publicContent = optionalBoolean(input, 'public_content');
      const cache = optionalBoolean(input, 'cache');
      if (subject !== undefined) body.subject = subject;
      if (publicContent !== undefined) body.public_content = publicContent;
      if (cache !== undefined) body.cache = cache;
      return client.post('/v1/ai/decide', common(input, body));
    },
  },
  {
    // → GET /v1/ai/decisions[/:id]
    name: 'aimeat_decision_list',
    description: 'Read what the decision model decided, newest first, or one decision by id.',
    input: {
      decision_id: { type: 'string', description: 'Read one decision.' },
      subject: { type: 'string', description: 'Only decisions about this subject.' },
      app_id: { type: 'string', description: 'Only decisions made for this app.' },
      limit: { type: 'number', description: 'How many (1-200, default 50).' },
      before: { type: 'string', description: 'Only decisions made before this ISO time.' },
    },
    handler: ({ client }, input) => {
      const id = optionalString(input, 'decision_id');
      if (id) return client.get(`/v1/ai/decisions/${encodeURIComponent(id)}`);
      const q = new URLSearchParams();
      const subject = optionalString(input, 'subject');
      const appId = optionalString(input, 'app_id');
      const limit = optionalNumber(input, 'limit');
      const before = optionalString(input, 'before');
      if (subject !== undefined) q.set('subject', subject);
      if (appId !== undefined) q.set('app_id', appId);
      if (limit !== undefined) q.set('limit', String(limit));
      if (before !== undefined) q.set('before', before);
      const qs = q.toString();
      return client.get(`/v1/ai/decisions${qs ? `?${qs}` : ''}`);
    },
  },
  {
    // → POST /v1/ai/decisions/:id/review
    name: 'aimeat_decision_review',
    description: 'Record that a person confirmed or overrode a decision.',
    input: {
      decision_id: { type: 'string', required: true, description: 'The decision.' },
      outcome: { type: 'string', required: true, description: 'confirmed | overridden' },
      note: { type: 'string', description: 'Why, in the person\'s words.' },
      override: { type: 'object', description: 'What the person decided instead.' },
    },
    handler: ({ client }, input) => {
      const body: JsonObject = { outcome: requiredString(input, 'outcome') };
      const note = optionalString(input, 'note');
      const override = optionalRecord(input, 'override');
      if (note !== undefined) body.note = note;
      if (override) body.override = override;
      return client.post(`/v1/ai/decisions/${encodeURIComponent(requiredString(input, 'decision_id'))}/review`, body);
    },
  },
  {
    // → /v1/ai/decide/runs[/:id[/resume|/stop]]
    name: 'aimeat_decide_run',
    description: 'Ask the same questions of many records in the background: start, get, list, resume or stop a run.',
    input: {
      action: { type: 'string', required: true, description: 'start | get | list | resume | stop' },
      run_id: { type: 'string', description: 'The run, for get, resume and stop.' },
      questions: { type: 'object', description: 'For start: the questions.' },
      items: { type: 'array', description: 'For start: [{ subject, state }].' },
      keys: { type: 'array', description: 'For start: owner memory keys.' },
      prefix: { type: 'string', description: 'For start: every owner record under this key prefix.' },
      fields: { type: 'array', description: 'For start: keep only these top-level fields.' },
      gates: { type: 'string', description: 'What the answers decide.' },
      thresholds: { type: 'object', description: 'The thresholds you will apply.' },
      names: { type: 'array', description: 'Extra person names to remove before sending.' },
      app_id: { type: 'string', description: 'App attribution for the per-app quota.' },
    },
    handler: ({ client }, input) => {
      const action = requiredString(input, 'action');
      if (action === 'list') return client.get('/v1/ai/decide/runs');
      if (action === 'start') {
        const body: JsonObject = {};
        const questions = optionalRecord(input, 'questions');
        const items = optionalArray(input, 'items');
        const keys = optionalArray(input, 'keys');
        const prefix = optionalString(input, 'prefix');
        const fields = optionalArray(input, 'fields');
        if (questions) body.questions = questions;
        if (items) body.items = items as JsonObject[];
        if (keys) body.keys = keys.filter((k): k is string => typeof k === 'string');
        if (prefix !== undefined) body.prefix = prefix;
        if (fields) body.fields = fields.filter((f): f is string => typeof f === 'string');
        return client.post('/v1/ai/decide/runs', common(input, body));
      }
      const id = encodeURIComponent(requiredString(input, 'run_id'));
      if (action === 'get') return client.get(`/v1/ai/decide/runs/${id}`);
      return client.post(`/v1/ai/decide/runs/${id}/${action === 'stop' ? 'stop' : 'resume'}`, {});
    },
  },
  {
    // → GET /v1/ai/decide/settings
    name: 'aimeat_decide_settings',
    description: 'Read the owner\'s decision-model settings (never the key). The owner changes them on the AI settings page.',
    input: {},
    handler: ({ client }) => client.get('/v1/ai/decide/settings'),
  },
];
