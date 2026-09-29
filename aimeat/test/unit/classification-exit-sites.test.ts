/**
 * @file test/unit/classification-exit-sites.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification check at the places that hand stored content to a caller or send
 *   it out of the node (TARGET-082 V4), on a real SQLite store with the switch on for everyone:
 *   a workflow run withholds an observed value its caller may not see; an offer prerequisite reads a
 *   hidden record as missing; an extension file read is refused by name for an AI; a publish to the
 *   caller's own connection asks leave() before any attempt opens and answers CLASSIFIED when a file
 *   stays behind; a tracked response leaves an organism's value out of the reply and says so in its
 *   ledger; a datapackage step publishes nothing from an organism's record.
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import type { ContentLabelTarget, MemoryRecord } from '../../src/storage/interface.js';
import { readerFor, readerForAgent, type ContentReader, type EgressDestination } from '../../src/services/classification/reader.js';
import { memoryTarget, fileTarget, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { getRun, listRuns, runKey, WITHHELD_CLASSIFIED } from '../../src/services/workflow/store.js';
import { buildOfferEvalCtx } from '../../src/services/offer-prereqs.js';
import { makeExtensionFiles } from '../../src/services/extension-files.js';
import { runOwnPublish } from '../../src/services/connections/publish-run.js';
import { createTrackedResponse, getTrackedResponse } from '../../src/services/tracked-response.js';
import { dispatchDataPackageStep } from '../../src/services/workflow/engine-steps.js';
import type { WorkflowRun } from '../../src/models/workflow-schemas.js';
import { logger } from '../../src/utils/logger.js';

const N = 'n';
const ALICE = `alice@${N}`;
const AGENT = `claude#alice@${N}`;
const config = {
  classificationMode: 'all', nodeId: N, baseUrl: 'http://localhost', storageMaxFileSizeMb: 10,
  aiProvenance: false, aiLabelPublic: 'off', federationTimeoutMs: 1000,
} as unknown as AimeatConfig;
const alice: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const aliceAuth = { sub: 'alice', owner: 'alice', roles: ['owner'] };

function mem(owner: string, key: string, value: unknown): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now };
}

/** A reader that records every call and keeps back whatever `leaveOut` names. */
function recordingReader(leaveOut: (t: ContentLabelTarget) => boolean = () => false) {
  const calls: Array<{ op: string; targets: Array<ContentLabelTarget | null>; where?: EgressDestination }> = [];
  const reader: ContentReader = {
    kind: 'system', identity: ALICE, principal: ALICE, auth: null, warnings: [],
    async show(items, targetOf) { calls.push({ op: 'show', targets: items.map(targetOf) }); return [...items]; },
    async useForAi(targets) { calls.push({ op: 'useForAi', targets: [...targets] }); },
    async leave(items, targetOf, where) {
      calls.push({ op: 'leave', targets: items.map(targetOf), where });
      const kept: typeof items[number][] = [];
      const left: Array<{ item: typeof items[number]; label: string; reason: string }> = [];
      for (const i of items) {
        const t = targetOf(i);
        if (t && leaveOut(t)) left.push({ item: i, label: 'sisainen', reason: 'classified Internal, which may not leave its organism' });
        else kept.push(i);
      }
      return { kept, left };
    },
  };
  return { reader, calls };
}

