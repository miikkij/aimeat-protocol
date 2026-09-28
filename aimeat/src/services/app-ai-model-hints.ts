/**
 * @file app-ai-model-hints.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish hint for a model an app declares (`models=` in its aimeat-ai meta) that
 *   the model catalogue does not know (System 2 plan, V5; docs/internal/llmproviderintegrations/13
 *   section 4). A hint, never a refusal.
 *
 *   ITS OWN FILE, CALLED BY THE PUBLISH. storage/types/apps.ts imports app-ai-posture.ts for its type,
 *   and the catalogue store imports the storage, so a catalogue read inside the posture's own import
 *   graph (app-ai-posture.ts, app-ai-capability-hints.ts) closes an import cycle. app-publish.ts adds
 *   this hint after the posture check instead.
 * @structure unknownModelHints(models)
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */
import { catalogModel } from './ai/catalog/store.js';
import { parseModelRef } from './ai/policy.js';

export function unknownModelHints(models: string[] | undefined): string[] {
  const unknown = (models ?? []).filter((ref) => {
    const p = parseModelRef(ref);
    return p.type && p.type !== 'local' && p.type !== 'openai-compatible' && !catalogModel(p.type, p.id);
  });
  if (!unknown.length) return [];
  return [
    `The aimeat-ai meta names ${unknown.length === 1 ? 'a model' : 'models'} this node's catalogue does not know: ${unknown.join(', ')}. `
    + 'Check the id with aimeat_ai_models (or GET /v1/ai/models) and use the `ref` it lists.',
  ];
}
