/**
 * @file selfplay.ts
 * @description One self-play session = one trace. The owner-persona queues a
 *   task; the agent model works it through AIMEAT tools (memory + task events +
 *   owner replies) over the active transport (REST or MCP); if the agent asks
 *   the owner a question, the persona model answers via a real inbound message.
 *   Everything flows through native AIMEAT owner<->agent messaging + the task
 *   lifecycle, so the task's own event timeline + telemetry become the backbone
 *   of the trace. Conversation state is a provider-neutral Turn[]; the agent's
 *   actions go through an AgentDriver so transport is pluggable.
 * @structure runSession()
 * @usage import { runSession } from './selfplay.js';
 * @version-history
 *   v0.3.0 -- 2026-06-05 -- Agent actions via AgentDriver (REST/MCP transport)
 *   v0.2.0 -- 2026-06-05 -- Neutral Turn[] history (provider-agnostic)
 *   v0.1.0 -- 2026-06-05 -- Initial PoC (task-driven, REST transport)
 */

import { randomUUID } from 'node:crypto';
import type { HarnessConfig } from './config.js';
import type { AimeatClient, Creds } from './client.js';
import type { LlmProvider, Turn, ToolResult } from './llm.js';
import type { Persona } from './personas.js';
import { makeDriver, type AgentDriver } from './driver.js';
import { AGENT_TOOLS, dispatchTool, type ToolContext } from './tools.js';
import { newTrace, type SessionTrace } from './trace.js';

const AGENT_SYSTEM =
  'You are an AIMEAT AI agent connected to a node, acting on behalf of your owner. ' +
  'Use the provided AIMEAT tools to actually do the work — persist anything the owner ' +
  'asks you to remember with aimeat_memory_write, narrate progress with aimeat_task_event, ' +
  'and ask for clarification with aimeat_reply_to_owner only if the request is ambiguous. ' +
  'When the owner request is fully satisfied, call aimeat_complete_task. Be concise and act; ' +
  'do not stall.';