describe('the classification check at the exit sites', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => storage.close());
  const d = () => ({ storage, config });

  it('withholds a run observation from a caller who may not see its record, and keeps it for the owner', async () => {
    await setLabel(d(), alice, memoryTarget(ALICE, 'secret.doc'), { label: 'erittain-luottamuksellinen' });
    const run = {
      runId: 'r1', workflowId: 'w1', vars: {}, mode: 'full-live', status: 'done', startedAt: '2026-09-29T00:00:00Z',
      steps: {
        s1: {
          state: 'green',
          outputObserved: { all: [
            { op: 'json_field', key: 'secret.doc', path: 'status', value: 'the secret' },
            { op: 'json_field', key: 'plain.doc', path: 'status', value: 'fine' },
          ] },
        },
      },
    } as unknown as WorkflowRun;
    await storage.setMemory(mem(ALICE, runKey('w1', 'r1'), run));

    const leaves = (r: WorkflowRun | null) => ((r!.steps.s1!.outputObserved as { all: Array<Record<string, unknown>> }).all);
    const byAgent = leaves(await getRun(storage, ALICE, 'w1', 'r1', readerForAgent(d(), AGENT)));
    expect(byAgent[0]).toMatchObject({ key: 'secret.doc', value: null, withheld: WITHHELD_CLASSIFIED });
    expect(byAgent[1]).toMatchObject({ key: 'plain.doc', value: 'fine' });
    expect(leaves(await getRun(storage, ALICE, 'w1', 'r1', readerFor(d(), aliceAuth)))[0]!.value).toBe('the secret');
    // The engine's own read of its run state passes no reader and sees the run as stored.
    expect(leaves(await getRun(storage, ALICE, 'w1', 'r1'))[0]!.value).toBe('the secret');
    const [listed] = await listRuns(storage, ALICE, 'w1', { reader: readerForAgent(d(), AGENT) });
    expect(leaves(listed!)[0]!.withheld).toBe(WITHHELD_CLASSIFIED);
    // The stored record is untouched.
    expect(((await storage.getMemory(ALICE, runKey('w1', 'r1')))!.value as WorkflowRun).steps.s1!.outputObserved)
      .toMatchObject({ all: [{ value: 'the secret' }, { value: 'fine' }] });
  });

  it('reads a record an offer prerequisite may not show as missing, through the caller\'s reader', async () => {
    await storage.setMemory(mem(ALICE, 'gate.secret', { ready: true }));
    await storage.setMemory(mem(ALICE, 'gate.plain', { ready: true }));
    await setLabel(d(), alice, memoryTarget(ALICE, 'gate.secret'), { label: 'erittain-luottamuksellinen' });

    const asAgent = buildOfferEvalCtx(storage, config, 'alice', readerForAgent(d(), AGENT));
    expect(await asAgent.read('gate.secret')).toBeNull();
    expect(await asAgent.read('gate.plain')).toEqual({ key: 'gate.plain', value: { ready: true } });
    expect((await asAgent.listGlob('gate.*')).map(r => r.key)).toEqual(['gate.plain']);

    const { reader, calls } = recordingReader();
    const asRecorded = buildOfferEvalCtx(storage, config, 'alice', reader);
    expect(await asRecorded.read('gate.secret')).toEqual({ key: 'gate.secret', value: { ready: true } });
    expect(calls).toEqual([{ op: 'show', targets: [memoryTarget(ALICE, 'gate.secret')] }]);
  });

  it('refuses an extension file read by name when the calling AI may not see the file', async () => {
    const put = (key: string) => storage.createStorageFile({
      key, ownerGaii: AGENT, visibility: 'private', mimeType: 'text/plain', size: 2, data: Buffer.from('hi'), tags: [], createdAt: new Date().toISOString(),
    });
    await put('a/secret.txt');
    await put('a/plain.txt');
    await setLabel(d(), alice, fileTarget(AGENT, 'a/secret.txt'), { label: 'erittain-luottamuksellinen' });
    const files = makeExtensionFiles({ config, storage, callerGaii: AGENT, callerOwner: 'alice', callerRoles: ['agent'], extName: 'x' });
    await expect(files.read('a/secret.txt')).rejects.toMatchObject({ code: 'CLASSIFIED', status: 403 });
    expect((await files.read('a/plain.txt'))!.base64).toBe(Buffer.from('hi').toString('base64'));
  });

  it('asks leave() before a publish opens an attempt, and answers CLASSIFIED when the file stays', async () => {
    await storage.createStorageFile({
      key: 'video.mp4', ownerGaii: ALICE, visibility: 'private', mimeType: 'video/mp4', size: 1, data: Buffer.from('v'), tags: [], createdAt: new Date().toISOString(),
    });
    const opened = vi.spyOn(storage, 'openPublishAttempt');
    const { reader, calls } = recordingReader(() => true);
    const out = await runOwnPublish({ config, storage, providers: [], key: Buffer.alloc(32) },
      { publisher: ALICE, connectionId: 'c1', storageKey: 'video.mp4', caption: '', params: {}, reader });
    expect(out).toMatchObject({ ok: false, code: 'CLASSIFIED', classified: true });
    expect(calls).toEqual([{ op: 'leave', targets: [fileTarget(ALICE, 'video.mp4')], where: { kind: 'external', to: 'connection:c1' } }]);
    // Refused before the gate: no attempt was opened.
    expect(opened).not.toHaveBeenCalled();
  });

  it("leaves an organism's watched value out of a tracked reply, and records why in the ledger", async () => {
    const ctx = { config, storage, peers: new Map() };
    await storage.setMemory(mem(ALICE, 'organism.o1.task.done', { status: 'done', result: 'the organism secret' }));
    await storage.setMemory(mem(ALICE, 'own.task.done', { status: 'done', result: 'my own words' }));
    const make = (key: string) => createTrackedResponse(ctx, ALICE, {
      title: 't',
      source: { kind: 'message', messageId: 'm1', conversationId: 'c1', peerGhii: 'bob@other', ownerGhii: ALICE, originNodeId: 'other' },
      watch: { key, condition: { field: 'status', equals: 'done' } },
      response: { channel: 'message.reply', mode: 'approve', template: 'Done: {{result}}', inject: { field: 'result' } },
    });
    const draftOf = async (id: string) => (await storage.getMemory(ALICE, `tracked-response-draft.${id}.latest`))!.value as { body: string };

    const org = await make('organism.o1.task.done');
    expect((await draftOf(org.id)).body).toBe('Done: ');
    const stored = await getTrackedResponse(storage, ALICE, org.id);
    expect(stored!.ledger.find(e => e.event === 'result-withheld')).toMatchObject({ key: 'organism.o1.task.done', label: 'sisainen' });

    const own = await make('own.task.done');
    expect((await draftOf(own.id)).body).toBe('Done: my own words');
  });

  it("publishes no data package from an organism's record, and turns the step red", async () => {
    await storage.setMemory(mem(ALICE, 'organism.o1.rows', [{ a: 1 }]));
    const run = { runId: 'r1', workflowId: 'w1', vars: {}, keyPrefix: '', defSnapshot: { trigger: { kind: 'manual' } } } as unknown as WorkflowRun;
    const warned = vi.spyOn(logger, 'warn');
    const answered = new Promise<boolean>(resolve => {
      dispatchDataPackageStep({ storage, config }, ALICE, run, { id: 's1' } as never,
        { kind: 'datapackage', name: 'pkg', from_key: 'organism.o1.rows' } as never,
        (_owner, _wf, _run, _step, ok) => { resolve(ok); });
    });
    expect(await answered).toBe(false);
    // Red for the classification, not for anything else: the step's log names it.
    expect(warned.mock.calls.some(([, meta]) => String((meta as { error?: string })?.error).includes('CLASSIFIED: "organism.o1.rows"'))).toBe(true);
    warned.mockRestore();
  });
});
