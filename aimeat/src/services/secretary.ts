/**
 * @file secretary.ts
 * @description Provisioning + lookup for the per-owner Secretary agent (Phase 0). The Secretary is a
 *   special GAII agent (`secretary#<owner>@<node>`) auto-provisioned when the owner configures
 *   OpenRouter — no device-auth dance. It is tagged `system:secretary` + `unlisted` so it shows in
 *   the owner's Agents tab but never appears in the public catalogue/directory. Scopes come from the
 *   conservative `secretary` profile (mcp/catalog/scopes.ts). Idempotent: ensureSecretary only
 *   creates when absent. Full design: docs/plans/2026-06-23-secretary-feature.md.
 * @structure SECRETARY_AGENT_NAME · UNLISTED_TAG · SECRETARY_ROLE_TAG · secretaryGaii() ·
 *   getSecretary() · ensureSecretary() · COMPANY_SECRETARY_TAG · companySecretaryName/Gaii() ·
 *   getCompanySecretary() · ensureCompanySecretary() (Phase 6)
 * @usage await ensureSecretary(storage, config, ownerName)  // after the OpenRouter key is saved
 * @version-history
 *   v0.2.0 — 2026-06-24 — Phase 6: ensureCompanySecretary() — provision the per-org company Secretary
 *     (`secretary-<slug>#<owner>@node`) with the EE-supplied enterprise scopes + a locked directives
 *     brain. Core owns provisioning; the EE module supplies the policy + the org consent grant.
 *   v0.1.0 — 2026-06-23 — Phase 0: Secretary identity + auto-provisioning
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

// ── Company Secretary (Phase 6) ──────────────────────────────────────────────────────────────────

/** Tag marking the per-org company Secretary (locked brain, enterprise scopes; distinct from personal). */
export const COMPANY_SECRETARY_TAG = 'system:company-secretary';

/** Bare agent name for an org's company Secretary: one per org slug (`secretary-<slug>`). */
export function companySecretaryName(orgSlug: string): string {
  return `secretary-${orgSlug}`;
}

/** The company Secretary GAII: `secretary-<slug>#<owner>@node` (owned by the org's creator owner). */
export function companySecretaryGaii(orgSlug: string, ownerName: string, config: AimeatConfig): string {
  return buildGAII(companySecretaryName(orgSlug), ownerName, config.nodeId);
}

/** Fetch an org's company Secretary agent, or null if not provisioned. */
export async function getCompanySecretary(
  storage: Storage,
  config: AimeatConfig,
  orgSlug: string,
  ownerName: string,
): Promise<AgentRecord | null> {
  return storage.getAgent(companySecretaryGaii(orgSlug, ownerName, config));
}

/**
 * Provision (idempotently) the company Secretary for an organization. Mirrors {@link ensureSecretary}
 * but takes the enterprise scope superset + the locked brain from the caller (the EE module), and tags
 * the agent as a company Secretary. The locked brain is written to the agent's directives store; the
 * SPA renders it read-only. The `org.{id}` consent grant that attaches it is owned by the EE module
 * (it knows the org's data namespace), not created here.
 */
export async function ensureCompanySecretary(
  storage: Storage,
  config: AimeatConfig,
  opts: {
    orgId: string;
    orgSlug: string;
    ownerName: string;
    scopes: string[];
    directives: { purpose: string; rules: Array<{ id?: string; description: string }>; locked?: boolean } | null;
  },
): Promise<{ gaii: string; name: string; created: boolean }> {
  const name = companySecretaryName(opts.orgSlug);
  const gaii = companySecretaryGaii(opts.orgSlug, opts.ownerName, config);
  const existing = await storage.getAgent(gaii);
  if (existing) return { gaii, name, created: false };

  const { publicKey } = await generateKeyPair();
  const now = new Date().toISOString();
  const record: AgentRecord = {
    name,
    owner: opts.ownerName,
    gaii,
    displayName: 'Company Secretary',
    description: `Company Secretary for ${opts.orgSlug}.`,
    capabilities: [],
    publicKey,
    trustScore: 50,
    morselBalance: 0,
    createdAt: now,
    lastSeen: now,
    // EE supplies the enterprise scope superset; fall back to the conservative personal profile so a
    // misconfigured EE module can never widen access beyond the safe default.
    defaultScopes: opts.scopes.length ? opts.scopes : scopesForProfile('secretary'),
    mode: 'interactive',
    tags: [SECRETARY_ROLE_TAG, COMPANY_SECRETARY_TAG, UNLISTED_TAG, `org:${opts.orgSlug}`],
  };

  try {
    await storage.createAgent(record);
  } catch (err) {
    const again = await storage.getAgent(gaii);
    if (again) return { gaii, name, created: false };
    throw err;
  }

  // Write the locked brain as the agent's directives (read-only in the SPA for company secretaries).
  if (opts.directives) {
    await storage.upsertAgentDirectives({
      agentGaii: gaii,
      purpose: opts.directives.purpose,
      rules: opts.directives.rules.map((r, i) => ({ id: r.id ?? `r${i + 1}`, description: r.description })),
      memoryAreas: [],
      resources: [],
      updatedAt: now,
    });
  }

  emitChange('agents', gaii);
  logger.info('[secretary] company secretary provisioned', { gaii, orgId: opts.orgId });
  return { gaii, name, created: true };
}
