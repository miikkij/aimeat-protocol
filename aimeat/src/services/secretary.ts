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
 *   v0.5.0 — 2026-06-24 — Secretary P5 (S-A): ensureSecretary now provisions via the shared
 *     provisionSystemAgent helper (services/system-agent.ts) so the Secretary, company Secretary, and
 *     the new specialist agent type share ONE keypair+create+race path (not a fork). UNLISTED_TAG +
 *     the provisioning pattern are reused by services/specialist.ts.
 *   v0.4.0 — 2026-06-24 — Secretary G1: kill the double-brain for company secretaries provisioned before
 *     v0.3.0. Adds dropEnterpriseDuplicates() (merge-time dedup, used by agent-directives.ts) +
 *     isStalePersistedBrain(); ensureCompanySecretary() now self-heals on re-provision by deleting a
 *     persisted brain copy that purely duplicates the locked layer (seam-sourced brain is the source of truth).
 *   v0.3.0 — 2026-06-24 — Secretary P4-B: ensureCompanySecretary() no longer persists the locked brain
 *     into the agent's directives record. The brain is now overlaid read-only as a `source:'enterprise'`
 *     layer from the Enterprise seam at directives-read time (routes/agent-directives.ts) — swappable +
 *     per-company, with the agent layer left free for future per-owner rules under the locked layer.
 *   v0.2.0 — 2026-06-24 — Phase 6: ensureCompanySecretary() — provision the per-org company Secretary
 *     (`secretary-<slug>#<owner>@node`) with the EE-supplied enterprise scopes + a locked directives
 *     brain. Core owns provisioning; the EE module supplies the policy + the org consent grant.
 *   v0.1.0 — 2026-06-23 — Phase 0: Secretary identity + auto-provisioning
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import type { EnterpriseProvider } from '../enterprise/provider.js';
import { buildGAII } from '../utils/gaii.js';
import { generateKeyPair } from '../auth/keypair.js';
import { scopesForProfile } from '../mcp/catalog/scopes.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';
import { provisionSystemAgent } from './system-agent.js';

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
  const { record, created } = await provisionSystemAgent(storage, config, {
    name: SECRETARY_AGENT_NAME,
    owner: ownerName,
    gaii,
    displayName: 'Secretary',
    description: 'Your personal AIMEAT secretary.',
    defaultScopes: scopesForProfile('secretary'),
    tags: [SECRETARY_ROLE_TAG, UNLISTED_TAG],
  });
  if (created) logger.info('[secretary] provisioned', { gaii });
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
 * the agent as a company Secretary. The locked brain is NOT persisted here — it is overlaid read-only as
 * a `source:'enterprise'` layer from the Enterprise seam at directives-read time (Secretary P4-B), so it
 * stays swappable and per-company. The `org.{id}` consent grant that attaches it is owned by the EE
 * module (it knows the org's data namespace), not created here.
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
  if (existing) {
    // G1 self-heal: a company Secretary provisioned before v0.3.0 persisted the locked brain into its
    // agent directives. The brain is now seam-sourced, so strip that stale copy when re-provisioned —
    // idempotent (a clean record is left untouched) and safe (only deletes when the persisted record is
    // purely a copy of the locked brain, preserving any genuine future per-owner agent-layer rules).
    if (opts.directives) {
      const persisted = await storage.getAgentDirectives(gaii).catch(() => null);
      if (persisted && isStalePersistedBrain(persisted.rules, opts.directives.rules)) {
        await storage.deleteAgentDirectives(gaii);
        emitChange('agent-directives', gaii);
        logger.info('[secretary] stripped stale persisted brain from company secretary', { gaii });
      }
    }
    return { gaii, name, created: false };
  }

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

  // The locked brain (opts.directives) is NOT persisted into the agent's own directives record. It is
  // surfaced as a read-only `source:'enterprise'` layer overlaid live from the Enterprise seam at read
  // time (see routes/agent-directives.ts, Secretary P4-B). Keeping it out of the agent layer means the
  // edition can swap a company's brain without a write, and the agent layer stays free for any future
  // per-owner customization that coexists under the locked layer. `opts.directives` is accepted for the
  // seam contract but intentionally not written here.

  emitChange('agents', gaii);
  logger.info('[secretary] company secretary provisioned', { gaii, orgId: opts.orgId });
  return { gaii, name, created: true };
}

