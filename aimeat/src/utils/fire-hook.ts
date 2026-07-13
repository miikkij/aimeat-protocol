/**
 * @file src/utils/fire-hook.ts
 * @description Fire-and-forget wrapper around the hooks service — runs hook handlers for an event
 *   asynchronously without blocking the caller, logging (rather than throwing) any failure.
 *
 * @structure
 *   - fireHook(config, storage, event, payload): invokes executeHooks() and catches/logs errors
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AimeatConfig, HookName } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { executeHooks } from '../services/hooks.js';
import type { HookContext } from '../services/hooks.js';
import { logger } from './logger.js';

/**
 * Fire a hook asynchronously without blocking the caller.
 * Logs failures instead of swallowing them silently.
 */
export function fireHook(
  config: AimeatConfig,
  storage: Storage,
  event: HookName,
  payload: HookContext,
): void {
  executeHooks(config, storage, event, payload).catch(err => {
    logger.warn(`Hook "${event}" failed: ${(err as Error).message ?? err}`);
  });
}
