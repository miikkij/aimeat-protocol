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
 *   v0.4.0 — 2026-07-14 — add optional getMcpTools() + the declarative EnterpriseMcpTool contract
 *     (EE contributes MCP tools without importing MCP machinery; /v2/mcp/enterprise surface)
 *   v0.3.0 — 2026-07-14 — add ctx.money: the commerce money chokepoint (src/commerce/money.ts)
 *     injected whole, so the EE module never does inline micros math (TARGET-033 phase 7c)
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
import type { SellableResolver } from '../commerce/sellable-resolvers.js';
import type { safeFetch as safeFetchFn } from '../utils/url-validator.js';
import type * as moneyChokepoint from '../commerce/money.js';

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
  /** SSRF-guarded outbound HTTP (Rule 10: all non-constant outbound HTTP goes through safeFetch). */
  safeFetch: typeof safeFetchFn;
  /** Typed commerce error factory — EE-thrown errors keep their status codes through the adapters. */
  commerceError: (code: string, statusCode: number, message: string) => Error;
  /**
   * The commerce money chokepoint (src/commerce/money.ts), injected whole: micros↔Stripe minor,
   * micros↔USDC raw, percent fee/cut rounding, currency validation, formatting. ALL money math in
   * the EE module goes through this — never inline ÷10000/×1e6 (invariant: money = 6-decimal
   * micro-units at storage, rail precision only at settlement).
   */
  money: typeof moneyChokepoint;
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
  /**
   * Sellable resolvers this edition contributes to the checkout core (TARGET-033 phase 4).
   * EE registers `org-offering` — company-catalog items with commission-split distribution —
   * making org offerings purchasable through the same checkout sessions and protocol adapters.
   */
  getSellableResolvers?(): SellableResolver[] | Promise<SellableResolver[]>;
  /**
   * MCP tools this edition contributes to the node's MCP server (registered on every session
   * alongside the core tools; they also extend the /v2/mcp/enterprise surface). Declarative and
   * dependency-free on the EE side: the module returns plain tool SPECS (name, description,
   * field metadata, scope, annotations, async handler) and CORE does the zod/SDK work — the
   * proprietary module never imports MCP machinery. Community/stub: absent.
   */
  getMcpTools?(): EnterpriseMcpTool[] | Promise<EnterpriseMcpTool[]>;
}

/** One input field of an enterprise MCP tool (core converts this metadata to a zod shape). */
export interface EnterpriseMcpToolField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
  enum?: string[];
}

/** What an enterprise tool handler learns about the calling session (identity — never from input). */
export interface EnterpriseMcpSession {
  /** The calling agent's full GAII (MCP sessions are agent-authenticated). */
  agentGaii: string;
  /** Bare owner name derived from the session GAII. */
  owner: string;
  /** The owner's GHII (`owner@node`) — org records and memberships live at owner level. */
  ownerGhii: string;
  /** Runtime operator check (mirrors the core admin tools' self-gate). */
  isOperator(): Promise<boolean>;
}

/**
 * A declarative MCP tool contributed by the enterprise edition. `scope` plugs into the SAME
 * per-session scope gate as core tools (catalog/scopes.ts dynamic map); an omitted scope means
 * ungated (operator-only tools self-gate via session.isOperator instead, like core admin tools).
 * The handler's return value is JSON-serialized into the tool result; a thrown
 * { code?, statusCode?, message } becomes an isError result carrying the code.
 */
export interface EnterpriseMcpTool {
  name: string;
  description: string;
  scope?: string;
  annotations: {
    title: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  input?: Record<string, EnterpriseMcpToolField>;
  handler(args: Record<string, unknown>, session: EnterpriseMcpSession): Promise<unknown>;
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
