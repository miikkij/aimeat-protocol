/**
 * @file src/server-bootstrap/routes-loader-ai.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The System 2 AI routers, mounted in the order routes-loader.ts always mounted them.
 *   A pure move out of routes-loader.ts (max-file-lines): the one call there stands where the four
 *   mounts stood, so what matches first is unchanged.
 * @structure mountAiRouters(app, config, storage)
 * @version-history
 *   v1.3.0 — 2026-09-28 — aiRolesRouter: the owner's AI roles and the bindings of apps' roles.
 *   v1.2.0 — 2026-09-28 — aiCapabilitiesRouter: capabilities and embeddings (System 2 plan, V5).
 *   v1.1.0 — 2026-09-28 — aiModelsRouter: the model catalogue (System 2 plan, V4).
 *   v1.0.0 — 2026-09-28 — Moved from routes-loader.ts, unchanged.
 */
import type express from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { openrouterRouter } from '../routes/openrouter.js';
import { aiRouter } from '../routes/ai.js';
import { aiPolicyRouter } from '../routes/ai-policy.js';
import { aiProvidersRouter } from '../routes/ai-providers.js';
import { aiModelsRouter } from '../routes/ai-models.js';
import { aiCapabilitiesRouter } from '../routes/ai-capabilities.js';
import { aiRolesRouter } from '../routes/ai-roles.js';

export function mountAiRouters(app: express.Express, config: AimeatConfig, storage: Storage): void {
  app.use(openrouterRouter(config, storage));   // OpenRouter AI autopilot
  app.use(aiRouter(config, storage));            // App-level AI completion (user's key, budget-gated)
  app.use(aiPolicyRouter(config, storage));      // The owner's model policy and the node's recommended models
  app.use(aiProvidersRouter(config, storage));   // The owner's AI providers and routing (System 2 V3)
  app.use(aiModelsRouter(config, storage));      // The model catalogue (System 2 V4)
  app.use(aiCapabilitiesRouter(config, storage)); // What the caller can do, and embeddings (System 2 V5)
  app.use(aiRolesRouter(config, storage));       // The owner's AI roles and the bindings of apps' roles
}
