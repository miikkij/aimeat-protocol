/**
 * @file aimeat/src/enterprise/provider.ts
 * @description Open-core seam for the AIMEAT Enterprise edition. Defines the `EnterpriseProvider`
 *   contract that an optional, separately-licensed `ee/` module implements, the `EnterpriseContext`
 *   that core injects into it (dependency injection — the EE module never imports core internals by
 *   path), and the `StubEnterpriseProvider` that ships in the open core so the product runs fully
 *   without the proprietary module (returns `ENTERPRISE_REQUIRED` for gated namespaces).
 * @structure EnterpriseProvider (interface) · EnterpriseContext (interface) · stubEnterpriseProvider()
 *   · SecretaryCapability · SecretaryDirectiveLayer (Secretary Phase 6 seam additions)
 * @usage const provider = await loadEnterpriseProvider(buildEnterpriseContext(config, storage));
 *        await provider.mountRoutes(app);
 * @version-history
 *   v0.2.0 — 2026-06-24 — Secretary Phase 6: additive seam for the company Secretary — optional
 *     secretaryCapabilities()/secretaryDirectives(orgId)/secretaryScopes() (ee/ contributes the
 *     locked brain + enterprise scope superset + company-admin tools; stub returns nothing so
 *     Community is unaffected) + EnterpriseContext.ensureCompanySecretary (core provisioning helper).
 *   v0.1.0 — 2026-06-23 — initial enterprise seam (experiment skeleton)
 */
import type express from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { success as successFn, error as errorFn } from '../middleware/envelope.js';
import type { requireAuth as requireAuthFn, requireRole as requireRoleFn } from '../auth/middleware.js';
import type { resolveIdentity as resolveIdentityFn, buildGAII as buildGAIIFn } from '../utils/gaii.js';
import type { logger as loggerInst } from '../utils/logger.js';

/**
 * Everything the EE module needs, injected by core. The EE module is plain ESM JS in a separate
 * private repo; it must NOT import core source by relative path, so all primitives arrive here.
 */
export interface EnterpriseContext {
  config: AimeatConfig;
  storage: Storage;
  success: typeof successFn;
  error: typeof errorFn;
  requireAuth: typeof requireAuthFn;
  requireRole: typeof requireRoleFn;
  resolveIdentity: typeof resolveIdentityFn;
  buildGAII: typeof buildGAIIFn;
  /** Fulfil a priced offering by invoking its backing capability. Resolves the capability's result. */
  invokeCapability: (
    capability: unknown,
    input: unknown,
    callerGhii: string,
    jwt: string,
    mode: 'normal' | 'raw',
  ) => Promise<unknown>;
  /**
   * Provision (idempotently) the company Secretary agent for an organization (Secretary Phase 6).
   * Core owns the provisioning machinery (keypair, tags, the locked directives write); the EE module
   * supplies the org identity + the enterprise scope superset + the locked brain. Returns whether a
   * new agent was created. The EE module owns the `org.{id}` consent grant that attaches it.
   */
  ensureCompanySecretary: (opts: {
    orgId: string;
    orgSlug: string;
    ownerName: string;
    scopes: string[];
    directives: SecretaryDirectiveLayer | null;
  }) => Promise<{ gaii: string; name: string; created: boolean }>;
  logger: typeof loggerInst;
}

/**
 * A company-admin Secretary capability the EE module contributes to the registry (Phase 6). Declarative
 * only — the frontend renders these as the company Secretary's tools; the backing action is gated by
 * `scope`/`band` like any other capability. `enterprise: true` marks it as unavailable in Community.
 */
export interface SecretaryCapability {
  id: string;
  title: string;
  description: string;
  scope?: string;
  band?: 'act' | 'draft' | 'ask' | 'off';
  enterprise?: boolean;
}

/**
 * The locked "brain" layer the EE module supplies for a company Secretary (Phase 6). Stored as the
 * agent's directives; `locked` signals the SPA to render it read-only (the company brain is owned by
 * the edition, not editable per-owner like the personal Secretary's brain).
 */
export interface SecretaryDirectiveLayer {
  purpose: string;
  rules: Array<{ id?: string; description: string }>;
  locked?: boolean;
}

/** Implemented by the proprietary `ee/` module (and by the open-core stub). */
export interface EnterpriseProvider {
  /** Human-readable module name (e.g. "stub" or "aimeat-enterprise"). */
  name: string;
  /** Module version string. */
  version: string;
  /** Mount the edition's routes on the Express app. Stub mounts `ENTERPRISE_REQUIRED` responders. */
  mountRoutes(app: express.Express): void | Promise<void>;

  // ── Secretary Phase 6 (all additive + optional — the stub omits them, so Community runs fully) ──
  /** Company-admin Secretary capabilities this edition contributes (invoicing prep, compliance, …). */
  secretaryCapabilities?(): SecretaryCapability[];
  /** The locked brain layer for an org's company Secretary, or null if this edition has none. */
  secretaryDirectives?(orgId: string): SecretaryDirectiveLayer | null;
  /** The `secretary-enterprise` scope superset granted to a company Secretary. */
  secretaryScopes?(): string[];
}

/**
 * The registry accessor (Phase 6): the single place core reads the edition's Secretary contributions,
 * merged with core's personal defaults. Community (stub omits the methods) yields just the personal
 * capability set and no enterprise scopes — so callers never branch on edition.
 */
export function secretaryRegistry(provider: EnterpriseProvider): {
  capabilities: SecretaryCapability[];
  enterpriseScopes: string[];
} {
  return {
    capabilities: [...PERSONAL_SECRETARY_CAPABILITIES, ...(provider.secretaryCapabilities?.() ?? [])],
    enterpriseScopes: provider.secretaryScopes?.() ?? [],
  };
}

/** Core's built-in personal Secretary capability set (always present, both editions). */
export const PERSONAL_SECRETARY_CAPABILITIES: SecretaryCapability[] = [
  { id: 'discover', title: 'Find resources', description: 'Search the master directory for capabilities, agents, knowledge.', band: 'act' },
  { id: 'note', title: 'Save a note', description: 'File information into the right workspace.', scope: 'memory:write', band: 'draft' },
  { id: 'decision', title: 'Log & review decisions', description: 'Track decisions and score outcomes over time.', scope: 'memory:write', band: 'draft' },
];

/** HTTP status used when a gated namespace is hit on a node without the EE module. */
export const ENTERPRISE_REQUIRED_STATUS = 501;

/**
 * The open-core fallback. Guards the enterprise namespaces and returns a clear, machine-readable
 * `ENTERPRISE_REQUIRED` envelope so Community nodes degrade gracefully (the plan's stub requirement).
 */
export function stubEnterpriseProvider(ctx: EnterpriseContext): EnterpriseProvider {
  const { config, error } = ctx;
  return {
    name: 'stub',
    version: '0.0.0',
    mountRoutes(app: express.Express): void {
      // Whole `/v1/orgs` commerce namespace requires the Enterprise edition.
      app.use('/v1/orgs', (_req, res) => {
        res
          .status(ENTERPRISE_REQUIRED_STATUS)
          .json(
            error(
              config.nodeId,
              'ENTERPRISE_REQUIRED',
              'Organization commerce requires the AIMEAT Enterprise edition (ee/ module not installed).',
            ),
          );
      });
    },
  };
}
