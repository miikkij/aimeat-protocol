/**
 * @file system-agent.ts
 * @description Shared provisioning primitive for server-side "system" agents — agents the owner does
 *   NOT connect via device auth (RFC 8628) but that the node provisions on the owner's behalf and that
 *   act server-side without holding a JWT: the personal Secretary, the company Secretary, and
 *   specialist agents (Secretary P5 / S-A). Factored out of ensureSecretary so all three share ONE
 *   keypair+create+race path instead of forking it. The generated private key is intentionally
 *   discarded (only `publicKey` is a required AgentRecord field); JWT/device wiring is a later phase.
 * @structure provisionSystemAgent() — idempotent create, returns { record, created }
 * @usage const { record, created } = await provisionSystemAgent(storage, config, spec)
 * @version-history
 *   v1.0.0 — 2026-06-24 — Initial: extracted the ensureSecretary provisioning pattern (Secretary P5 S-A)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { emitChange } from './event-bus.js';

/** The fields a caller supplies to provision a system agent; the helper fills keypair + timestamps. */
export interface SystemAgentSpec {
  name: string;
  owner: string;
  gaii: string;
  displayName: string;
  description: string;
  /** Scope bundle for the agent (from a scope profile). */
  defaultScopes: string[];
  /** Classification/role tags (e.g. system:secretary + unlisted, or system:specialist + role:sdr). */
  tags: string[];
  trustScore?: number;
  mode?: AgentRecord['mode'];
}

/**
 * Idempotently provision a server-side system agent. Returns the existing record (created:false) if the
 * GAII is already taken, otherwise creates it (created:true). Handles the provisioning race (two
 * concurrent calls) by reusing whichever create won. Emits an `agents` change on a fresh create.
 */
export async function provisionSystemAgent(
  storage: Storage,
  _config: AimeatConfig,
  spec: SystemAgentSpec,
): Promise<{ record: AgentRecord; created: boolean }> {
  const existing = await storage.getAgent(spec.gaii);
  if (existing) return { record: existing, created: false };

  const { publicKey } = await generateKeyPair();
  const now = new Date().toISOString();
  const record: AgentRecord = {
    name: spec.name,
    owner: spec.owner,
    gaii: spec.gaii,
    displayName: spec.displayName,
    description: spec.description,
    capabilities: [],
    publicKey,
    trustScore: spec.trustScore ?? 50,
    morselBalance: 0,
    createdAt: now,
    lastSeen: now,
    defaultScopes: spec.defaultScopes,
    mode: spec.mode ?? 'interactive',
    tags: spec.tags,
  };

  try {
    await storage.createAgent(record);
  } catch (err) {
    // Lost a provisioning race — the other create won; reuse it.
    const again = await storage.getAgent(spec.gaii);
    if (again) return { record: again, created: false };
    throw err;
  }

  emitChange('agents', spec.gaii);
  return { record, created: true };
}
