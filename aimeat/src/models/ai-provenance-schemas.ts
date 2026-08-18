/**
 * @file src/models/ai-provenance-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The frozen `aimeat.provenance/v1` record — AIMEAT's CANONICAL statement about how much
 *   of a piece of content a model wrote, and how much a person did. It is the stored form; every
 *   external vocabulary (IPTC digitalSourceType, the W3C `ai-disclosure` attribute, the IETF
 *   `AI-Disclosure` header, the EU icons, a C2PA assertion) is DERIVED from it by a pure adapter in
 *   services/ai-provenance-adapters.ts and never stored. The record is canonical because none of
 *   those vocabularies can express `humanInvolvement` separately from `level`, and that separation
 *   is exactly what decides whether a visible label is owed under Art. 50(4).
 *
 *   CASING. This is a self-describing document carrying its own `spec`, not a route DTO — so it
 *   keeps ONE spelling, camelCase, on every carrier it travels on (memory records, markdown
 *   frontmatter, a C2PA assertion, MCP results, `/v1/provenance/:id`, the published JSON Schema).
 *   That is the same treatment ODPS `ProvenanceSchema` already gets. Route DTOs elsewhere stay
 *   snake_case-on-the-wire; these are different kinds of thing, not an inconsistency. The one
 *   snake_case survivor is the MCP PARAMETER name `ai_provenance`, whose VALUE is this document.
 *
 *   VERSIONING PROMISE. Readers MUST branch on `spec` and MUST NOT assume fields. A `v2` may add
 *   fields freely; removing or re-meaning one means a new version and a documented mapping. An
 *   UNKNOWN `spec` reads as `unstated` — never an error, and never "a human wrote it". Use
 *   asKnownProvenance() for that: absence is not falsity.
 * @structure
 *   - AI_PROVENANCE_SPEC_V1 — the spec string readers branch on
 *   - AI_PROVENANCE_LEVELS / _METHODS / AI_HUMAN_INVOLVEMENT / AI_UPSTREAM_MARKS / AI_STAMPED_BY /
 *     AI_DISCLOSURE_REASONS — the frozen enums, exported as const arrays so downstream code never
 *     re-types the strings (same pattern as ODPS_SLA_DIMENSIONS in odps-schemas.ts)
 *   - AiProvenanceSchema (+ the nested source/generator/attestation/disclosure schemas) and the
 *     inferred types
 *   - asKnownProvenance(value) — the unknown-spec gate every consumer goes through
 * @usage
 *   import { AiProvenanceSchema, asKnownProvenance } from '../models/ai-provenance-schemas.js';
 *   const parsed = AiProvenanceSchema.safeParse(req.body.provenance);
 * @version-history
 *   v1.3.0 — 2026-08-02 — AI_DISCLOSURE_REASONS gains `art50_4_precautionary`: labelled because
 *     nobody established whether the limb applies, as distinct from `policy` (the law exempted
 *     it and the operator labelled anyway). Additive within v1, which the versioning promise above
 *     permits — a reader that does not know the value still branches correctly on `spec`.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 3. `disclosure.strength` added as an OPTIONAL member —
 *     additive within v1, which the versioning promise permits (a v2 is owed only for a removal or
 *     a re-meaning). It closes a Phase 1 gap rather than changing anything: the block pre-rendered
 *     two of the three members disclosureFor() returns, and the label component needs the third to
 *     know whether to render the long statement or the short chip.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. `humanInvolvement` doc comment states what it measures
 *     (review of the MODEL's contribution, not authorship), which is what makes `assisted` + `none`
 *     readable rather than contradictory.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1. The vocabulary frozen in
 *     docs/internal/EUAct/22-frozen-vocabulary.md Part B. `level` is the SINGLE definition of the
 *     four synthesis levels: src/schemas/knowledge-package.ts and
 *     src/storage/types/organisms-federation.ts now both reference AI_PROVENANCE_LEVELS instead of
 *     spelling the strings a second and third time.
 */
import { z } from 'zod';

/** The spec identifier readers branch on. Frozen; a new shape means a new string. */
export const AI_PROVENANCE_SPEC_V1 = 'aimeat.provenance/v1';

