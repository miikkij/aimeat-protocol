/**
 * @file driver.ts
 * @description Transport abstraction for the agent's in-session AIMEAT actions.
 *   The self-play loop and tool dispatcher are transport-agnostic; only the
 *   driver knows whether an action goes out as a REST call or an MCP tool call.
 *   This is the axis that lets the dataset span pure-REST and pure-MCP agents
 *   (hybrid = a thin driver that mixes the two).
 *     - RestAgentDriver: agent-token REST calls via AimeatClient
 *     - McpAgentDriver:  agent-token MCP tools/call against the node's /v1/mcp
 * @structure AgentDriver (interface), DriverResult, RestAgentDriver, McpAgentDriver
 * @usage const driver = await makeDriver(transport, client, baseUrl, creds);
 * @version-history
 *   v0.1.0 -- 2026-06-05 -- Initial REST + MCP drivers (task 2)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AimeatClient, Creds } from './client.js';
import type { TransportKind } from './config.js';

export interface DriverResult {
  ok: boolean;
  status: number;
  message?: string;
  value?: unknown;
  keys?: unknown[];
  messages?: unknown[];
  /** Which channel actually handled the call (set by the hybrid driver). */
  via?: string;
}

export interface AgentDriver {
  readonly label: string;
  memoryWrite(m: { key: string; value: unknown; visibility?: string }): Promise<DriverResult>;
  memoryRead(key: string): Promise<DriverResult>;
  memoryList(prefix?: string): Promise<DriverResult>;
  taskEvent(taskId: string, e: { type: string; message: string }): Promise<DriverResult>;
  sendMessage(m: { content: string; threadId: string; taskId: string }): Promise<DriverResult>;
  completeTask(taskId: string, message: string): Promise<DriverResult>;
  failTask(taskId: string, reason: string): Promise<DriverResult>;
  getInbox(): Promise<DriverResult>;
  close(): Promise<void>;
}

// ── REST ────────────────────────────────────────────────────────────────────

export class RestAgentDriver implements AgentDriver {
  readonly label = 'rest';
  constructor(private client: AimeatClient, private token: string, private agentName: string) {}

