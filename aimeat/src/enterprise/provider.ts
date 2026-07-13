/**
 * @file aimeat/src/enterprise/provider.ts
 * @description Open-core seam for the AIMEAT Enterprise edition. Defines the `EnterpriseProvider`
 *   contract that an optional, separately-licensed `ee/` module implements, the `EnterpriseContext`
 *   that core injects into it (dependency injection — the EE module never imports core internals by
 *   path), and the `StubEnterpriseProvider` that ships in the open core so the product runs fully
 *   without the proprietary module (returns `ENTERPRISE_REQUIRED` for gated namespaces).
 * @structure EnterpriseProvider (interface) · EnterpriseContext (interface) · stubEnterpriseProvider()
 * @usage const provider = await loadEnterpriseProvider(buildEnterpriseContext(config, storage));
 *        await provider.mountRoutes(app);
 * @version-history
 *   v0.2.0 — 2026-07-13 — add optional getPaymentHandlers() (commerce core seam, TARGET-033)
 *   v0.1.0 — 2026-06-23 — initial enterprise seam (experiment skeleton)
 */
import type express from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { success as successFn, error as errorFn } from '../middleware/envelope.js';
import type { requireAuth as requireAuthFn, requireRole as requireRoleFn } from '../auth/middleware.js';
import type { resolveIdentity as resolveIdentityFn, buildGAII as buildGAIIFn } from '../utils/gaii.js';
import type { logger as loggerInst } from '../utils/logger.js';
import type { PaymentHandler } from '../commerce/types.js';

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
   * Route an already-computed marketplace fee to its configured destination (operator | burn,
   * per AIMEAT_MARKETPLACE_FEE_MODE). The seller/org legs are the EE module's business; the fee
   * leg goes through this so Community and EE sales share one fee policy (TARGET-033).
   */
  settleMarketplaceFee: (args: { fee: number; payerGhii: string; trackingCode: string; source: string }) => Promise<{
    fee: number; destination: 'operator' | 'burn' | 'none'; operatorGhii: string | null;
  }>;
  /** The effective checkout fee percent (commerce override, inheriting the marketplace percent). */
  commerceFeePercent: () => number;
  logger: typeof loggerInst;
}

/** Implemented by the proprietary `ee/` module (and by the open-core stub). */
export interface EnterpriseProvider {
  /** Human-readable module name (e.g. "stub" or "aimeat-enterprise"). */
  name: string;
  /** Module version string. */
  version: string;
  /** Mount the edition's routes on the Express app. Stub mounts `ENTERPRISE_REQUIRED` responders. */
  mountRoutes(app: express.Express): void | Promise<void>;
  /**
   * Payment handlers this edition contributes to the commerce core's registry (TARGET-033).
   * Community/stub: absent (core registers only the morsel handler). EE: real-money handlers
   * (stripe-spt, wallet tokens, stablecoin) — they land in the same registry and appear in the
   * /.well-known/ucp profile automatically.
   */
  getPaymentHandlers?(): PaymentHandler[] | Promise<PaymentHandler[]>;
}

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