/**
 * WHAT the content is. The vocabulary AIMEAT already used for knowledge packages — reused verbatim
 * rather than reinvented, and now defined here ONCE for the whole platform.
 *
 * - `original`      a human wrote it; no model involved
 * - `assisted`      a human wrote it; a model edited, refined or filled in
 * - `synthesized`   a model combined real sources into new content, at someone's direction
 * - `ai-generated`  a model produced it
 */
export const AI_PROVENANCE_LEVELS = ['original', 'assisted', 'synthesized', 'ai-generated'] as const;
export type AiProvenanceLevel = (typeof AI_PROVENANCE_LEVELS)[number];

/** Optional detail under `level`. Frozen so adapters and validators can rely on it. */
export const AI_PROVENANCE_METHODS = [
  'human', 'rewritten', 'summarized', 'translated', 'synthesized', 'fully-generated', 'multi-agent',
] as const;
export type AiProvenanceMethod = (typeof AI_PROVENANCE_METHODS)[number];

/**
 * The field that decides whether a visible label is owed.
 *
 * IT DESCRIBES REVIEW OF THE MODEL'S CONTRIBUTION, NOT AUTHORSHIP. That is why `assisted` + `none`
 * is not a contradiction: it means a human wrote it, a model edited it, and nobody checked what the
 * model did. Read the two fields together — `level` says how much of the content a model touched,
 * this field says whether a person then examined what the model produced.
 *
 * ONLY A STEP WHERE A PERSON READS THE SUBSTANCE AND CAN REJECT IT UPGRADES THIS FIELD.
 * Clicking publish is not that step. The 20 July 2026 Guidelines are explicit that superficial
 * checks — spelling, formatting, a skim — do NOT count as review, which is why `light-review` sits
 * on the labelled side of the line and not the exempt one.
 *
 * - `none`               nobody read the substance before publication            → labels
 * - `light-review`       someone glanced; spelling, formatting, a skim           → labels
 * - `editorial-control`  a person examined the substance and can approve, alter
 *                        or reject it, and a named person holds editorial
 *                        responsibility                                          → no 50(4) duty
 * - `full-human`         a person authored or rewrote it                         → no duty
 */
export const AI_HUMAN_INVOLVEMENT = ['none', 'light-review', 'editorial-control', 'full-human'] as const;
export type AiHumanInvolvement = (typeof AI_HUMAN_INVOLVEMENT)[number];

/** Does the model vendor mark its own output? A downstream provider may rely on an upstream mark
 *  while staying responsible for it, so the answer is worth carrying. Never guessed: `unknown`. */
export const AI_UPSTREAM_MARKS = ['yes', 'no', 'unknown'] as const;
export type AiUpstreamMarks = (typeof AI_UPSTREAM_MARKS)[number];

/** Who asserted the record. `node` = this node witnessed the generation; `principal` = a caller
 *  declared it for content produced elsewhere. Both are kept and stay distinguishable. */
export const AI_STAMPED_BY = ['node', 'principal'] as const;
export type AiStampedBy = (typeof AI_STAMPED_BY)[number];

/** Why a visible disclosure is (or is not) owed. Computed by disclosureFor(), never hand-written. */
export const AI_DISCLOSURE_REASONS = [
  'art50_1_interaction',        // a person is in a two-way exchange with a model
  'art50_2_synthetic_output',   // this node/app provides the generating system
  'art50_4_deepfake',
  'art50_4_public_interest',    // the content IS stated to inform the public on matters of public interest
  // Nobody said whether it is. Decision D4 labels anyway — over-labelling is the safe direction —
  // but the RECORD must not borrow a statutory basis to justify a precaution. Distinct from
  // `policy`, which means the law positively exempted this and the operator labelled regardless:
  // there the applicability was decided, here it was never established. Collapsing the two would
  // trade one overclaim for its mirror image.
  'art50_4_precautionary',
  'policy',                     // stricter than the law, by node policy
  'none',
] as const;
export type AiDisclosureReason = (typeof AI_DISCLOSURE_REASONS)[number];

// ── Field primitives ────────────────────────────────────────────────────────────────────────────

const shortText = z.string().trim().min(1).max(400);
const mediumText = z.string().trim().min(1).max(1_000);

/** ISO 8601 instant. Stored in UTC (`Z`); an offset is accepted and normalised by the minter. */
const isoInstant = z.string().trim().max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO 8601 date-time')
  .meta({ format: 'date-time' });

