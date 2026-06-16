/**
 * @file ecosystem-manifest.ts
 * @description The ecosystem-app (GEAI) manifest schema + the STATIC compatibility-validation checks
 *   run at hello time (connector profile §5.1 step 4). An app declares its app name/origin, the scopes
 *   it requests, and the capabilities + events it provides/consumes; AIMEAT validates the manifest is
 *   well-formed, the app name is valid, it matches the hello app, and the requested scopes stay within
 *   the node's `maxEcoScopes` ceiling. The DYNAMIC handler-probing harness (driving each declared
 *   handler over an uncredentialed tunnel) is deferred — this is the static, owner-facing gate.
 * @structure EcoManifestSchema · validateEcoManifest(app, requestedScopes, manifest, maxEcoScopes)
 * @usage import { validateEcoManifest, EcoManifestSchema } from '../models/ecosystem-manifest.js';
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for the connector-profile static-validation slice (chunk 4).
 *   v1.1.0 — 2026-06-15 — Accept an optional `automation` hint (schedulable capabilities + sink)
 *     for the eco-capability scheduler. Not required; purely a hint.
 *   v1.2.0 — 2026-06-15 — Accept `automation.schedulable[].produces_key` (deposit key prefix) so the
 *     node can derive the automation-recipe trigger keyGlob correctly.
 *   v1.3.0 — 2026-06-16 — Accept an optional top-level `setup: { fi, en }` — the app's OWN bilingual
 *     Markdown setup guide (what's needed, why, where, including required agents), rendered to the
 *     owner in the Ecosystem-apps card. The app owns this guidance; the node only stores + returns it.
 */
import { z } from 'zod';
import { validateAppName } from '../utils/gaii.js';

export const EcoManifestSchema = z.object({
  app: z.string().min(1).max(100),
  origin: z.string().max(300).optional(),
  scopes: z.array(z.string().max(120)).max(50).optional(),
  capabilities: z.array(z.object({
    id: z.string().min(1).max(120),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  })).max(100).optional(),
  events: z.object({
    emits: z.array(z.string().max(120)).max(100).optional(),
    subscribes: z.array(z.string().max(120)).max(100).optional(),
  }).optional(),
  // Optional automation hints: which capabilities are schedulable (+ cadences) and an advisory sink.
  // A HINT only — never required for an owner to schedule an eco-capability job.
  automation: z.object({
    schedulable: z.array(z.object({
      id: z.string().min(1).max(120),
      produces: z.string().max(200).optional(),
      // The deposit KEY PREFIX this capability writes to (e.g. `feedback.stats`), used to derive the
      // automation-recipe trigger keyGlob. Distinct from `produces` (a SCHEMA ref, e.g. `feedback-stats@1`).
      produces_key: z.string().max(200).optional(),
      cadences: z.array(z.string().max(120)).max(20).optional(),
    })).max(100).optional(),
    advisory_sink: z.string().max(200).optional(),
  }).optional(),
  // The app's OWN bilingual Markdown setup guide for the owner (what's needed, why, where, including
  // required agents). Optional + back-compat: an app that omits it gets the in-portal fallback note.
  setup: z.object({
    fi: z.string().max(20000),
    en: z.string().max(20000),
  }).optional(),
});
export type EcoManifest = z.infer<typeof EcoManifestSchema>;

export interface EcoValidationResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
  validatedAt: string;
}

/** True iff every requested scope is within the node's ceiling (mirrors the agent scope-ceiling check). */
function scopesWithinCeiling(requested: string[], ceiling: string[]): boolean {
  if (ceiling.includes('*')) return true;
  return requested.every((s) => {
    if (s === '*') return false;
    const [domain] = s.split(':');
    return ceiling.includes(s) || ceiling.includes(`${domain}:*`);
  });
}

/**
 * Static validation of an ecosystem app's manifest against the request + node policy. Returns a
 * per-check report; `ok` is true only when every check passes. Run at hello time.
 */
export function validateEcoManifest(
  app: string, requestedScopes: string[], manifest: unknown, maxEcoScopes: string[],
): EcoValidationResult {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const validatedAt = new Date().toISOString();

  // 1. Manifest is well-formed against the contract schema.
  const parsed = EcoManifestSchema.safeParse(manifest);
  checks.push({ name: 'manifest_schema', ok: parsed.success, detail: parsed.success ? undefined : parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
  if (!parsed.success) return { ok: false, checks, validatedAt };
  const m = parsed.data;

  // 2. App name is valid and matches the hello app (no GAII/eco collision; the id is coherent).
  const nameErr = validateAppName(m.app);
  checks.push({ name: 'app_name_valid', ok: !nameErr, detail: nameErr ?? undefined });
  checks.push({ name: 'app_matches_request', ok: m.app === app, detail: m.app === app ? undefined : `manifest app "${m.app}" != request app "${app}"` });

  // 3. Declared scopes ⊆ requested scopes ⊆ node ceiling.
  const declared = m.scopes ?? [];
  const declaredSubsetRequested = declared.every(s => requestedScopes.includes(s));
  checks.push({ name: 'declared_scopes_subset_requested', ok: declaredSubsetRequested, detail: declaredSubsetRequested ? undefined : 'manifest declares scopes not in the request' });
  const withinCeiling = scopesWithinCeiling(requestedScopes, maxEcoScopes);
  checks.push({ name: 'scopes_within_ceiling', ok: withinCeiling, detail: withinCeiling ? undefined : 'requested scopes exceed the node maximum' });

  // 4. Declared capabilities have unique ids.
  const capIds = (m.capabilities ?? []).map(c => c.id);
  const uniqueCaps = new Set(capIds).size === capIds.length;
  checks.push({ name: 'capability_ids_unique', ok: uniqueCaps, detail: uniqueCaps ? undefined : 'duplicate capability ids' });

  return { ok: checks.every(c => c.ok), checks, validatedAt };
}
