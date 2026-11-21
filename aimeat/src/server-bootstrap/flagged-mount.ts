/**
 * @file src/server-bootstrap/flagged-mount.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A router behind a feature flag answers 503 FEATURE_DISABLED, with the setting's
 *   name, when the operator has switched the feature off. Before this, routes-loader.ts mounted
 *   such a router inside `if (config.xEnabled)`, so with the flag off there was no router and the
 *   caller got 404 NOT_FOUND from the fallthrough: a status page could not tell "switched off" from
 *   "no such route", and every refusal the router itself documented was dead code
 *   (first found on the realtime router, realtime-mount.ts). pnpm check:single-entry rule flag-mount
 *   refuses a new bare `if (config.xEnabled)` in the routes loaders.
 *
 *   WHY A STUB AND NOT THE ROUTER. The router is not built while its feature is off, because some
 *   factories start work of their own when built. What answers is a stub on the router's own path
 *   prefixes, registered by finish() AFTER every other router, so a route another router serves
 *   under the same prefix still answers as before, and only what would have been a 404 under that
 *   prefix becomes the 503.
 * @structure flaggedMounts(app, config) → { mount(feature, build), finish() } · FlaggedFeature ·
 *   featureDisabledHandler(config, feature)
 * @usage
 *   const flagged = flaggedMounts(app, config);
 *   flagged.mount({ on: config.cortexEnabled, setting: 'AIMEAT_CORTEX_ENABLED', feature: 'cortex extensions',
 *     paths: ['/v1/cortex'] }, () => cortexRouter(config, storage));
 *   … every other router …
 *   flagged.finish();
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial; retires docs/pitfalls.md §79. The eight flagged router mounts of
 *     routes-loader.ts move here.
 */
import type { Express, RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import { error } from '../middleware/envelope.js';
import { logger } from '../utils/logger.js';

export interface FlaggedFeature {
  /** Whether the feature is on for this node. */
  on: boolean;
  /** The environment setting that switches it, named in the refusal: `AIMEAT_CORTEX_ENABLED`. */
  setting: string;
  /** What the feature is, in words, for the refusal's sentence: `cortex extensions`. */
  feature: string;
  /** The path prefixes the router serves, answered with 503 while the feature is off. */
  paths: string[];
}

/** The answer for every request under a switched-off feature's paths. */
export function featureDisabledHandler(config: Pick<AimeatConfig, 'nodeId'>, f: Pick<FlaggedFeature, 'setting' | 'feature'>): RequestHandler {
  return (_req, res) => {
    res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED',
      `This node does not offer ${f.feature}: its operator has turned it off (${f.setting}). `
      + 'Ask the operator to turn it on, or use a node that offers it.',
      503, { setting: f.setting, feature: f.feature }));
  };
}

export interface FlaggedMounts {
  /** Mount the router now when the feature is on; otherwise keep its paths for finish(). */
  mount(f: FlaggedFeature, build: () => RequestHandler | RequestHandler[]): void;
  /** Register the 503 answer for every feature that is off. Called once, after every other router. */
  finish(): void;
}

export function flaggedMounts(app: Express, config: Pick<AimeatConfig, 'nodeId'>): FlaggedMounts {
  const off: FlaggedFeature[] = [];
  let finished = false;
  return {
    mount(f, build) {
      if (f.on) {
        const handlers = build();
        app.use(...(Array.isArray(handlers) ? handlers : [handlers]));
        return;
      }
      off.push(f);
    },
    finish() {
      if (finished) return;
      finished = true;
      for (const f of off) {
        app.use(f.paths, featureDisabledHandler(config, f));
        logger.info(`Feature off: ${f.feature} (${f.setting}); its routes answer 503 FEATURE_DISABLED`);
      }
    },
  };
}