/**
 * Human-readable text with `en` required and any further locale allowed alongside it. Open by
 * design: the Finnish string is a compliance string, and a self-hoster elsewhere needs their own
 * without a schema change (never hardcode "AI-generated" as English text — 19-future-proofing §5).
 */
const LocalizedTextSchema = z.object({ en: mediumText }).catchall(mediumText);
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

/** SHA-256 identity of the exact bytes the statement is about. `sha256:` prefixed, lower-case hex. */
export const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const contentHash = z.string().trim().regex(CONTENT_HASH_PATTERN, 'contentHash must be `sha256:<64 lower-case hex>`');

// ── Nested blocks ───────────────────────────────────────────────────────────────────────────────

/** WHERE the material came from. The honest thing for synthesized content. */
/**
 * A source address, SCHEME-CHECKED — because `.url()` is not.
 *
 * Zod's `.url()` validates that a string PARSES as a URL, and `javascript:alert(1)`,
 * `JaVaScRiPt:alert(1)` and `data:text/html,<script>…</script>` all parse. A source is a place a
 * reader can go and look; the two web schemes are the whole of that, and anything else in this
 * field is either a mistake or an attempt to put script where a reader will click it.
 *
 * Exported so the MCP declaration boundary uses the SAME rule (mcp/ai-provenance-input.ts). Without
 * that, the door accepted the value and the mint threw — a clean refusal beats a 500 that says
 * "refusing to mint an invalid record" to somebody publishing an app.
 *
 * This closes the door for NEW records only. Records minted before it exist, which is why the
 * readable page allowlists the scheme AGAIN at render time (services/ai-provenance-page.ts
 * safeHref): that is the half that reaches what is already stored.
 */
export const AiSourceUrlSchema = z.string().trim().url().max(2_000).refine(
  (u) => URL.canParse(u) && ['http:', 'https:'].includes(new URL(u).protocol),
  { message: 'url must be http or https' },
);

export const AiProvenanceSourceSchema = z.object({
  url: AiSourceUrlSchema,
  title: shortText.optional(),
  retrievedAt: isoInstant.optional(),
  role: shortText.optional(),
});

/**
 * WHO produced it. Every field optional so a caller can always produce a valid record — but the
 * node's own minting is MAXIMAL: at the chokepoint it already knows the model, the provider, the
 * principal, the node id and the timestamp, so it never omits them. A thin record is a record that
 * cannot answer a question later.
 */
export const AiProvenanceGeneratorSchema = z.object({
  /** GAII / GEAI / GHII of the principal the generation ran for. */
  principal: shortText.optional(),
  /** Model id as reported by the provider. */
  model: shortText.optional(),
  provider: shortText.optional(),
  nodeId: shortText.optional(),
  /** The job, crew or app that orchestrated it. */
  pipeline: shortText.optional(),
  upstreamMarks: z.enum(AI_UPSTREAM_MARKS).optional(),
});

/** AIMEAT's own attestation — an attributable assertion by a known principal, not a proof. */
export const AiProvenanceAttestationSchema = z.object({
  stampedBy: z.enum(AI_STAMPED_BY).optional(),
  /** true only when THIS node witnessed the generation. A receiving node never re-stamps it. */
  observed: z.boolean().optional(),
  contentHash: contentHash.optional(),
  recordUrl: z.string().trim().url().max(2_000).optional(),
});

/** How loud the visible label is. `full` states the substance, `light` is present but not intrusive
 *  (creative works, `assisted` content, and anything labelled by node policy rather than by law). */
export const AI_DISCLOSURE_STRENGTHS = ['full', 'light', 'none'] as const;
export type AiDisclosureStrength = (typeof AI_DISCLOSURE_STRENGTHS)[number];

/**
 * Pre-rendered disclosure so every face shows the same words. Computed; never hand-written.
 *
 * `strength` is OPTIONAL for one reason only: Phase 1 shipped this block carrying two of the three
 * members of the decision disclosureFor() returns, and a record minted before Phase 3 has no value
 * for it. A reader that finds it absent should render the label rather than guess a strength — the
 * obligation is in `required`, and `strength` only says how loudly to say it.
 */
export const AiDisclosureBlockSchema = z.object({
  required: z.boolean(),
  reason: z.enum(AI_DISCLOSURE_REASONS),
  strength: z.enum(AI_DISCLOSURE_STRENGTHS).optional(),
  short: LocalizedTextSchema,
  long: LocalizedTextSchema.optional(),
});

