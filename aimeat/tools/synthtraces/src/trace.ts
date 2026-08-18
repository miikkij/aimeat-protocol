/**
 * @file trace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Trace schema + JSONL writer for SynthTraces. One session => one
 *   trace line. The trace leans on AIMEAT's native task container: the task's
 *   immutable event timeline + telemetry are fetched at the end and embedded,
 *   alongside the raw model tool-call decisions the harness records as it runs.
 * @structure
 *   - SessionTrace, TurnEntry, ToolCallEntry (types)
 *   - newTrace(), writeTrace()
 * @usage import { newTrace, writeTrace } from './trace.js';
 * @version-history
 *   v0.1.0 -- 2026-06-05 -- Initial PoC (task-driven container)
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Outcome = 'completed' | 'failed' | 'max_turns' | 'error';

export interface ToolCallEntry {
  /** Sequence index within the session. */
  seq: number;
  /** Tool name the agent model chose (e.g. aimeat_memory_write). */
  name: string;
  /** Arguments the model supplied. */
  input: unknown;
  /** Did the underlying AIMEAT call succeed? */
  ok: boolean;
  /** HTTP status of the underlying AIMEAT call (0 for harness-local tools). */
  status: number;
  /** Which channel handled this call: rest | mcp (meaningful in hybrid runs). */
  via?: string;
  /** Short string the model sees as the tool result. */
  result: string;
}

export interface TurnEntry {
  seq: number;
  role: 'persona' | 'agent';
  kind: 'task_create' | 'message_inbound' | 'message_outbound' | 'agent_text' | 'tool_use';
  content: string;
}

export interface SessionTrace {
  session_id: string;
  persona_id: string;
  persona_role: string;
  transport: string;
  provider: string;
  agent_model: string;
  persona_model: string;
  node_id: string;
  owner: string;
  agent_gaii: string;
  task: {
    id: string;
    title: string;
    description: string;
    final_status: string | null;
    telemetry: unknown;
  };
  turns: TurnEntry[];
  tool_calls: ToolCallEntry[];
  events: unknown[];
  /** Harness-side accumulated agent-model token/duration cost for this session. */
  usage: { aiCalls: number; tokensIn: number; tokensOut: number; durationSeconds: number };
  outcome: Outcome;
  error?: string;
  started_at: string;
  ended_at: string;
}

export function newTrace(init: Partial<SessionTrace> & { session_id: string }): SessionTrace {
  return {
    persona_id: '',
    persona_role: '',
    transport: 'rest',
    provider: '',
    agent_model: '',
    persona_model: '',
    node_id: '',
    owner: '',
    agent_gaii: '',
    task: { id: '', title: '', description: '', final_status: null, telemetry: null },
    turns: [],
    tool_calls: [],
    events: [],
    usage: { aiCalls: 0, tokensIn: 0, tokensOut: 0, durationSeconds: 0 },
    outcome: 'error',
    started_at: new Date().toISOString(),
    ended_at: '',
    ...init,
  };
}

export function writeTrace(outDir: string, runLabel: string, trace: SessionTrace): string {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `traces-${runLabel}.jsonl`);
  appendFileSync(file, JSON.stringify(trace) + '\n', 'utf8');
  return file;
}
