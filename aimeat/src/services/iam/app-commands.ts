/**
 * @file app-commands.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description P5 (app layer) shared primitives: the COMMAND MANIFEST + mutation tiers that let an app
 *   expose a command interface agents read and call, gated by the SAME level→capability model the node
 *   uses for organisms/workspaces (services/iam/model.ts). An app's level schema is just a LevelSchema
 *   with groupType 'app' whose capabilities are app-defined strings ('*' = all, matching the aimeat-iam
 *   extension's role-permission semantics); this file adds the command layer on top: a command names the
 *   capability a caller's level must hold to run it, plus a mutation tier (read | write | irreversible)
 *   so an agent knows when to seek human confirmation. PURE + node-side (no storage, no I/O) — the
 *   contract the aimeat-iam extension, the app-facing library, and the MCP define tool all implement.
 *   "One permission model, two user kinds": `caller` is a human GHII or an agent GAII, identically.
 * @structure
 *   - MutationTier / CommandDef / CommandManifest — the shapes
 *   - appMayRunCommand(level, schema, command) — the pure capability decision (mirrors check.js)
 *   - commandNeedsConfirmation(command) — irreversible ⇒ confirm even when authorized
 *   - deriveAppCommandDecision(level, schema, manifest, commandId) — resolve + decide in one call
 *   - validateCommandManifest(manifest) — structural validation for the authoring surface
 * @usage const d = deriveAppCommandDecision(level, appSchema, manifest, 'purge');
 * @version-history
 *   v1.0.0 — 2026-07-02 — IAM P5 slice 1: app command manifest + mutation tiers + decision, aligned to
 *     the shared level/capability primitive. Pure; nothing wired yet (extension + MCP adopt it next).
 */
import type { LevelSchema } from './model.js';
import { capabilitiesOf } from './model.js';

/** Mutation risk of a command — an agent should confirm 'irreversible' ones with the human. */
export type MutationTier = 'read' | 'write' | 'irreversible';

/** One command an app exposes: agents read the description, then call it gated by the level model. */
export interface CommandDef {
  /** Stable command id (what the agent calls). */
  id: string;
  /** Human/agent-readable description of what the command does. */
  description: string;
  /** The app-capability a caller's level must hold to run it ('*' in the level = all). */
  capability: string;
  /** Mutation tier — read | write | irreversible. */
  tier: MutationTier;
}

/** An app's command interface: the commands agents can discover + call, gated by the app LevelSchema. */
export interface CommandManifest {
  appId: string;
  commands: CommandDef[];
}

/**
 * Does a caller at `level` (under the app's LevelSchema) hold the capability the command requires? A
 * level holding '*' runs anything (matching the aimeat-iam extension's `perms.includes('*')`). This is
 * the pure decision — the app enforces it via its library; the node stores the schema + manifest.
 */
export function appMayRunCommand(level: number, schema: LevelSchema, command: CommandDef): boolean {
  const caps = capabilitiesOf(level, schema);
  return caps.has('*') || caps.has(command.capability);
}

/** Irreversible commands should be confirmed by the human even when the agent is authorized. */
export function commandNeedsConfirmation(command: CommandDef): boolean {
  return command.tier === 'irreversible';
}

/** The outcome of resolving + deciding a command call. */
export type AppCommandDecision =
  | { allowed: false; reason: 'unknown-command' | 'insufficient-capability'; command?: CommandDef }
  | { allowed: true; command: CommandDef; needsConfirmation: boolean; tier: MutationTier };

/**
 * Resolve a command by id in the manifest and decide whether the caller (at `level` under `schema`) may
 * run it, surfacing the mutation tier + whether the human should confirm. One call for the app-facing
 * library / MCP surface: unknown id ⇒ denied 'unknown-command'; known but under-capability ⇒ denied
 * 'insufficient-capability'; else allowed with needsConfirmation from the tier.
 */
export function deriveAppCommandDecision(
  level: number, schema: LevelSchema, manifest: CommandManifest, commandId: string,
): AppCommandDecision {
  const command = manifest.commands.find(c => c.id === commandId);
  if (!command) return { allowed: false, reason: 'unknown-command' };
  if (!appMayRunCommand(level, schema, command)) return { allowed: false, reason: 'insufficient-capability', command };
  return { allowed: true, command, needsConfirmation: commandNeedsConfirmation(command), tier: command.tier };
}

const TIERS = new Set<MutationTier>(['read', 'write', 'irreversible']);

/** Structural validation for a command manifest (the authoring surface — MCP tool / app dashboard). */
export function validateCommandManifest(manifest: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof manifest !== 'object' || manifest === null) return { ok: false, error: 'manifest must be an object' };
  const m = manifest as Partial<CommandManifest>;
  if (typeof m.appId !== 'string' || !m.appId.trim()) return { ok: false, error: 'appId is required' };
  if (!Array.isArray(m.commands) || m.commands.length === 0) return { ok: false, error: 'commands must be a non-empty array' };
  const ids = new Set<string>();
  for (const c of m.commands as CommandDef[]) {
    if (typeof c?.id !== 'string' || !c.id.trim()) return { ok: false, error: 'each command needs a non-empty id' };
    if (typeof c.description !== 'string' || !c.description.trim()) return { ok: false, error: `command "${c.id}" needs a description` };
    if (typeof c.capability !== 'string' || !c.capability.trim()) return { ok: false, error: `command "${c.id}" needs a capability` };
    if (!TIERS.has(c.tier)) return { ok: false, error: `command "${c.id}" tier must be read | write | irreversible` };
    if (ids.has(c.id)) return { ok: false, error: `duplicate command id "${c.id}"` };
    ids.add(c.id);
  }
  return { ok: true };
}
