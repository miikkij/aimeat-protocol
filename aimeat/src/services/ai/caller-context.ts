/**
 * @file src/services/ai/caller-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is asking for an AI call, in the words the planner reads (ai-completion.ts
 *   PrepareAiCallOptions): the caller class, the agent by bare name, the app its grant names. One
 *   function makes it from a verified credential, so a route, an AI job, a schedule and a workflow
 *   all answer the same way for the same principal.
 *
 *   Until 2026-10-05 the caller was optional and a call that left it out was planned as the owner in
 *   person: the owner's per-app and per-agent model lists, their switches for apps and agents, an
 *   agent's daily cap and the binding of an app's AI role did not apply. AI jobs, the workflow ai
 *   step, scheduled ai jobs and the refinery left it out (secaudit 2026-10, AI-3). The planner now
 *   requires it, and the entry points that run later than the request (a job, a schedule, a workflow
 *   run) keep the credential's facts with what they run and pass them here.
 * @structure AiCallerContext · OWNER_CALLER · aiCallerFromCredential(cred, principal) ·
 *   aiCallerOfPrincipal(principal)
 * @usage
 *   const who = aiCallerFromCredential(req.auth!, resolveIdentity(req.auth!, config.nodeId));
 *   await completeForOwner(storage, config, payer, { ...who, prompt });
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, AI-3).
 */
import type { CallerClass } from './policy.js';
import { aiPayerOf } from '../agent-ai-keys.js';
import { CHAT_AGENT_NAME } from '../chat-agent.js';

/** Who asks, as the AI planner reads it. */
export interface AiCallerContext {
  caller: CallerClass;
  /** The owner's agent that asks, by bare name. */
  agent?: string;
  /** The app an app grant names (`owner/file.html`), never a body field. */
  verifiedApp?: string;
}

/** A call the node makes for the owner with nobody else asking: a classifier, a pulse, a test the owner pressed. */
export const OWNER_CALLER: AiCallerContext = Object.freeze({ caller: 'owner' as const });

/**
 * The caller a verified credential is. An app grant is the app it names; an agent's identity is that
 * agent (the node chat's own agent is 'chat'); anything else is the owner. `principal` is the
 * identity the credential resolved to (resolveIdentity, or the agent's GAII on the MCP surface).
 */
export function aiCallerFromCredential(
  cred: { roles: readonly string[]; app?: string | null },
  principal: string,
): AiCallerContext {
  if (cred.roles.includes('app') && cred.app) return { caller: 'app', verifiedApp: cred.app };
  const { agent } = aiPayerOf(principal);
  // The node chat's own agent is the chat, as routes/ai-policy.ts aiCallerOf has it: the chat's
  // policy switch applies, not an agent's.
  if (agent === CHAT_AGENT_NAME) return { caller: 'chat' };
  if (agent) return { caller: 'agent', agent };
  return { caller: 'owner' };
}

/**
 * The caller an identity is, when the surface knows the principal and not an app grant behind it:
 * an MCP tool, whose session is an agent's or the owner's own. An agent's GAII is that agent, the
 * owner's GHII is the owner.
 */
export function aiCallerOfPrincipal(principal: string): AiCallerContext {
  return aiCallerFromCredential({ roles: [] }, principal);
}