// ── The record ──────────────────────────────────────────────────────────────────────────────────

/**
 * `aimeat.provenance/v1`. Four required fields — `spec`, `level`, `humanInvolvement`,
 * `generatedAt` — so a caller can always produce a valid record and the validator reports
 * completeness the way the ODPS validator already does for listings.
 *
 * DELIBERATELY ABSENT: prompt text (privacy- and business-sensitive, and it would make records
 * unpublishable — debugging lives in the ledger), cost (the ledger's job; joined by provenanceId),
 * and any external vocabulary value (produced by an adapter, never stored).
 */
export const AiProvenanceSchema = z.object({
  spec: z.literal(AI_PROVENANCE_SPEC_V1),
  level: z.enum(AI_PROVENANCE_LEVELS),
  method: z.enum(AI_PROVENANCE_METHODS).optional(),
  humanInvolvement: z.enum(AI_HUMAN_INVOLVEMENT),
  generatedAt: isoInstant,

  generator: AiProvenanceGeneratorSchema.optional(),
  sources: z.array(AiProvenanceSourceSchema).max(100).optional(),
  /** Upstream AIMEAT refs this was built from, e.g. `memory:owner@node/key@3`. */
  derivedFrom: z.array(shortText).max(100).optional(),

  attestation: AiProvenanceAttestationSchema.optional(),
  disclosure: AiDisclosureBlockSchema.optional(),

  notes: z.string().trim().max(1_000).optional(),
});

export type AiProvenance = z.infer<typeof AiProvenanceSchema>;
export type AiProvenanceGenerator = z.infer<typeof AiProvenanceGeneratorSchema>;
export type AiProvenanceAttestation = z.infer<typeof AiProvenanceAttestationSchema>;
export type AiProvenanceSource = z.infer<typeof AiProvenanceSourceSchema>;
export type AiDisclosureBlock = z.infer<typeof AiDisclosureBlockSchema>;

/**
 * Anything a consumer might be handed where a provenance record is expected: a valid record, a
 * record in a spec we do not know, a malformed object, or nothing at all.
 */
export type MaybeAiProvenance = unknown;

/**
 * The unknown-spec gate. Returns the record ONLY when it declares a spec we understand and parses;
 * otherwise `null`, which every consumer must read as **unstated** — not as an error, and not as
 * "a human wrote it". This is the single most consequential default in the whole design, so it
 * lives in one function rather than in a condition repeated at each call site.
 */
export function asKnownProvenance(value: MaybeAiProvenance): AiProvenance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if ((value as { spec?: unknown }).spec !== AI_PROVENANCE_SPEC_V1) return null;
  const parsed = AiProvenanceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The path the published JSON Schema is served from. Versioned, so it never mutates under a
 *  consumer: a `v2` gets its own URL and this one keeps meaning what it means today. */
export const AI_PROVENANCE_SCHEMA_PATH = '/v1/schemas/ai-provenance/v1.json';

/**
 * The published JSON Schema for `aimeat.provenance/v1`, DERIVED from the Zod schema above rather
 * than hand-written beside it — zod v4 ships `toJSONSchema()`, so there is no second definition to
 * drift and no dependency to add.
 *
 * Note what is deliberately absent: `additionalProperties: false`. Readers must branch on `spec` and
 * must not assume fields, and a `v2` may add fields freely — a schema that rejected unknown keys
 * would turn that promise into a breaking change for every validator pinned to v1.
 */
export function aiProvenanceJsonSchema(baseUrl: string): Record<string, unknown> {
  return {
    ...z.toJSONSchema(AiProvenanceSchema, { io: 'input' }),
    $id: `${baseUrl.replace(/\/+$/, '')}${AI_PROVENANCE_SCHEMA_PATH}`,
    title: 'AIMEAT AI provenance record, v1',
    description:
      'How much of a piece of content a model produced, and how much a person did. `level` and '
      + '`humanInvolvement` are independent on purpose: no external vocabulary can express them '
      + 'separately, and that separation is what decides whether a visible label is owed under '
      + 'Article 50(4) of the EU AI Act. An absent or unknown-`spec` record reads as UNSTATED — '
      + 'never as an error, and never as "a human wrote it".',
  };
}