  memoryWrite(m: { key: string; value: unknown; visibility?: string }): Promise<DriverResult> {
    return this.client.memoryWrite(this.token, m);
  }
  memoryRead(key: string): Promise<DriverResult> {
    return this.client.memoryRead(this.token, key);
  }
  memoryList(prefix?: string): Promise<DriverResult> {
    return this.client.memoryList(this.token, prefix);
  }
  taskEvent(taskId: string, e: { type: string; message: string }): Promise<DriverResult> {
    return this.client.taskEvent(this.token, this.agentName, taskId, e);
  }
  sendMessage(m: { content: string; threadId: string; taskId: string }): Promise<DriverResult> {
    return this.client.sendMessage(this.token, this.agentName, {
      direction: 'outbound',
      content: m.content,
      thread_id: m.threadId,
      linked_task_id: m.taskId,
    });
  }
  completeTask(taskId: string, message: string): Promise<DriverResult> {
    return this.client.completeTask(this.token, this.agentName, taskId, message);
  }
  failTask(taskId: string, reason: string): Promise<DriverResult> {
    return this.client.failTask(this.token, this.agentName, taskId, reason);
  }
  getInbox(): Promise<DriverResult> {
    return this.client.getInbox(this.token, this.agentName);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

// ── MCP ──────────────────────────────────────────────────────────────────────

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class McpAgentDriver implements AgentDriver {
  readonly label = 'mcp';
  private constructor(private mcp: Client) {}

  static async connect(baseUrl: string, token: string): Promise<McpAgentDriver> {
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl + '/v1/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const mcp = new Client({ name: 'synthtraces', version: '0.2.0' });
    await mcp.connect(transport);
    return new McpAgentDriver(mcp);
  }

  private async call(name: string, args: Record<string, unknown>): Promise<DriverResult & { text: string }> {
    try {
      const r = (await this.mcp.callTool({ name, arguments: args })) as {
        content?: { type: string; text?: string }[];
        isError?: boolean;
      };
      const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
      const ok = r.isError !== true;
      return { ok, status: ok ? 200 : 0, text, message: ok ? undefined : text.slice(0, 200) };
    } catch (e) {
      return { ok: false, status: 0, text: '', message: (e as Error).message };
    }
  }

  async memoryWrite(m: { key: string; value: unknown; visibility?: string }): Promise<DriverResult> {
    return this.call('aimeat_memory_write', { key: m.key, value: m.value, visibility: m.visibility ?? 'private' });
  }
  async memoryRead(key: string): Promise<DriverResult> {
    const r = await this.call('aimeat_memory_read', { key });
    return { ...r, value: tryJson(r.text) };
  }
  async memoryList(prefix?: string): Promise<DriverResult> {
    const r = await this.call('aimeat_memory_list', prefix ? { prefix } : {});
    return { ...r, keys: [] };
  }
  taskEvent(taskId: string, e: { type: string; message: string }): Promise<DriverResult> {
    return this.call('aimeat_task_event', { task_id: taskId, type: e.type, message: e.message });
  }
  sendMessage(m: { content: string; threadId: string; taskId: string }): Promise<DriverResult> {
    return this.call('aimeat_message_send', { content: m.content, thread_id: m.threadId, linked_task_id: m.taskId });
  }
  completeTask(taskId: string, message: string): Promise<DriverResult> {
    return this.call('aimeat_task_complete', { task_id: taskId, message });
  }
  failTask(taskId: string, reason: string): Promise<DriverResult> {
    return this.call('aimeat_task_fail', { task_id: taskId, reason });
  }
  async getInbox(): Promise<DriverResult> {
    const r = await this.call('aimeat_message_inbox', {});
    return { ...r, messages: [] };
  }
  close(): Promise<void> {
    return this.mcp.close();
  }
}

// ── Hybrid (REST + MCP mixed per operation) ─────────────────────────────────

/**
 * Models a real-world agent that uses MCP where it is convenient and REST
 * elsewhere. The split is fixed and observable: memory + messaging go over MCP,
 * task lifecycle (event/complete/fail) goes over REST. Each result is tagged
 * with `via` so the trace shows exactly which channel handled each call.
 */
export class HybridAgentDriver implements AgentDriver {
  readonly label = 'hybrid';
  private constructor(private rest: RestAgentDriver, private mcp: McpAgentDriver) {}

  static async connect(client: AimeatClient, baseUrl: string, creds: Creds): Promise<HybridAgentDriver> {
    const rest = new RestAgentDriver(client, creds.agentToken, creds.agentName);
    const mcp = await McpAgentDriver.connect(baseUrl, creds.agentToken);
    return new HybridAgentDriver(rest, mcp);
  }

  private tag(via: string, p: Promise<DriverResult>): Promise<DriverResult> {
    return p.then((r) => ({ ...r, via }));
  }

  memoryWrite(m: { key: string; value: unknown; visibility?: string }): Promise<DriverResult> {
    return this.tag('mcp', this.mcp.memoryWrite(m));
  }
  memoryRead(key: string): Promise<DriverResult> {
    return this.tag('mcp', this.mcp.memoryRead(key));
  }
  memoryList(prefix?: string): Promise<DriverResult> {
    return this.tag('mcp', this.mcp.memoryList(prefix));
  }
  taskEvent(taskId: string, e: { type: string; message: string }): Promise<DriverResult> {
    return this.tag('rest', this.rest.taskEvent(taskId, e));
  }
  sendMessage(m: { content: string; threadId: string; taskId: string }): Promise<DriverResult> {
    return this.tag('mcp', this.mcp.sendMessage(m));
  }
  completeTask(taskId: string, message: string): Promise<DriverResult> {
    return this.tag('rest', this.rest.completeTask(taskId, message));
  }
  failTask(taskId: string, reason: string): Promise<DriverResult> {
    return this.tag('rest', this.rest.failTask(taskId, reason));
  }
  getInbox(): Promise<DriverResult> {
    return this.tag('mcp', this.mcp.getInbox());
  }
  close(): Promise<void> {
    return this.mcp.close();
  }
}

export async function makeDriver(
  transport: TransportKind,
  client: AimeatClient,
  baseUrl: string,
  creds: Creds,
): Promise<AgentDriver> {
  if (transport === 'mcp') return McpAgentDriver.connect(baseUrl, creds.agentToken);
  if (transport === 'hybrid') return HybridAgentDriver.connect(client, baseUrl, creds);
  return new RestAgentDriver(client, creds.agentToken, creds.agentName);
}
