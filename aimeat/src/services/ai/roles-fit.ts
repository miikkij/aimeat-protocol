/**
 * @file roles-fit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Does an owner's role meet what an app's role says it needs (brief-tekoalyn-roolit: "the
 *   app describes the need, and the model catalogue compares the properties")? Two questions: does the
 *   role have a provider for every capability the app's role needs, and does each of its models have
 *   the context the app's role asks for. A model the catalogue does not know is given the benefit of
 *   the doubt, as the owner chose it.
 *
 *   Used where the owner binds (a missing capability refuses the binding), on the AI page (a model too
 *   small is shown), and in the call (such a model is passed over, services/ai/route-plan.ts).
 * @structure roleFit · contextOf
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { catalogModel } from './catalog/store.js';
import type { AiCapability } from './types.js';
import type { AiProvider } from './providers.js';
import type { OwnerRole } from './roles.js';
import type { AppAiRole } from '../app-ai-roles.js';

/** The catalogue's context for a model of a provider type, or undefined when it does not say. */
export function contextOf(type: string, model: string): number | undefined {
  return catalogModel(type, model)?.limits?.context;
}

export interface RoleFit {
  /** The capabilities the app's role needs that the owner's role has no provider for. */
  missing: AiCapability[];
  /** The role's models whose context is smaller than the app's role needs. */
  small: Array<{ capability: AiCapability; provider: string; model: string; context: number }>;
}

/** How well an owner's role meets an app's role's need. Empty lists: it fits. */
export function roleFit(need: AppAiRole, role: OwnerRole, providers: readonly AiProvider[]): RoleFit {
  const missing = need.capabilities.filter((c) => !role.capabilities[c]?.length);
  const small: RoleFit['small'] = [];
  if (need.context) {
    for (const c of need.capabilities) {
      for (const e of role.capabilities[c] ?? []) {
        const p = providers.find((q) => q.id === e.provider);
        const model = e.model ?? p?.capabilities[c]?.model;
        if (!p || !model) continue;
        const context = contextOf(p.type, model);
        if (context !== undefined && context < need.context) small.push({ capability: c, provider: p.id, model, context });
      }
    }
  }
  return { missing, small };
}
