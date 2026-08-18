/**
 * @file llm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Inference providers for the two SynthTraces models, behind a
 *   provider-neutral conversation model (Turn[]) so each provider owns its wire
 *   format. The agent model uses tool calling; the persona model produces plain
 *   user turns.
 *     - AnthropicProvider:    native Anthropic Messages API
 *     - OpenAICompatProvider: OpenAI-compatible chat/completions — works for
 *                             OpenRouter (free owl-alpha) and x.ai (Grok)
 *     - ScriptedProvider:     deterministic, key-free pipeline verification
 * @structure Turn/ToolUse/ToolResult (types), LlmProvider, the three providers
 * @usage import { OpenAICompatProvider } from './llm.js';
 * @version-history
 *   v0.2.0 -- 2026-06-05 -- Neutral Turn[] model + OpenAI-compatible provider (openrouter/xai)
 *   v0.1.0 -- 2026-06-05 -- Initial PoC (direct Anthropic + scripted)
 */

import type { ToolDef } from './tools.js';

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

/** Provider-neutral conversation turn. Providers translate to their wire format. */
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolUse[] }
  | { role: 'tool'; results: ToolResult[] };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentTurnResult {
  text: string;
  toolUses: ToolUse[];
  stopReason: string;
  usage: TokenUsage;
}

export interface LlmProvider {
  personaTurn(system: string, history: { role: 'user' | 'assistant'; text: string }[]): Promise<string>;
  agentTurn(system: string, history: Turn[], tools: ToolDef[]): Promise<AgentTurnResult>;
}

// ── Anthropic ───────────────────────────────────────────────────────────────

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function toAnthropic(history: Turn[]): { role: string; content: unknown }[] {
  return history.map((t) => {
    if (t.role === 'user') return { role: 'user', content: t.text };
    if (t.role === 'assistant') {
      const blocks: unknown[] = [];
      if (t.text) blocks.push({ type: 'text', text: t.text });
      for (const c of t.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      return { role: 'assistant', content: blocks };
    }
    return {
      role: 'user',
      content: t.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError })),
    };
  });
}

export class AnthropicProvider implements LlmProvider {
  constructor(private apiKey: string, private agentModel: string, private personaModel: string, private maxTokens: number) {}

  private async call(body: Record<string, unknown>): Promise<{
    content: AnthropicBlock[];
    stop_reason: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  }> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as { content: AnthropicBlock[]; stop_reason: string; usage?: { input_tokens?: number; output_tokens?: number } };
  }

  async personaTurn(system: string, history: { role: 'user' | 'assistant'; text: string }[]): Promise<string> {
    const data = await this.call({
      model: this.personaModel,
      max_tokens: 512,
      system,
      messages: history.map((h) => ({ role: h.role, content: h.text })),
    });
    return data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  }

  async agentTurn(system: string, history: Turn[], tools: ToolDef[]): Promise<AgentTurnResult> {
    const data = await this.call({ model: this.agentModel, max_tokens: this.maxTokens, system, tools, messages: toAnthropic(history) });
    const toolUses = data.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id as string, name: b.name as string, input: (b.input ?? {}) as Record<string, unknown> }));
    const text = data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
    return {
      text,
      toolUses,
      stopReason: data.stop_reason,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    };
  }
}

// ── OpenAI-compatible (OpenRouter / x.ai) ───────────────────────────────────

interface OpenAIMsg {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function toOpenAI(system: string, history: Turn[]): OpenAIMsg[] {
  const out: OpenAIMsg[] = [{ role: 'system', content: system }];
  for (const t of history) {
    if (t.role === 'user') {
      out.push({ role: 'user', content: t.text });
    } else if (t.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: t.text || null,
        tool_calls: t.toolCalls.length
          ? t.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } }))
          : undefined,
      });
    } else {
      for (const r of t.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
  }
  return out;
}

export class OpenAICompatProvider implements LlmProvider {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private agentModel: string,
    private personaModel: string,
    private maxTokens: number,
  ) {}

  private async call(body: Record<string, unknown>): Promise<{
    choices: { message: OpenAIMsg; finish_reason: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  }> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        'X-Title': 'AIMEAT SynthTraces',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      choices?: { message: OpenAIMsg; finish_reason: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok || !json.choices) {
      throw new Error(`LLM ${res.status}: ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
    }
    return json as {
      choices: { message: OpenAIMsg; finish_reason: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
  }

  async personaTurn(system: string, history: { role: 'user' | 'assistant'; text: string }[]): Promise<string> {
    const data = await this.call({
      model: this.personaModel,
      max_tokens: 512,
      messages: [{ role: 'system', content: system }, ...history.map((h) => ({ role: h.role, content: h.text }))],
    });
    return (data.choices[0]?.message.content ?? '').trim();
  }

  async agentTurn(system: string, history: Turn[], tools: ToolDef[]): Promise<AgentTurnResult> {
    const data = await this.call({
      model: this.agentModel,
      max_tokens: this.maxTokens,
      messages: toOpenAI(system, history),
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      tool_choice: 'auto',
    });
    const choice = data.choices[0];
    const msg = choice?.message;
    const toolUses: ToolUse[] = (msg?.tool_calls ?? []).map((tc) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        input = { _raw_arguments: tc.function.arguments };
      }
      return { id: tc.id, name: tc.function.name, input };
    });
    return {
      text: (msg?.content ?? '').trim(),
      toolUses,
      stopReason: choice?.finish_reason ?? 'stop',
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
    };
  }
}

// ── Scripted (deterministic, no key) ────────────────────────────────────────

export class ScriptedProvider implements LlmProvider {
  /** When true, prepend a clarifying owner question — exercises the message round-trip. */
  constructor(private ask = false) {}

  async personaTurn(): Promise<string> {
    return 'Store it as private memory, thanks.';
  }

  async agentTurn(_system: string, history: Turn[], _tools: ToolDef[]): Promise<AgentTurnResult> {
    const prior = history.filter((t) => t.role === 'assistant' && t.toolCalls.length > 0).length;
    const steps = this.ask ? ['ask', 'write', 'event', 'complete'] : ['write', 'event', 'complete'];
    const step = steps[Math.min(prior, steps.length - 1)];

    let use: ToolUse;
    let text: string;
    switch (step) {
      case 'ask':
        text = 'I need one clarification before storing anything.';
        use = { id: 'call_ask', name: 'aimeat_reply_to_owner', input: { content: 'Should I store this as private or public memory?' } };
        break;
      case 'write':
        text = 'I will store the requested information in memory.';
        use = {
          id: 'call_write',
          name: 'aimeat_memory_write',
          input: { key: 'synthtraces.scripted', value: { saved: true, note: 'scripted self-play entry' }, visibility: 'private' },
        };
        break;
      case 'event':
        text = 'Logging progress on the task timeline.';
        use = { id: 'call_event', name: 'aimeat_task_event', input: { type: 'memory_write', message: 'Saved the requested entry to memory.' } };
        break;
      default:
        text = 'The request is satisfied; marking the task done.';
        use = { id: 'call_complete', name: 'aimeat_complete_task', input: { message: 'Stored the requested information and verified the write.' } };
    }
    return { text, toolUses: [use], stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
