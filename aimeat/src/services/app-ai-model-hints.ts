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
 *
 *   provenanceModelFindings is the other model hint of a publish: a declaration that says a model made
 *   the app and not which one.
 * @structure unknownModelHints(models) · provenanceModelFindings(declared)
 * @version-history
 *   v1.1.0 — 2026-10-18 — provenanceModelFindings moved here from app-publish.ts by pure extraction
 *     (that file is at the line ceiling).
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */
import { catalogModel } from './ai/catalog/store.js';
import { parseModelRef } from './ai/policy.js';
import { declarationLacksModel, type DeclaredProvenance } from './ai-provenance.js';
import type { AppArtifactFinding } from './app-artifact-lint.js';

/** The hint a declaration earns when it says a model made the app and not which model. */
export function provenanceModelFindings(declared: DeclaredProvenance | undefined): AppArtifactFinding[] {
  if (!declarationLacksModel(declared)) return [];
  const served = declared?.provider ? `, only who served it ("${declared.provider}")` : '';
  return [{
    pitfall: 'provenance-without-model',
    severity: 'warn',
    message: `The ai_provenance you declared says a model made this app and does not name the model. The public record shows no model${served}. `
      + 'On the next publish, set ai_provenance.model to your own model id as your provider names it, for example "openai/gpt-6" or "anthropic/claude-opus-5". '
      + 'Take it from your own configuration; do not ask the person.',
    url: '/v1/appdev/pitfalls/provenance-without-model',
  }];
}

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
