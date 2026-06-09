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
 *   v0.2.0 — 2026-06-09 — Recover tool calls that small models (qwen2.5:7b) leak into the assistant
 *     content as `<tool_call>{…}</tool_call>` / bare JSON instead of the structured tool_calls field,
 *     so the loop still executes them (only for known tool names).
 *   v0.3.0 — 2026-06-09 — Stream the completion (stream:true) and assemble the deltas, so big/slow local
 *     models no longer trip Node's 300s headers timeout ("fetch failed") while thinking.
 *   v0.4.0 — 2026-06-09 — Persist the transcript (load/save per host+owner+model). Put the agent's own
 *     identity (GAII/owner) in the system prompt so it stops inventing target agents/owners; stop a turn
 *     after 3 consecutive tool failures instead of looping.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const cfg = {
  base: (process.env.AIMEAT_BASE || '').replace(/\/+$/, ''),
  mcpPath: process.env.AIMEAT_MCP_PATH || '/v2/mcp/appdev',
  token: process.env.AIMEAT_AGENT_TOKEN || '',
  ollamaUrl: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, ''),
  model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
  owner: process.env.AIMEAT_OWNER || '',
  gaii: process.env.AIMEAT_AGENT_GAII || '',
  sessionFile: process.env.AIMEAT_SESSION_FILE || '',
};

// Persisted transcript (one file per host+owner+model). We store ONLY the conversation; the model
// re-reads live data via MCP every turn, so a resumed session can never serve stale answers.
function loadSession() {
  const base = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (!cfg.sessionFile || !existsSync(cfg.sessionFile)) return base;
  try {
    const data = JSON.parse(readFileSync(cfg.sessionFile, 'utf8'));
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    if (!msgs.length) return base;
    return msgs[0]?.role === 'system' ? msgs : [...base, ...msgs.filter((m) => m.role !== 'system')];
  } catch { return base; }
}
function saveSession(messages) {
  if (!cfg.sessionFile) return;
  try {
    writeFileSync(cfg.sessionFile, JSON.stringify({
      base_url: cfg.base, owner: cfg.owner, model: cfg.model,
      updated_at: new Date().toISOString(), messages,
    }));
  } catch { /* persistence is best-effort */ }
}

const AGENT_NAME = cfg.gaii ? cfg.gaii.split('#')[0] : '';
const SYSTEM_PROMPT =
  'You are the AIMEAT assistant running inside the user\'s desktop app, connected to their AIMEAT node ' +
  'as their own registered agent. ' +
  (cfg.gaii
    ? `YOUR identity: GAII "${cfg.gaii}" — agent name "${AGENT_NAME}", owner "${cfg.owner}". When a tool asks ` +
      'for an "owner", a "target agent", or who is performing an action and it means YOU, use exactly this ' +
      'identity — NEVER invent agent names, owners, ids, or spaces. '
    : '') +
  'Use the provided tools to read and manage your owner\'s organisms, workspaces, knowledge, and agents. ' +
  'Always READ (list/get/members/read) to learn the exact ids, names, and space names BEFORE you WRITE ' +
  '(create/update/add/publish/delete), and pass values exactly as the tools return them. ' +
  'If a tool returns an error, read it carefully and correct your next call; if it keeps failing, STOP and ' +
  'explain the error plainly instead of guessing or inventing values. Be concise.';

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

// ── Leaked tool-call recovery ───────────────────────────────────────
// Small local models (e.g. qwen2.5:7b on Ollama) often emit a tool call as TEXT in the
// assistant content — `<tool_call>{"name":...,"arguments":...}</tool_call>` (Hermes format)
// or a bare {"name","arguments"} JSON — instead of the structured `tool_calls` field, and
// Ollama doesn't always parse it. Without recovery the loop sees no tool call and just prints
// the raw markup. We detect and execute those so the chat keeps working.
let leakSeq = 0;
function tryParseCall(s) {
  if (!s) return null;
  let t = String(s).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const o = JSON.parse(t.slice(start, end + 1));
    const name = o?.name ?? o?.tool ?? o?.function;
    const args = o?.arguments ?? o?.parameters ?? o?.args ?? {};
    if (typeof name !== 'string') return null;
    return { id: `leaked_${++leakSeq}`, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } };
  } catch { return null; }
}
function extractLeakedToolCalls(content) {
  if (!content || typeof content !== 'string') return { calls: [], cleaned: content || '' };
  const calls = [];
  const tagRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let m;
  while ((m = tagRe.exec(content)) !== null) { const c = tryParseCall(m[1]); if (c) calls.push(c); }
  let cleaned = content.replace(tagRe, '').replace(/<\/?tool_call>/gi, '').trim();
  if (calls.length === 0) { const c = tryParseCall(content); if (c) { calls.push(c); cleaned = ''; } }
  return { calls, cleaned };
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

// We STREAM the completion (stream:true). Beyond responsiveness, this is essential for big/slow
// local models: in non-stream mode Ollama only sends response headers once generation is fully done,
// so a model that takes minutes trips Node's 300s headers timeout → "fetch failed". Streaming sends
// headers immediately, so the request never times out while the model thinks. We assemble the OpenAI
// delta chunks (content + tool_calls) back into a single message with the same shape as before.
async function ollamaChat(messages, tools) {
  const resp = await fetch(cfg.ollamaUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, messages, tools, stream: true }),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`Ollama ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const msg = { role: 'assistant', content: '' };
  const toolAcc = [];
  let buf = '', finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { finished = true; break; }
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const choice = json.choices?.[0];
      const delta = choice?.delta || choice?.message || {};
      if (typeof delta.content === 'string') msg.content += delta.content;
      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? 0;
        toolAcc[i] = toolAcc[i] || { id: tc.id || `call_${i}`, type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolAcc[i].id = tc.id;
        if (tc.function?.name) toolAcc[i].function.name += tc.function.name;
        if (tc.function?.arguments) toolAcc[i].function.arguments += tc.function.arguments;
      }
    }
  }
  const calls = toolAcc.filter(Boolean);
  if (calls.length) msg.tool_calls = calls;
  return msg;
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
  let consecutiveErrors = 0, lastError = '';
  for (let step = 0; step < 8; step++) {
    const msg = await ollamaChat(messages, ctx.openaiTools);

    let calls = msg.tool_calls || [];
    // Recover tool calls the model leaked into content as text, but only for KNOWN tools
    // (so we never mis-fire on ordinary JSON the model happens to mention).
    if (calls.length === 0 && msg.content) {
      const { calls: leaked, cleaned } = extractLeakedToolCalls(msg.content);
      const known = leaked.filter((c) => ctx.toolByName.has(c.function.name));
      if (known.length) {
        calls = known;
        msg.content = cleaned;        // drop the raw <tool_call> markup
        msg.tool_calls = known;       // keep the conversation well-formed for the next turn
      }
    }
    messages.push(msg);

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
          consecutiveErrors++; lastError = resultText;
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
      if (/^(ERROR|DENIED)/.test(resultText)) { consecutiveErrors++; lastError = resultText; }
      else consecutiveErrors = 0;
    }
    if (consecutiveErrors >= 3) {
      return `I stopped after ${consecutiveErrors} tool calls failed in a row, to avoid looping. The last error was:\n\n${lastError}`;
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
  let messages = loadSession();
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
    if (cmd.type === 'clear') {
      messages = [{ role: 'system', content: SYSTEM_PROMPT }];
      saveSession(messages);
      emit({ type: 'cleared' });
      return;
    }
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
        saveSession(messages);
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
