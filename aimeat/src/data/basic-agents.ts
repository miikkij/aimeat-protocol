/**
 * @file src/data/basic-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The basic agents, defined ONCE. The "create my basic agents" button creates whatever
 *   this file says, and nothing anywhere else decides what that set is.
 *
 *   WHY ONE PLACE. Three agents is a set that grows: the moment the list also lives in a prompt, in
 *   the connector, or in a test fixture, the four copies start disagreeing about scopes, and the
 *   copy an owner actually gets is whichever one the button happens to read. The button reads this.
 *   The API exposes it (GET /v1/agents/v2/basic-agents), so a runtime that wants to know what it is
 *   about to be handed asks the node instead of carrying its own list.
 *
 *   WHAT THIS FILE DOES NOT DECIDE. How these agents BEHAVE, and what crew definitions they run.
 *   That is the runtime's half (crewaimeat), agreed through the wish bucket. The node creates them,
 *   credentials them, records how they are meant to be run, and gets them served.
 *
 *   SCOPES ARE NAMED, NEVER WILDCARDED. Every scope below is a deliberate line, and the enrolment
 *   path takes the scopes from HERE and never from the request — an agent asking for more in its
 *   card gets what the template says. `crew-forge` is the one to read twice: it creates agents for
 *   its owner, so it carries agent:write and agent:delete, and deliberately not agent:permissions
 *   (rewriting a sibling's permission set stays with the person) and not the wildcard.
 *
 * @structure BASIC_AGENTS · BasicAgentTemplate · basicAgentByName
 * @usage import { BASIC_AGENTS } from '../data/basic-agents.js';
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial: concierge, crew-forge, workflow-manager (Agent v2, V1).
 */
import type { RunMode } from '../models/agent-card.js';

export interface BasicAgentTemplate {
  /** The bare agent name, and the second half of its GAII. */
  name: string;
  displayName: string;
  /** What it is for, in the owner's words. Shown on the button's panel and stored on the record. */
  description: string;
  /** Exactly what this agent may do. Never widened by anything the caller sends. */
  scopes: string[];
  /** Server-side operational mode (which Hello Integration flow, how the fleet views group it). */
  mode: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
  /** How it is meant to be run. Stored and shown; the runtime is what honours it. */
  runMode: RunMode;
  tags: string[];
}

/**
 * `spawn` for all three, which is the stated default: an agent is data on the node until work
 * arrives, and a wake starts a worker that unwinds when the work is done. The concierge is the
 * plausible candidate for `resident` — it is a front door — and it is deliberately NOT set that way
 * here: the node records the run mode and the owner changes it (PATCH /v1/agents/:name/run-mode),
 * rather than the node deciding on the runtime's behalf which of its processes must stay up.
 */
export const BASIC_AGENTS: readonly BasicAgentTemplate[] = [
  {
    name: 'concierge',
    displayName: 'Concierge',
    description: 'The front door. Takes what arrives, works out what it is about, answers what it can, and hands the rest to whoever should have it.',
    scopes: [
      'memory:read', 'memory:write',
      'messages:read', 'messages:send',
      'task:read', 'task:write',
      'organism:read',
      'catalogue:read',
    ],
    mode: 'interactive',
    runMode: 'spawn',
    tags: ['crew:basic', 'role:concierge'],
  },
  {
    name: 'crew-forge',
    displayName: 'Crew forge',
    description: 'Makes more agents for you when they are needed, and clears away the ones it made.',
    scopes: [
      'memory:read', 'memory:write',
      // The two words that let it do its job on siblings it created. `agent:delete` is fenced a
      // second time at the route: an agent may only end an agent whose registration it authorized.
      'agent:write', 'agent:delete',
      'task:read', 'task:write',
      'catalogue:read',
    ],
    mode: 'coordinator',
    runMode: 'spawn',
    tags: ['crew:basic', 'role:crew-forge'],
  },
  {
    name: 'workflow-manager',
    displayName: 'Workflow manager',
    description: 'Orders work from your other agents and keeps track of what came back.',
    scopes: [
      'memory:read', 'memory:write',
      'task:read', 'task:write',
      'workflow:read', 'workflow:write',
      'work:request', 'work:read',
      'messages:read', 'messages:send',
      'catalogue:read',
    ],
    mode: 'coordinator',
    runMode: 'spawn',
    tags: ['crew:basic', 'role:workflow-manager'],
  },
];

export function basicAgentByName(name: string): BasicAgentTemplate | undefined {
  return BASIC_AGENTS.find(a => a.name === name);
}
