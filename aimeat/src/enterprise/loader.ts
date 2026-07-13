/**
 * @file aimeat/src/enterprise/loader.ts
 * @description Boot-time loader for the optional, proprietary AIMEAT Enterprise (`ee/`) module.
 *   Builds the {@link EnterpriseContext} (dependency injection) and tries to import a dropped-in
 *   `ee/index.js`. If found and valid, its `createEnterpriseProvider(ctx)` becomes the active
 *   provider; otherwise the open-core {@link stubEnterpriseProvider} is used. Core has NO compile-time
 *   dependency on the EE module — it is resolved at runtime by filesystem path.
 * @structure buildEnterpriseContext() · loadEnterpriseProvider()
 * @usage const provider = await loadEnterpriseProvider(buildEnterpriseContext(config, storage));
 * @version-history v0.1.0 — 2026-06-23 — initial enterprise loader (experiment skeleton)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';
import { settleMarketplaceFee, commerceFeePercent } from '../services/marketplace-fee.js';
import { logger } from '../utils/logger.js';
import { stubEnterpriseProvider, type EnterpriseContext, type EnterpriseProvider } from './provider.js';

/** Assemble the injected context handed to the EE module (or the stub). */
export function buildEnterpriseContext(config: AimeatConfig, storage: Storage): EnterpriseContext {
  return {
    config,
    storage,
    success,
    error,
    requireAuth,
    requireRole,
    resolveIdentity,
    buildGAII,
    invokeCapability: async (capability, input, callerGhii, jwt, mode) => {
      const { invokeCapability } = await import('../services/capability-invoke.js');
      // capability/input are typed loosely at the seam; the EE module passes the records it fetched.
      return invokeCapability(config, storage, capability as never, (input ?? {}) as Record<string, unknown>, callerGhii, jwt, mode);
    },
    settleMarketplaceFee: (args) => settleMarketplaceFee(storage, config, args),
    commerceFeePercent: () => commerceFeePercent(config),
    logger,
  };
}

/** Candidate paths for the dropped-in `ee/index.js`, in priority order. */
function eeCandidates(): string[] {
  const out: string[] = [];
  if (process.env.AIMEAT_EE_PATH) out.push(path.resolve(process.env.AIMEAT_EE_PATH));
  // Running from `aimeat/` (dev/build) → repo-root `ee/`; or directly from repo root.
  out.push(path.resolve(process.cwd(), '..', 'ee', 'index.js'));
  out.push(path.resolve(process.cwd(), 'ee', 'index.js'));
  return out;
}

/**
 * Load the active EnterpriseProvider. Returns the real EE provider when the proprietary module is
 * present and loads cleanly; otherwise the open-core stub. Never throws — a broken/absent EE module
 * degrades to the stub so the Community node always boots.
 */
export async function loadEnterpriseProvider(ctx: EnterpriseContext): Promise<EnterpriseProvider> {
  // Force Community mode even when an `ee/` module is present on disk (used by the open-core test
  // suite so it exercises the stub deterministically regardless of the local working tree).
  if (process.env.AIMEAT_EE_DISABLED === 'true' || process.env.AIMEAT_EE_DISABLED === '1') {
    ctx.logger.info('[enterprise] AIMEAT_EE_DISABLED set — Community edition (stub active)');
    return stubEnterpriseProvider(ctx);
  }
  for (const candidate of eeCandidates()) {
    if (!existsSync(candidate)) continue;
    try {
      const mod = await import(pathToFileURL(candidate).href);
      const factory = (mod.createEnterpriseProvider ?? mod.default) as
        | ((c: EnterpriseContext) => EnterpriseProvider | Promise<EnterpriseProvider>)
        | undefined;
      if (typeof factory !== 'function') {
        ctx.logger.error(`[enterprise] ${candidate} has no createEnterpriseProvider/default export — using stub`);
        continue;
      }
      const provider = await factory(ctx);
      ctx.logger.info(`[enterprise] loaded EE module "${provider.name}" v${provider.version} from ${candidate}`);
      return provider;
    } catch (err) {
      ctx.logger.error(`[enterprise] failed to load EE module at ${candidate}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ctx.logger.info('[enterprise] no ee/ module found — Community edition (stub active)');
  return stubEnterpriseProvider(ctx);
}
