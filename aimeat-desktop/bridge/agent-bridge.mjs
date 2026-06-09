/**
 * @file agent-bridge.mjs
 * @description The "liaison" bridge for the AIMEAT Desktop Ollama Chat. Connects to an
 *   AIMEAT node's MCP surface AS A REGISTERED AGENT (Bearer agent-token), exposes its
 *   tools to a local Ollama model, and runs the tool-calling loop:
 *     user → Ollama (with MCP tools) → tool_calls → MCP tools/call → results → answer.
 *
 *   Two modes:
 *     --once "<prompt>"  : run a single turn and print events (for testing).
 *     (default) stdio    : long-lived. Reads JSON command lines on stdin
 *                          ({type:"user"|"approval"|"cancel"}), writes JSON event lines
 *                          on stdout ({type:"ready"|"tool_call"|"approval_request"|
 *                          "tool_result"|"assistant"|"done"|"error"}).
 *
 *   Config via env: AIMEAT_BASE, AIMEAT_MCP_PATH (default /v2/mcp/appdev),
 *   AIMEAT_AGENT_TOKEN, OLLAMA_URL (default http://localhost:11434), OLLAMA_MODEL.
 *
 *   Must run from a dir where `@modelcontextprotocol/sdk` resolves (staged into
 *   resources/server/ next to node_modules).
 * @version-history
 *   v0.1.0 — 2026-06-07 — Initial bridge: MCP-as-agent + Ollama tool loop + write approvals.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createInterface } from 'node:readline';

const cfg = {
  base: (process.env.AIMEAT_BASE || '').replace(/\/+$/, ''),
  mcpPath: process.env.AIMEAT_MCP_PATH || '/v2/mcp/appdev',
  token: process.env.AIMEAT_AGENT_TOKEN || '',
  ollamaUrl: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, ''),
  model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
};

const SYSTEM_PROMPT =
  'You are the AIMEAT assistant running inside the user\'s desktop app, connected to their AIMEAT node ' +
  'as their own registered agent. Use the provided tools to read and manage the user\'s organisms, ' +
  'workspaces, knowledge packages, and agents. Always READ (list/get/members/read) to gather context before ' +
  'you WRITE (create/update/add/publish/delete). Be concise. If a tool returns an error, explain it plainly.';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// MCP tool result → plain text.
function textOf(result) {
  const parts = (result?.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text);
  const text = parts.join('\n').trim();
  return result?.isError ? `ERROR: ${text || 'tool failed'}` : (text || '(no output)');
}

// Heuristic + annotation: does this tool mutate state?
function isWrite(name, tool) {
  if (tool?.annotations?.readOnlyHint === true) return false;
  if (tool?.annotations?.readOnlyHint === false) return true;
  return /_(create|update|delete|write|publish|add|set|approve|import|join|leave|remove|send|invoke|contribute|draft|vouch|report|mint)\b/.test(name);
}

function mcpToolsToOpenAI(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

async function ollamaChat(messages, tools) {
  const resp = await fetch(cfg.ollamaUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, messages, tools, stream: false }),
  });
  if (!resp.ok) {
    throw new Error(`Ollama ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message ?? { role: 'assistant', content: '' };
}

// ── Approval coordination (stdio mode) ──────────────────────────────
let approvalSeq = 0;
const pendingApprovals = new Map(); // id -> resolve(boolean)
function requestApproval(name, args) {
  const id = `appr_${++approvalSeq}`;
  emit({ type: 'approval_request', id, name, args });
  return new Promise((resolve) => pendingApprovals.set(id, resolve));
}

/**
 * Run one user turn: loop Ollama ↔ MCP tools until a final text answer.
 * autoApprove: skip the approval gate (used by --once tests and the UI's auto mode).
 */
async function runTurn(ctx, messages, { autoApprove }) {
  for (let step = 0; step < 8; step++) {
    const msg = await ollamaChat(messages, ctx.openaiTools);
    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (calls.length === 0) {
      return msg.content || '';
    }

    for (const call of calls) {
      const name = call.function?.name;
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* keep {} */ }
      const tool = ctx.toolByName.get(name);
      const write = isWrite(name, tool);
      emit({ type: 'tool_call', name, args, write });

      let resultText;
      if (write && !autoApprove) {
        const approved = await requestApproval(name, args);
        if (!approved) {
          resultText = 'DENIED: the user declined this action.';
          emit({ type: 'tool_result', name, result: resultText });
          messages.push({ role: 'tool', tool_call_id: call.id, content: resultText });
          continue;
        }
      }
      if (!tool) {
        resultText = `ERROR: unknown tool ${name}`;
      } else {
        try {
          const r = await ctx.client.callTool({ name, arguments: args });
          resultText = textOf(r);
        } catch (e) {
          resultText = `ERROR: ${e.message}`;
        }
      }
      emit({ type: 'tool_result', name, result: resultText.slice(0, 2000) });
      messages.push({ role: 'tool', tool_call_id: call.id, content: resultText });
    }
  }
  return '(stopped: too many tool steps without a final answer)';
}

async function connect() {
  if (!cfg.base) throw new Error('AIMEAT_BASE is required');
  if (!cfg.token) throw new Error('AIMEAT_AGENT_TOKEN is required');
  const url = new URL(cfg.base + cfg.mcpPath);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } },
  });
  const client = new Client({ name: 'aimeat-desktop-ollama', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return {
    client,
    toolByName: new Map(tools.map((t) => [t.name, t])),
    openaiTools: mcpToolsToOpenAI(tools),
    toolCount: tools.length,
  };
}

async function main() {
  const ctx = await connect();
  emit({ type: 'ready', tool_count: ctx.toolCount, model: cfg.model, surface: cfg.mcpPath, tools: [...ctx.toolByName.keys()] });

  const onceIdx = process.argv.indexOf('--once');
  if (onceIdx >= 0) {
    const prompt = process.argv[onceIdx + 1] || 'List my organisms.';
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];
    const answer = await runTurn(ctx, messages, { autoApprove: true });
    emit({ type: 'assistant', text: answer });
    emit({ type: 'done' });
    await ctx.client.close();
    process.exit(0);
  }

  // stdio mode: persistent conversation; commands arrive as JSON lines on stdin.
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  let autoApprove = false;
  let busy = false;
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let cmd;
    try { cmd = JSON.parse(line); } catch { return; }
    if (cmd.type === 'approval') {
      const resolve = pendingApprovals.get(cmd.id);
      if (resolve) { pendingApprovals.delete(cmd.id); resolve(!!cmd.approved); }
      return;
    }
    if (cmd.type === 'set_auto_approve') { autoApprove = !!cmd.value; return; }
    if (cmd.type === 'user') {
      if (busy) { emit({ type: 'error', message: 'Still working on the previous message.' }); return; }
      busy = true;
      messages.push({ role: 'user', content: String(cmd.text || '') });
      try {
        const answer = await runTurn(ctx, messages, { autoApprove });
        emit({ type: 'assistant', text: answer });
      } catch (e) {
        emit({ type: 'error', message: e.message });
      } finally {
        emit({ type: 'done' });
        busy = false;
      }
    }
  });
}

main().catch((e) => {
  emit({ type: 'error', message: e.message, fatal: true });
  process.exit(1);
});
