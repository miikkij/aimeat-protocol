/**
 * @file telemetry-buffer.test.ts
 * @description Unit tests for the in-memory telemetry/heartbeat accumulator. Verifies that
 *   high-frequency signals are batched (no per-event storage writes), that a flush collapses
 *   many events into one recordActivity-per-metric + one updateAgent-per-agent, that the raw
 *   ring serves the list/count reads, and that eviction clears per-agent state.
 * @version-history
 *   v1.0.0 -- 2026-06-21 -- Initial coverage for the batched flush + ring buffer.
 */
import { describe, it, expect } from 'vitest';
import type { Storage, AgentRecord, AgentActivityRecord } from '../../src/storage/interface.js';
import {
  initTelemetryBuffer,
  pushTelemetry,
  recordTelemetryActivity,
  markAgentSeen,
  listTelemetryBuffered,
  bufferedTelemetryCount,
  evictAgentTelemetry,
  flushTelemetryBuffer,
} from '../../src/services/telemetry-buffer.js';

interface Calls {
  recordActivity: AgentActivityRecord[];
  updateAgent: Array<{ gaii: string; patch: Partial<AgentRecord> }>;
  getAgent: number;
}

function makeStorage(agent: Partial<AgentRecord> = {}): { storage: Storage; calls: Calls } {
  const calls: Calls = { recordActivity: [], updateAgent: [], getAgent: 0 };
  const base: AgentRecord = {
    name: 'bot', owner: 'o', gaii: 'bot#o@n', capabilities: [], publicKey: 'x',
    trustScore: 50, morselBalance: 0, createdAt: '2026-01-01T00:00:00.000Z',
    ...agent,
  } as AgentRecord;
  const storage = {
    async recordActivity(r: AgentActivityRecord) { calls.recordActivity.push(r); },
    async getAgent(_g: string) { calls.getAgent++; return base; },
    async updateAgent(gaii: string, patch: Partial<AgentRecord>) { calls.updateAgent.push({ gaii, patch }); return base; },
  } as unknown as Storage;
  return { storage, calls };
}

function evt(gaii: string, type: 'llm_call' | 'tool_call' | 'agent_report', data: Record<string, unknown> = {}) {
  return { id: Math.random().toString(36).slice(2), agentGaii: gaii, type, data, createdAt: new Date().toISOString() };
}

describe('telemetry-buffer', () => {
  it('buffers raw events without any storage write until flush', async () => {
    const { storage, calls } = makeStorage();
    initTelemetryBuffer(storage);
    const gaii = `a#o@n-${Date.now()}-raw`;

    for (let i = 0; i < 20; i++) {
      pushTelemetry(evt(gaii, 'agent_report'));
      recordTelemetryActivity(gaii, { type: 'agent_report', data: {} });
    }
    // Nothing written yet — purely in-memory.
    expect(calls.recordActivity.length).toBe(0);
    expect(calls.updateAgent.length).toBe(0);
    expect(bufferedTelemetryCount(gaii)).toBe(20);

    await flushTelemetryBuffer();
    // 20 agent_report events collapse to a single telemetry_events upsert (+value 20).
    const tel = calls.recordActivity.filter(r => r.metric === 'telemetry_events' && r.agentGaii === gaii);
    expect(tel.length).toBe(1);
    expect(tel[0].value).toBe(20);
    // agent_report carries no token data → no activityStats merge → no updateAgent.
    expect(calls.updateAgent.filter(u => u.gaii === gaii).length).toBe(0);
  });

  it('accumulates llm_call tokens into one activityStats updateAgent', async () => {
    const { storage, calls } = makeStorage({ activityStats: {
      tasksCompleted: 0, tasksFailed: 0, tokensUsed30d: 100, aiCalls30d: 1,
      successRate: 0, extensionsCreated: 0, appsPublished: 0,
    } });
    initTelemetryBuffer(storage);
    const gaii = `a#o@n-${Date.now()}-llm`;

    recordTelemetryActivity(gaii, { type: 'llm_call', data: { tokens_in: 30, tokens_out: 20 } });
    recordTelemetryActivity(gaii, { type: 'llm_call', data: { tokens_used: 50 } });

    await flushTelemetryBuffer();

    // One getAgent + one updateAgent for the whole window, not per event.
    expect(calls.updateAgent.filter(u => u.gaii === gaii).length).toBe(1);
    const patch = calls.updateAgent.find(u => u.gaii === gaii)!.patch;
    // 100 existing + 50 + 50 = 200 tokens, 1 existing + 2 calls = 3.
    expect(patch.activityStats!.tokensUsed30d).toBe(200);
    expect(patch.activityStats!.aiCalls30d).toBe(3);
    const tokens = calls.recordActivity.filter(r => r.metric === 'tokens_used' && r.agentGaii === gaii);
    expect(tokens.reduce((s, r) => s + r.value, 0)).toBe(100);
  });

  it('flushes a heartbeat as a single lastSeen updateAgent with no getAgent', async () => {
    const { storage, calls } = makeStorage();
    initTelemetryBuffer(storage);
    const gaii = `a#o@n-${Date.now()}-hb`;

    markAgentSeen(gaii, '2026-06-21T10:00:00.000Z');
    markAgentSeen(gaii, '2026-06-21T10:00:30.000Z'); // newest wins
    const before = calls.getAgent;

    await flushTelemetryBuffer();

    const ups = calls.updateAgent.filter(u => u.gaii === gaii);
    expect(ups.length).toBe(1);
    expect(ups[0].patch.lastSeen).toBe('2026-06-21T10:00:30.000Z');
    // lastSeen-only patches must not read the agent record.
    expect(calls.getAgent).toBe(before);
  });

  it('list honours since/type filters and newest-first order; count + evict work', async () => {
    const { storage } = makeStorage();
    initTelemetryBuffer(storage);
    const gaii = `a#o@n-${Date.now()}-list`;

    const e1 = { ...evt(gaii, 'llm_call'), createdAt: '2026-06-21T10:00:00.000Z' };
    const e2 = { ...evt(gaii, 'tool_call'), createdAt: '2026-06-21T10:00:05.000Z' };
    pushTelemetry(e1);
    pushTelemetry(e2);

    const all = listTelemetryBuffered(gaii, {});
    expect(all.map(e => e.id)).toEqual([e2.id, e1.id]); // newest first

    expect(listTelemetryBuffered(gaii, { type: 'llm_call' }).map(e => e.id)).toEqual([e1.id]);
    expect(listTelemetryBuffered(gaii, { since: '2026-06-21T10:00:02.000Z' }).map(e => e.id)).toEqual([e2.id]);
    expect(bufferedTelemetryCount(gaii)).toBe(2);

    evictAgentTelemetry(gaii);
    expect(bufferedTelemetryCount(gaii)).toBe(0);
  });
});
