/**
 * @file test/unit/classification-ai-warnings.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description TARGET-082 review, item 2, on a real SQLite store with classification on for
 *   everyone and the model calls stubbed: an AI call whose inputs carry a warning label answers
 *   `classification_warnings` (warningsNote, classification/reader.ts). Covered: POST /v1/ai/complete
 *   (files), POST /v1/ai/transcribe, the node MCP tool aimeat_ai_transcribe, an AI job (the prompt's
 *   record at the start, the audio when it runs), a decision run, and the message attachment
 *   transcription. A plain input answers without the field, and a file no model may read answers
 *   403 CLASSIFIED on /v1/ai/complete rather than 502 PROVIDER_ERROR.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-ai-warnings.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-30 — TARGET-082 review, item 2. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { memoryTarget, fileTarget, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { resetClassificationAudit } from '../../src/services/classification/audit.js';
import { aiRouter } from '../../src/routes/ai.js';
import { messagesRouter } from '../../src/routes/messages.js';
import { registerAiCapabilityTools } from '../../src/mcp/ai-capabilities.js';
import { AiJobService } from '../../src/services/ai-jobs/service.js';
import { startDecideRun, getDecideRun } from '../../src/services/decide/runs.js';

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0.001, costExact: true };
const budget = { dailyBudgetUsd: 1, spentTodayUsd: 0, remainingUsd: 1 };
vi.mock('../../src/services/ai-completion.js', async (orig) => ({
  ...(await orig<object>()),
  completeForOwner: vi.fn(async () => ({ content: 'answer', model: 'm', finishReason: 'stop', truncated: false, route: {}, usage, budget })),
}));
vi.mock('../../src/services/ai-transcription.js', async (orig) => ({
  ...(await orig<object>()),
  transcribeForOwner: vi.fn(async () => ({ text: 'heard', model: 'm', language: 'fi', seconds: 3, route: {}, usage, budget })),
}));
vi.mock('../../src/services/decide/service.js', async (orig) => ({
  ...(await orig<object>()),
  decideForOwner: vi.fn(async () => ({ decision_id: 'd1', cached: false, answers: { q: { value: 1 } }, usage: { cost_usd: 0 } })),
}));

const N = 'n';
const ALICE = `alice@${N}`;
const AGENT = `claude#alice@${N}`;
const WARN = 'luottamuksellinen';
const HIDDEN = 'erittain-luottamuksellinen';
const stamp = '2026-09-30T12:00:00.000Z';
const alice: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const ownerAuth = { sub: 'alice', owner: 'alice', roles: ['owner'] };

function mem(key: string, value: unknown): MemoryRecord {
  return { key, ownerGaii: ALICE, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp };
}

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = await read();
    if (done(v)) return v;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('timed out');
}

describe('TARGET-082 review, item 2: an AI call names the warning-classified content it was given', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  const deps = () => ({ storage, config });
  const file = async (key: string, mime: string, label?: string) => {
    await storage.createStorageFile({ key, ownerGaii: ALICE, visibility: 'private', mimeType: mime, size: 4, data: Buffer.from('abcd'), tags: [], createdAt: stamp });
    if (label) await setLabel(deps(), alice, fileTarget(ALICE, key), { label });
  };
  const expectWarned = (w: unknown, key: string) => expect(w).toEqual([expect.objectContaining({ key, label: WARN, says: expect.any(String) })]);

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: N, classificationMode: 'all', decideEnabled: true };
    resetClassificationAudit();
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: stamp });
    await storage.createGHII({ username: 'alice', nodeId: N, ghii: ALICE, displayName: 'alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    await storage.createAgent({ name: 'claude', owner: 'alice', gaii: AGENT, capabilities: [], publicKey: 'pk', trustScore: 50, morselBalance: 0, createdAt: stamp, lastSeen: stamp } as never);
    await file('docs/warned.pdf', 'application/pdf', WARN);
    await file('docs/plain.pdf', 'application/pdf');
    await file('docs/hidden.pdf', 'application/pdf', HIDDEN);
    await file('audio/warned.webm', 'audio/webm', WARN);
    await storage.setMemory(mem('notes.warned', 'Summarise the contract terms.'));
    await setLabel(deps(), alice, memoryTarget(ALICE, 'notes.warned'), { label: WARN });
    await storage.setMemory(mem('notes.plain', 'A plain note.'));
  });
  afterEach(() => { storage.close(); resetClassificationAudit(); });

  describe('REST', () => {
    let server: http.Server;
    let base: string;
    beforeEach(async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.auth = ownerAuth as never; next(); });
      app.use(aiRouter(config, storage));
      app.use(messagesRouter(config, storage, new Map()));
      server = http.createServer(app);
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(async () => { await new Promise<void>(r => server.close(() => r())); });
    const post = async (path: string, body: unknown) => {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() as { data?: Record<string, unknown>; error?: { code: string } } };
    };

    it('POST /v1/ai/complete names a warning-classified file, and says nothing for a plain one', async () => {
      const warned = await post('/v1/ai/complete', { prompt: 'read', files: [{ storage_key: 'docs/warned.pdf' }] });
      expect(warned.status).toBe(200);
      expectWarned(warned.body.data?.classification_warnings, 'docs/warned.pdf');
      const plain = await post('/v1/ai/complete', { prompt: 'read', files: [{ storage_key: 'docs/plain.pdf' }] });
      expect(plain.status).toBe(200);
      expect(plain.body.data).not.toHaveProperty('classification_warnings');
    });

    it('POST /v1/ai/complete answers 403 CLASSIFIED for a file no model may read', async () => {
      const r = await post('/v1/ai/complete', { prompt: 'read', files: [{ storage_key: 'docs/hidden.pdf' }] });
      expect(r.status).toBe(403);
      expect(r.body.error?.code).toBe('CLASSIFIED');
    });

    it('POST /v1/ai/transcribe names warning-classified audio', async () => {
      const r = await post('/v1/ai/transcribe', { storage_key: 'audio/warned.webm' });
      expect(r.status).toBe(200);
      expectWarned(r.body.data?.classification_warnings, 'audio/warned.webm');
    });

    it('POST /v1/messages/:id/attachments/:attId/transcribe names warning-classified audio', async () => {
      await storage.createDirectMessage({
        id: 'msg-1', ownerGhii: ALICE, conversationId: 'c', senderGhii: ALICE, recipientGhii: `bob@${N}`, body: '',
        direction: 'outbound', status: 'sent', origin: 'local', originNodeId: N, createdAt: stamp,
        attachments: [{ id: 'a1', inline: false, storageKey: 'audio/warned.webm', ownerGhii: ALICE, originNodeId: N, mode: 'reference', mime: 'audio/webm', size: 4, kind: 'audio' }],
      } as never);
      const r = await post('/v1/messages/msg-1/attachments/a1/transcribe', {});
      expect(r.status).toBe(200);
      expectWarned(r.body.data?.classification_warnings, 'audio/warned.webm');
    });
  });

  it('node MCP aimeat_ai_transcribe names warning-classified audio', async () => {
    const tools = new Map<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>>();
    const fakeMcp = { tool: (name: string, ...rest: unknown[]) => { tools.set(name, rest[rest.length - 1] as never); } };
    registerAiCapabilityTools(fakeMcp as never, storage, config, () => AGENT);
    // The tool reads the agent's own storage, so the audio is the agent's.
    await storage.createStorageFile({ key: 'audio/agent.webm', ownerGaii: AGENT, visibility: 'private', mimeType: 'audio/webm', size: 4, data: Buffer.from('abcd'), tags: [], createdAt: stamp });
    await setLabel(deps(), alice, fileTarget(AGENT, 'audio/agent.webm'), { label: WARN });
    const warned = JSON.parse((await tools.get('aimeat_ai_transcribe')!({ storage_key: 'audio/agent.webm' })).content[0]!.text);
    expect(warned.text).toBe('heard');
    expectWarned(warned.classification_warnings, 'audio/agent.webm');
  });

  it('an AI job keeps the warning-classified prompt record on the job and says it at the start', async () => {
    const service = new AiJobService(config, storage);
    const startedBy = { principal: ALICE, owner: 'alice', roles: ['owner'], scopes: [] };
    const started = await service.startJob({ prompt_key: 'notes.warned', result_key: 'out.one' }, { ownerGhii: ALICE, createdBy: ALICE, startedBy });
    expectWarned(started.classification_warnings, 'notes.warned');
    const done = await until(() => service.getJob(ALICE, started.job_id), j => j?.state === 'done');
    expectWarned(done?.classification_warnings, 'notes.warned');
    const plain = await service.startJob({ prompt_key: 'notes.plain', result_key: 'out.two' }, { ownerGhii: ALICE, createdBy: ALICE, startedBy });
    expect(plain).not.toHaveProperty('classification_warnings');
  });

  it('an AI job that transcribes keeps the warning-classified audio on the job once it ran', async () => {
    const service = new AiJobService(config, storage);
    const startedBy = { principal: ALICE, owner: 'alice', roles: ['owner'], scopes: [] };
    const started = await service.startJob({ op: 'transcribe', audio_key: 'audio/warned.webm', result_key: 'out.heard' }, { ownerGhii: ALICE, createdBy: ALICE, startedBy });
    // The audio is read when the job runs, so the start has nothing to say yet.
    expect(started).not.toHaveProperty('classification_warnings');
    const done = await until(() => service.getJob(ALICE, started.job_id), j => j?.state === 'done');
    expectWarned(done?.classification_warnings, 'audio/warned.webm');
  });

  it('a decision run keeps the warning-classified records it sent on the run', async () => {
    const caller = { gaii: ALICE, principal: ALICE, isOwner: true };
    const run = await startDecideRun(storage, config, caller, { questions: { q: { type: 'probability', text: 'Is it done?' } } as never, keys: ['notes.warned', 'notes.plain'] });
    const done = await until(() => getDecideRun(storage, ALICE, run.id), r => r?.state === 'done');
    expect(done?.counts.done).toBe(2);
    expectWarned(done?.classification_warnings, 'notes.warned');
  });
});
