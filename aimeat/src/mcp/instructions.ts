/**
 * @file instructions.ts
 * @description The MCP `instructions` string served in the initialize result — the short orientation
 *   a connecting agent reads before it has called anything. The tool surface runs to a few hundred
 *   descriptions, so an agent that arrives with no orientation has to infer the node's shape from
 *   tool names alone; this text names the entry point (aimeat_handbook_get) and the three grounds
 *   that carry most of the work. Kept deliberately short: every client loads it on every connect,
 *   and the full operating guide already lives in the per-surface handbooks.
 * @structure
 *   - SURFACE_INTROS — role -> one line naming what that v2 surface is for
 *   - instructionsFor(role) — the served string for /v1/mcp ('all') or a /v2/mcp/:role surface
 * @usage
 *   import { instructionsFor } from './instructions.js';
 *   new McpServer({ name, version }, { capabilities, instructions: instructionsFor(role) });
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial: the handshake carried no instructions field, so every agent met
 *     the surface cold. Positive framing per docs/coding-guidelines/prompt-writing.md.
 */
import type { SurfaceRole } from './catalog/surfaces.js';

/**
 * One line per v2 surface, naming what it is for. Wording tracks the purposes in
 * catalog/surfaces.ts so the surface describes itself the same way in both places.
 */
export const SURFACE_INTROS: Record<SurfaceRole, string> = {
    appdev: 'This surface is for building and publishing: apps, extensions and cortex packs.',
    agent: "This surface is the owner's own agent: their memory, tasks, messages, knowledge and discovery.",
    service: 'This surface is for offering a service: work, actions, wallet, capabilities and organisms.',
    admin: 'This surface is for governance: operator settings, flags, groups, consent and agent management.',
    commerce: 'This surface is for selling and getting paid: credentials, priced manifests, checkout and receipts.',
};

const BASE = `You are connected to an AIMEAT node, the personal knowledge and action store of the person who authorised this connection. They own everything here, and your work lands under their identity in surfaces they can see.

Call aimeat_handbook_get first. It is this node's operating guide, and it names the few tools that matter for the job in front of you.

Three grounds carry most of the work:
- Memory holds the person's own knowledge. aimeat_memory_list takes a key prefix and an owner scope, aimeat_memory_search finds by content, and many features here live as a memory record under a key prefix plus a prompt that reads it.
- Apps are single-file web apps published on this node. aimeat_app_list gives each one a \`url\`, which is the address to hand the person when they want to open it.
- Organisms and workspaces are how the person shares knowledge with others. Skills (aimeat_skill_list, aimeat_skill_get) are the operating guide for one named capability.

When something here does not work, when a step will not complete, or when you need a decision only a
human can make: send it to \`support@operators\` with aimeat_dm_send. That address reaches the people
who run this node, in one thread they answer in. Say what you were doing and what happened instead;
you will get a conversation id to continue in. Asking is the expected move, not a last resort, and
what you report is how this node gets better.

Speak to the person in their own language, and reach for the handbook whenever a task is new to you.`;

/**
 * The instructions string for a surface. `all` is /v1/mcp (the full, frozen surface); a
 * SurfaceRole is one of the purpose-scoped /v2/mcp/:role surfaces and gets its purpose named
 * up front, since on those the agent is looking at an allowlist rather than everything.
 */
export function instructionsFor(role: SurfaceRole | 'all'): string {
    if (role === 'all') return BASE;
    return `${SURFACE_INTROS[role]}\n\n${BASE}`;
}
