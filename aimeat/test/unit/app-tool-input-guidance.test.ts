/**
 * @file test/unit/app-tool-input-guidance.test.ts
 * @description What a caller of an app tool is told so that the next call is the right one: the
 *   refusal lists every field the tool accepts with its type and limits and names the bound skill
 *   (services/app/tool-input.ts), a skill's written calls are held to the manifest at publish
 *   (services/skill/tool-fields.ts), one tool is read alone (services/app-tools/one-tool.ts), and an
 *   owner written `user:alice` names alice (services/app/app-ref.ts).
 *
 *   The schema is Lifecycle Central's claim_heartbeat as it stood on 2026-11-21, when an agent that
 *   sent `note` was told only that `note` is refused and that `id` and `session` are required.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-tool-input-guidance.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-app-ty-kalujen-skeemavirheet-ly-korjaa-kutsun-yhdell-yrityks).
 */
import { describe, it, expect } from 'vitest';
import { checkAppToolInput, describeAcceptedFields } from '../../src/services/app/tool-input.js';
import { callFieldsIn, skillToolFieldIssues } from '../../src/services/skill/tool-fields.js';
import { pickManifestTool } from '../../src/services/app-tools/one-tool.js';
import { appOwnerName } from '../../src/services/app/app-ref.js';

const HEARTBEAT = {
  name: 'claim_heartbeat',
  inputSchema: {
    type: 'object',
    required: ['id', 'session'],
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      now: { type: 'string', format: 'date-time' },
      session: { type: 'string', maxLength: 80 },
      sessionId: { type: 'string' },
      area: { type: 'array', items: { type: 'string' } },
      kind: { type: 'string', enum: ['a', 'b'] },
    },
  },
};

describe('the refusal of an app tool\'s input', () => {
  it('lists every accepted field, required ones first, with types and limits', () => {
    expect(describeAcceptedFields(HEARTBEAT.inputSchema)).toBe(
      'Accepted fields: id (string, required); session (string, at most 80 characters, required); '
      + 'area (list of string); kind (one of "a" | "b"); now (string, date-time); sessionId (string). '
      + 'No other field is accepted.',
    );
  });

  it('answers alike whatever order the stored schema\'s keys come back in (jsonb on PostgreSQL)', () => {
    const reordered = { ...HEARTBEAT.inputSchema, required: ['id', 'session'],
      properties: Object.fromEntries(Object.entries(HEARTBEAT.inputSchema.properties).reverse()) };
    expect(describeAcceptedFields(reordered)).toBe(describeAcceptedFields(HEARTBEAT.inputSchema));
  });

  it('names the wrong field, the accepted ones, the bound skill and the one-tool read', () => {
    const check = checkAppToolInput(HEARTBEAT, { id: 'c1', session: 's', note: 'x' }, {
      skills: ['node:aimeat-dev-session'], app: { owner: 'alice', name: 'lifecycle-central' },
    });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toContain('input must NOT have additional properties: "note"');
    expect(check.message).toContain('Accepted fields: id (string, required)');
    expect(check.message).toContain('How this app\'s tools are used is in skill "node:aimeat-dev-session"');
    expect(check.message).toContain('aimeat_app_tools_get { app_id: "lifecycle-central", owner: "alice", tool: "claim_heartbeat" }');
  });

  it('says nothing about skills when the app has none the caller can load', () => {
    const check = checkAppToolInput(HEARTBEAT, {});
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).not.toContain('skill');
  });

  it('a matching input still passes, and a schema with no properties lists nothing', () => {
    expect(checkAppToolInput(HEARTBEAT, { id: 'c1', session: 's', area: ['x'] }).ok).toBe(true);
    expect(describeAcceptedFields({ type: 'object' })).toBe('');
  });
});

describe('a bound skill\'s written calls, held to the manifest', () => {
  it('reads the top-level field names of every call written as tool { … }', () => {
    const text = 'Beat with `claim_heartbeat { id, session, sessionId? }`, or when the area changes '
      + 'claim_heartbeat { id: "c", session: "s", area: ["a", "b"], note: "why, and more" }.';
    expect(callFieldsIn(text, 'claim_heartbeat').sort()).toEqual(['area', 'id', 'note', 'session', 'sessionId']);
    expect(callFieldsIn('claim_heartbeat_extra { x }', 'claim_heartbeat')).toEqual([]);
  });

  it('names each field a call sends that a closed schema refuses, and only those', async () => {
    const storage = {
      getMemory: async (owner: string, key: string) => (owner === 'alice@n1' && key === 'apps.lc.html.tools'
        ? { value: { tools: [HEARTBEAT, { name: 'open', inputSchema: { type: 'object', properties: { a: {} } } }] } }
        : null),
    } as never;
    const issues = await skillToolFieldIssues(storage, { nodeId: 'n1' }, 'app:alice/lc.html', {
      'SKILL.md': 'claim_heartbeat { id, session, note } and open { a, b }',
      'notes.txt': 'claim_heartbeat { id, nope }',
    });
    expect(issues.map(i => `${i.tool}.${i.field}`)).toEqual(['claim_heartbeat.note']);
    expect(issues[0].accepted).toContain('sessionId');
    expect(await skillToolFieldIssues(storage, { nodeId: 'n1' }, undefined, { 'SKILL.md': 'claim_heartbeat { x }' })).toEqual([]);
  });
});

describe('one tool out of a manifest, and the owner\'s spellings', () => {
  it('picks the named tool, or lists the names there are', () => {
    const manifest = { tools: [HEARTBEAT, { name: 'board_read' }] };
    expect(pickManifestTool(manifest, 'board_read')).toEqual({ ok: true, tool: { name: 'board_read' } });
    expect(pickManifestTool(manifest, 'nope')).toEqual({ ok: false, names: ['claim_heartbeat', 'board_read'] });
    expect(pickManifestTool(null, 'x')).toEqual({ ok: false, names: [] });
  });

  it('user:alice, alice and alice@<this node> are one account', () => {
    expect(appOwnerName('user:alice')).toBe(appOwnerName('alice'));
    expect(appOwnerName(' user:alice ')).toBe('alice');
  });
});