export async function runSession(
  cfg: HarnessConfig,
  client: AimeatClient,
  providers: { agent: LlmProvider; persona: LlmProvider },
  persona: Persona,
  creds: Creds,
): Promise<SessionTrace> {
  const sessionId = randomUUID();
  const threadId = randomUUID();
  const trace = newTrace({
    session_id: sessionId,
    persona_id: persona.id,
    persona_role: persona.role,
    transport: cfg.transport,
    provider: cfg.provider,
    agent_model: cfg.inference.agentModel,
    persona_model: cfg.personaInference.personaModel,
    node_id: cfg.nodeId,
    owner: creds.owner,
    agent_gaii: creds.agentGaii,
  });
  let turnSeq = 0;
  let toolSeq = 0;
  let driver: AgentDriver | undefined;

  try {
    // 1. Owner queues the task derived from the persona intent.
    const created = await client.createTask(creds.ownerToken, creds.agentName, { title: persona.taskTitle, description: persona.intent });
    if (!created.ok || !created.taskId) {
      trace.outcome = 'error';
      trace.error = `createTask failed: ${created.message}`;
      trace.ended_at = new Date().toISOString();
      return trace;
    }
    const taskId = created.taskId;
    trace.task.id = taskId;
    trace.task.title = persona.taskTitle;
    trace.task.description = persona.intent;
    trace.turns.push({ seq: turnSeq++, role: 'persona', kind: 'task_create', content: persona.intent });

    // 2. Owner starts the task (owner-only: propose-before-start rule). Recorded
    //    so a failure can never hide behind a later "completed" outcome.
    const started = await client.startTask(creds.ownerToken, creds.agentName, taskId);
    trace.tool_calls.push({
      seq: toolSeq++,
      name: 'task_start(owner)',
      input: { taskId },
      ok: started.ok,
      status: started.status,
      via: 'rest',
      result: started.ok ? 'task active' : `error: ${started.message}`,
    });

    // 3. Agent actions go through the active transport (REST or MCP).
    driver = await makeDriver(cfg.transport, client, cfg.baseUrl, creds);
    const toolCtx: ToolContext = { driver, taskId, threadId };

    const history: Turn[] = [
      {
        role: 'user',
        text:
          `Owner "${creds.owner}" queued this task for you.\n\n` +
          `Title: ${persona.taskTitle}\nRequest: ${persona.intent}\n\n` +
          'Complete it using your AIMEAT tools.',
      },
    ];
    const personaHistory: { role: 'user' | 'assistant'; text: string }[] = [];

    let outcome: SessionTrace['outcome'] = 'max_turns';
    for (let turn = 0; turn < cfg.maxTurns; turn++) {
      const t0 = Date.now();
      const res = await providers.agent.agentTurn(AGENT_SYSTEM, history, AGENT_TOOLS);
      const dt = (Date.now() - t0) / 1000;
      trace.usage.aiCalls += 1;
      trace.usage.tokensIn += res.usage.inputTokens;
      trace.usage.tokensOut += res.usage.outputTokens;
      trace.usage.durationSeconds += dt;
      history.push({ role: 'assistant', text: res.text, toolCalls: res.toolUses });
      if (res.text) trace.turns.push({ seq: turnSeq++, role: 'agent', kind: 'agent_text', content: res.text });

      // Feed this turn's token cost into the native task telemetry while the task
      // is still active — the node accumulates details.telemetry into task.telemetry.
      if (res.usage.inputTokens + res.usage.outputTokens > 0) {
        const te = await client.taskEvent(creds.agentToken, creds.agentName, taskId, {
          type: 'progress',
          message: `telemetry: turn ${turn + 1}`,
          details: {
            telemetry: {
              ai_calls: 1,
              tokens_in: res.usage.inputTokens,
              tokens_out: res.usage.outputTokens,
              duration_seconds: Math.round(dt * 100) / 100,
            },
          },
        });
        trace.tool_calls.push({
          seq: toolSeq++,
          name: 'task_telemetry(harness)',
          input: { turn: turn + 1, tokens_in: res.usage.inputTokens, tokens_out: res.usage.outputTokens },
          ok: te.ok,
          status: te.status,
          via: 'rest',
          result: te.ok ? 'telemetry recorded' : `error: ${te.message}`,
        });
      }

      if (res.toolUses.length === 0) {
        outcome = 'max_turns';
        break;
      }

      const results: ToolResult[] = [];
      let terminal: 'completed' | 'failed' | undefined;
      let replied = false;
      for (const use of res.toolUses) {
        trace.turns.push({ seq: turnSeq++, role: 'agent', kind: 'tool_use', content: `${use.name}(${JSON.stringify(use.input)})` });
        const out = await dispatchTool(toolCtx, use.name, use.input);
        trace.tool_calls.push({ seq: toolSeq++, name: use.name, input: use.input, ok: out.ok, status: out.status, via: out.via ?? toolCtx.driver.label, result: out.result });
        if (use.name === 'aimeat_reply_to_owner') {
          trace.turns.push({ seq: turnSeq++, role: 'agent', kind: 'message_outbound', content: String(use.input.content ?? '') });
          personaHistory.push({ role: 'user', text: String(use.input.content ?? '') });
        }
        results.push({ id: use.id, name: use.name, content: out.result, isError: !out.ok });
        if (out.terminal && out.ok) terminal = out.terminal;
        if (out.replied) replied = true;
      }
      history.push({ role: 'tool', results });

      if (terminal) {
        outcome = terminal;
        break;
      }

      // If the agent asked the owner something, the persona answers via a real inbound message.
      if (replied) {
        const reply = await providers.persona.personaTurn(persona.systemPrompt, personaHistory);
        personaHistory.push({ role: 'assistant', text: reply });
        const sent = await client.sendMessage(creds.ownerToken, creds.agentName, {
          direction: 'inbound',
          content: reply,
          thread_id: threadId,
          linked_task_id: taskId,
        });
        trace.turns.push({ seq: turnSeq++, role: 'persona', kind: 'message_inbound', content: reply });
        if (sent.ok) await driver.getInbox(); // native delivery path, over the active transport
        history.push({ role: 'user', text: `Owner replied: ${reply}` });
      }
    }

    // 4. Pull the native task state (REST instrumentation) — the trace backbone.
    const finalTask = await client.getTask(creds.agentToken, creds.agentName, taskId);
    const evs = await client.getTaskEvents(creds.agentToken, creds.agentName, taskId);
    trace.task.final_status = (finalTask.task?.status as string) ?? null;
    trace.task.telemetry = finalTask.task?.telemetry ?? null;
    trace.events = evs.events;
    trace.outcome = outcome;
  } catch (e) {
    trace.outcome = 'error';
    trace.error = (e as Error).message;
  } finally {
    if (driver) {
      try {
        await driver.close();
      } catch {
        /* transport already closed */
      }
    }
  }

  trace.ended_at = new Date().toISOString();
  return trace;
}
