/**
 * @file secretary.ts
 * @description Provisioning + lookup for the per-owner Secretary agent (Phase 0). The Secretary is a
 *   special GAII agent (`secretary#<owner>@<node>`) auto-provisioned when the owner configures
 *   OpenRouter — no device-auth dance. It is tagged `system:secretary` + `unlisted` so it shows in
 *   the owner's Agents tab but never appears in the public catalogue/directory. Scopes come from the
 *   conservative `secretary` profile (mcp/catalog/scopes.ts). Idempotent: ensureSecretary only
 *   creates when absent. Full design: docs/plans/2026-06-23-secretary-feature.md.
 * @structure SECRETARY_AGENT_NAME · UNLISTED_TAG · SECRETARY_ROLE_TAG · secretaryGaii() ·
 *   getSecretary() · ensureSecretary()
 * @usage await ensureSecretary(storage, config, ownerName)  // after the OpenRouter key is saved
 * @version-history v0.1.0 — 2026-06-23 — Phase 0: Secretary identity + auto-provisioning
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { buildGAII } from '../utils/gaii.js';
import { generateKeyPair } from '../auth/keypair.js';
import { scopesForProfile } from '../mcp/catalog/scopes.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** Reserved bare name for the per-owner Secretary agent (exactly one per owner). */
export const SECRETARY_AGENT_NAME = 'secretary';
/** Tag that hides an agent from the public catalogue/directory (kept generic for future system agents). */
export const UNLISTED_TAG = 'unlisted';
/** Tag identifying the Secretary system role (so the owner's UI can find/pin it). */
export const SECRETARY_ROLE_TAG = 'system:secretary';

/** The Secretary GAII for an owner: bare owner name → `secretary#owner@node`. */
export function secretaryGaii(ownerName: string, config: AimeatConfig): string {
  return buildGAII(SECRETARY_AGENT_NAME, ownerName, config.nodeId);
}

/** Fetch the owner's Secretary agent record, or null if not yet provisioned. */
export async function getSecretary(
  storage: Storage,
  config: AimeatConfig,
  ownerName: string,
): Promise<AgentRecord | null> {
  return storage.getAgent(secretaryGaii(ownerName, config));
}

/**
 * Ensure the owner has a Secretary agent. Idempotent — returns the existing record if present,
 * otherwise provisions one. The Secretary acts server-side on the owner's behalf and does not hold
 * a JWT yet, so the generated private key is intentionally discarded in Phase 0 (a keypair is only
 * created because `publicKey` is a required field); JWT/device wiring is a later phase.
 */
export async function ensureSecretary(
  storage: Storage,
  config: AimeatConfig,
  ownerName: string,
): Promise<AgentRecord> {
  const gaii = secretaryGaii(ownerName, config);
  const existing = await storage.getAgent(gaii);
  if (existing) return existing;

  const { publicKey } = await generateKeyPair();
  const now = new Date().toISOString();
  const record: AgentRecord = {
    name: SECRETARY_AGENT_NAME,
    owner: ownerName,
    gaii,
    displayName: 'Secretary',
    description: 'Your personal AIMEAT secretary.',
    capabilities: [],
    publicKey,
    trustScore: 50,
    morselBalance: 0,
    createdAt: now,
    lastSeen: now,
    defaultScopes: scopesForProfile('secretary'),
    mode: 'interactive',
    tags: [SECRETARY_ROLE_TAG, UNLISTED_TAG],
  };

  try {
    await storage.createAgent(record);
  } catch (err) {
    // Lost a provisioning race (two concurrent key saves) — the other create won; reuse it.
    const again = await storage.getAgent(gaii);
    if (again) return again;
    throw err;
  }

  emitChange('agents', gaii);
  logger.info('[secretary] provisioned', { gaii });
  return record;
}