/** A read-only Enterprise (edition-locked) directive rule — the 4th merge source (Secretary P4-B). */
export interface EnterpriseDirectiveRule {
  id: string;
  description: string;
  source: 'enterprise';
  locked: true;
}

/** The resolved Enterprise directive layer: the locked brain's purpose + its read-only rules. */
export interface EnterpriseDirectiveLayer {
  purpose: string;
  rules: EnterpriseDirectiveRule[];
}

/**
 * Resolve the read-only Enterprise (edition-locked) directive layer for an agent (Secretary P4-B), or an
 * empty layer. Only a company Secretary (tagged {@link COMPANY_SECRETARY_TAG}) on an edition that
 * supplies `secretaryDirectives` yields rules; the org is taken from the agent's `org:<slug>` tag and
 * resolved live from the seam (never persisted — so brains are swappable and each company resolves its
 * own). Every other agent — and Community (the stub omits the seam method) — yields an empty layer, so
 * the directives merge is unchanged for them. Pure + synchronous: unit-testable with a fake provider.
 */
export function resolveEnterpriseDirectiveLayer(
  tags: string[] | undefined,
  enterprise: Pick<EnterpriseProvider, 'secretaryDirectives'> | undefined,
  nodeId: string,
): EnterpriseDirectiveLayer {
  const empty: EnterpriseDirectiveLayer = { purpose: '', rules: [] };
  if (!enterprise?.secretaryDirectives || !(tags ?? []).includes(COMPANY_SECRETARY_TAG)) return empty;
  const orgTag = (tags ?? []).find(tag => tag.startsWith('org:'));
  const orgSlug = orgTag ? orgTag.slice('org:'.length) : '';
  if (!orgSlug) return empty;
  const layer = enterprise.secretaryDirectives(`org:${orgSlug}@${nodeId}`);
  if (!layer) return empty;
  return {
    purpose: layer.purpose,
    rules: layer.rules.map((r, idx) => ({
      id: r.id ?? `enterprise-${idx + 1}`,
      description: r.description,
      source: 'enterprise' as const,
      locked: true as const,
    })),
  };
}

/** Normalize a directive description for duplicate detection (trim + collapse whitespace + lowercase). */
function normalizeRuleText(s: string): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Drop lower-layer (owner/agent) rules that duplicate the locked enterprise layer (Secretary G1). A
 * company Secretary provisioned before the brain became seam-sourced (≤ v0.2.0) persisted the locked
 * brain into its agent directives; with the live enterprise overlay that stale copy would otherwise
 * render a SECOND time next to the locked layer. Pure: matches on normalized description, so a stale
 * copy is collapsed while genuine per-owner rules (that don't duplicate the locked layer) are kept.
 * A no-op when there is no enterprise layer — so Community and non-company agents are untouched.
 */
export function dropEnterpriseDuplicates<T extends { description: string }>(
  rules: T[],
  enterpriseRules: Array<{ description: string }>,
): T[] {
  if (!enterpriseRules.length) return rules;
  const locked = new Set(enterpriseRules.map(r => normalizeRuleText(r.description)));
  return rules.filter(r => !locked.has(normalizeRuleText(r.description)));
}

/**
 * True when a persisted agent-directives rule set is purely a stale copy of the locked brain (every
 * persisted rule duplicates a brain rule, no genuine extra rules) — the safe condition under which the
 * persisted record can be deleted during the G1 self-heal without losing any real per-owner rules.
 */
export function isStalePersistedBrain(
  persistedRules: Array<{ description: string }>,
  brainRules: Array<{ description: string }>,
): boolean {
  if (!persistedRules.length) return false;
  const brain = new Set(brainRules.map(r => normalizeRuleText(r.description)));
  return persistedRules.every(r => brain.has(normalizeRuleText(r.description)));
}
