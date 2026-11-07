/**
 * @file src/services/chat/agent-health.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the chat agent really starts on this node, found by starting it, before the
 *   chat page says the chat can answer (Jouni, 2026-11-07: "sen piti jo ilmoittaa se aiemmin eikä
 *   antaa edes käyttää jos ei pysty käyttää").
 *
 *   WHY. GET /v1/chat/status decided "ready" from the settings alone: a chat agent path is set and a
 *   key may pay. A path that names a program which is not goose passed, the page let the person type,
 *   and the first turn ended in "goose exited (code 1, signal null)". A setting says what the
 *   operator meant; only a start says what the node can do.
 *
 *   THE PROBE is the start a turn makes: the agent process, and the ACP handshake (goose-acp.ts
 *   GooseAcpClient.start), then it is closed. No model is called and no person's token is minted.
 *   A good answer is kept for half an hour, a failure for one minute, so an operator's fix shows on
 *   the next look; a changed path is probed afresh. Concurrent looks share one probe.
 *
 *   WHAT A TURN SAYS. A turn whose agent does not start marks the agent down here, so the page shows
 *   the chat as out of use at its next look rather than letting the next person type into it; a start
 *   that succeeds marks it up. A process that ends mid-turn marks nothing: the next turn starts a
 *   fresh one, and only that start says whether the agent works.
 * @structure ChatAgentHealth · chatAgentHealth · noteChatAgentDown · noteChatAgentUp
 * @usage
 *   const h = await chatAgentHealth(config);
 *   if (!h.ok) showOutOfUse(h.error);
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (Jouni, 2026-11-07).
 */
import type { AimeatConfig } from '../../config.js';
import { GooseAcpClient } from '../goose-acp.js';
import { logger } from '../../utils/logger.js';

export type ChatAgentHealth = { ok: true } | { ok: false; error: string };

const OK_FOR_MS = 30 * 60_000;
const FAILED_FOR_MS = 60_000;

interface Reading { bin: string; health: ChatAgentHealth; at: number }

// Each node process starts its own chat agents, so what one process found about its own start is
// its own; a second process probes for itself on its first look.
// process-local: a second process does not see this reading and probes its own agent once
let reading: Reading | null = null;
// process-local: one probe at a time in this process, shared by the looks that arrive meanwhile.
let probing: { bin: string; done: Promise<ChatAgentHealth> } | null = null;

const binOf = (config: AimeatConfig): string => (config.gooseBin || '').trim();

/** Start the agent once and close it: what a turn's start would meet. */
async function probe(config: AimeatConfig): Promise<ChatAgentHealth> {
  try {
    const client = await GooseAcpClient.start(config);
    client.close();
    return { ok: true };
  } catch (err) {
    const error = (err as Error).message || String(err);
    logger.warn(`[chat] the chat agent did not start on its probe: ${error}`);
    return { ok: false, error };
  }
}

/** Whether the chat agent starts on this node. Only asked where a chat agent path is set. */
export async function chatAgentHealth(config: AimeatConfig): Promise<ChatAgentHealth> {
  const bin = binOf(config);
  if (!bin) return { ok: false, error: 'No chat agent is configured on this node. An operator sets AIMEAT_GOOSE_BIN.' };
  const fresh = reading && reading.bin === bin
    && Date.now() - reading.at < (reading.health.ok ? OK_FOR_MS : FAILED_FOR_MS);
  if (fresh && reading) return reading.health;
  if (probing && probing.bin === bin) return probing.done;
  const done = probe(config).then((health) => {
    reading = { bin, health, at: Date.now() };
    return health;
  }).finally(() => { if (probing?.done === done) probing = null; });
  probing = { bin, done };
  return done;
}

/** A turn's agent did not start, or its process ended mid-turn: the chat is out of use until it starts. */
export function noteChatAgentDown(config: AimeatConfig, error: string): void {
  reading = { bin: binOf(config), health: { ok: false, error }, at: Date.now() };
}

/** A turn's agent started: the chat answers. */
export function noteChatAgentUp(config: AimeatConfig): void {
  reading = { bin: binOf(config), health: { ok: true }, at: Date.now() };
}
