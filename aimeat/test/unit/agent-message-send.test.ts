/**
 * @file test/unit/agent-message-send.test.ts
 * @description The one write path behind an agent-dashboard message, tested where both doors now
 *   meet it (August 2026 MCP audit, step 8). POST /v1/agents/:name/messages and the MCP tool
 *   aimeat_message_send each used to build the record themselves, and the two copies disagreed on
 *   four things: `processedAt` at creation, the owner scope of the live-update event, which MCP
 *   resource URI was notified, and whether the option-prompt metadata survived the mapping.
 *
 *   Those four are what this file pins. They are cheap to re-break — each one is a single line in a
 *   record literal — and none of them shows up in a green E2E run, because the E2E suite drives the
 *   REST door and the tool's copy was the one that drifted.
 * @usage pnpm exec vitest run test/unit/agent-message-send.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-11 — Written with services/agent-message-send.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { sendAgentMessage } from '../../src/services/agent-message-send.js';
import { onChangeEvent, offChangeEvent, type ChangeEvent } from '../../src/services/event-bus.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, AgentMessageRecord, AiProvenanceRecordRow } from '../../src/storage/interface.js';

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const AGENT = `claude#alice@${NODE}`;

const config = {
  nodeId: NODE,
  baseUrl: 'https://example.test',
  aiProvenance: true,
  aiLabelPublic: 'light',
} as unknown as AimeatConfig;

/** The smallest storage this path touches: the message row, and the provenance row a Mint-3 writes. */
function fakeStorage(): Storage & { messages: AgentMessageRecord[]; provenance: AiProvenanceRecordRow[] } {
  const messages: AgentMessageRecord[] = [];
  const provenance: AiProvenanceRecordRow[] = [];
  return {
    messages,
    provenance,
    createMessage: async (record: AgentMessageRecord) => { messages.push(record); return record; },
    createAiProvenance: async (row: AiProvenanceRecordRow) => { provenance.push(row); },
    getAiProvenance: async (id: string) => provenance.find(r => r.id === id),
  } as unknown as Storage & { messages: AgentMessageRecord[]; provenance: AiProvenanceRecordRow[] };
}

/** Collect the live-update events this send fires, so the owner scope can be asserted. */
function captureChanges(): { events: ChangeEvent[]; stop: () => void } {
  const events: ChangeEvent[] = [];
  const handler = (evt: ChangeEvent): void => { events.push(evt); };
  onChangeEvent(handler);
  return { events, stop: () => offChangeEvent(handler) };
}

let stopCapture: (() => void) | undefined;
afterEach(() => { stopCapture?.(); stopCapture = undefined; });

describe('sendAgentMessage — what the two doors used to disagree about', () => {
  it('leaves processedAt unset at creation, whichever door wrote it', async () => {
    const storage = fakeStorage();
    const result = await sendAgentMessage({ storage, config }, {
      agentGaii: AGENT, senderGaii: AGENT, pipeline: 'mcp.message_send',
      body: { content: 'the agent answers', direction: 'outbound' },
    });
    expect(result.ok).toBe(true);
    // processedAt is what the status PATCH stamps when a message finishes processing. A message that
    // carries it from birth says a transition happened that never did.
    expect(storage.messages[0].processedAt).toBeUndefined();
    expect(storage.messages[0].status).toBe('delivered');
  });

  it('scopes the live-update event to the owner instead of broadcasting it', async () => {
    const storage = fakeStorage();
    const capture = captureChanges();
    stopCapture = capture.stop;
    await sendAgentMessage({ storage, config }, {
      agentGaii: AGENT, senderGaii: AGENT, pipeline: 'mcp.message_send',
      body: { content: 'hello', direction: 'outbound' },
    });
    const fired = capture.events.filter(e => e.domain === 'agent-messages');
    expect(fired).toHaveLength(1);
    // Unscoped, this woke every connected owner on the node for one agent's message.
    expect(fired[0].ownerGaii).toBe(AGENT);
  });

  it('notifies the agent about an INBOUND message, at the uri the resource layer uses', async () => {
    const storage = fakeStorage();
    const notified: { gaii: string; uri: string }[] = [];
    const webhooks: string[] = [];
    await sendAgentMessage(
      {
        storage, config,
        emitResourceUpdated: (gaii, uri) => { notified.push({ gaii, uri }); },
        webhooks: { dispatchWebhookEvent: async (_gaii: string, event: string) => { webhooks.push(event); } },
      } as Parameters<typeof sendAgentMessage>[0],
      {
        agentGaii: AGENT, senderGaii: OWNER, pipeline: 'rest.agent_message_send',
        body: { content: 'the owner asks', direction: 'inbound' },
      },
    );
    expect(notified).toEqual([{ gaii: AGENT, uri: `aimeat://agents/claude/messages` }]);
    expect(webhooks).toEqual(['message.inbound']);
  });

  it('sends no push for an agent writing its own outbound message', async () => {
    const storage = fakeStorage();
    const notified: string[] = [];
    const webhooks: string[] = [];
    await sendAgentMessage(
      {
        storage, config,
        emitResourceUpdated: (_gaii, uri) => { notified.push(uri); },
        webhooks: { dispatchWebhookEvent: async (_gaii: string, event: string) => { webhooks.push(event); } },
      } as Parameters<typeof sendAgentMessage>[0],
      {
        agentGaii: AGENT, senderGaii: AGENT, pipeline: 'mcp.message_send',
        body: { content: 'done', direction: 'outbound' },
      },
    );
    expect(notified).toEqual([]);
    expect(webhooks).toEqual([]);
  });

  it('carries the option-prompt metadata the MCP copy used to drop', async () => {
    const storage = fakeStorage();
    await sendAgentMessage({ storage, config }, {
      agentGaii: AGENT, senderGaii: AGENT, pipeline: 'mcp.message_send',
      body: {
        content: 'which one?', direction: 'outbound',
        metadata: {
          tokens_used: 12,
          prompt: { prompt_id: 'p1', question: 'Colour or shape?', options: ['colour', 'shape'] },
        },
      },
    });
    const meta = storage.messages[0].metadata;
    expect(meta?.tokensUsed).toBe(12);
    expect(meta?.prompt).toEqual({
      promptId: 'p1', question: 'Colour or shape?', options: ['colour', 'shape'], allowOther: true,
    });
  });

  it('stamps an agent write and leaves an owner write unstamped', async () => {
    const storage = fakeStorage();
    await sendAgentMessage({ storage, config }, {
      agentGaii: AGENT, senderGaii: AGENT, pipeline: 'mcp.message_send',
      body: { content: 'model-written prose', direction: 'outbound' },
    });
    await sendAgentMessage({ storage, config }, {
      agentGaii: AGENT, senderGaii: OWNER, pipeline: 'rest.agent_message_send',
      body: { content: 'a person typed this', direction: 'inbound' },
    });
    expect(storage.messages[0].aiProvenanceId).toBeDefined();
    // A person writing through their own token is presumed human; stamping them would be a false
    // statement about authorship.
    expect(storage.messages[1].aiProvenanceId).toBeUndefined();
    expect(storage.provenance).toHaveLength(1);
  });

  it('refuses an invalid body with the message both doors publish, and writes nothing', async () => {
    const storage = fakeStorage();
    const result = await sendAgentMessage({ storage, config }, {
      agentGaii: AGENT, senderGaii: AGENT, pipeline: 'mcp.message_send',
      body: { content: '', direction: 'sideways' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.code).toBe('INVALID_INPUT');
    expect(result.message).toContain('content');
    expect(result.message).toContain('direction');
    expect(storage.messages).toHaveLength(0);
  });
});
