/**
 * @file src/services/ai-provenance.ts
 * @description THE mint path for AI provenance records (TARGET-058). Everything that produces or
 *   accepts a statement about how content was made goes through mintProvenance() — there is
 *   deliberately no second way to write one, because a second way is how two subtly different
 *   record shapes come to exist.
 *
 *   HARD TO CALL WRONGLY, BY CONSTRUCTION. The caller supplies only what it OBSERVED; the service
 *   fills `spec`, `generatedAt`, `contentHash`, `attestation` and `disclosure` itself. In
 *   particular `attestation.observed` is DERIVED from `stampedBy` and is not a parameter: a caller
 *   declaring provenance for content produced somewhere else cannot claim this node witnessed it.
 *   That is the whole point of keeping the two apart.
 *
 *   MINTING IS MAXIMAL, UNCONDITIONALLY. At the chokepoint the node already knows the model, the
 *   provider, the principal, the node id, the timestamp and the content hash, so it never omits
 *   them and no configuration can make it store less. A thin record is a record that cannot answer
 *   a question later. What configuration governs is what is SERVED — see projectForDetail().
 *
 *   THE CONTENT HASH IS THE JOIN KEY. A third party can ask about bytes they hold without us ever
 *   having given them an identifier; the database id is a convenience, not the identity.
 *
 *   NOT IN THE RECORD, ON PURPOSE: prompt text (privacy- and business-sensitive, and it would make
 *   records unpublishable — debugging lives in the ledger) and cost (the ledger's job, joined by
 *   provenanceId).
 * @structure
 *   - contentHashOf(bytes)            — `sha256:<hex>`, node:crypto, no dependency
 *   - mintProvenance(storage, …)      — build + validate + persist, returns the stored row
 *   - buildDisclosure(...)            — the pre-rendered disclosure block, from disclosureFor() + i18n
 *   - projectForDetail(record, detail)— what a PUBLIC surface serves under AIMEAT_AI_PROVENANCE_DETAIL
 * @usage
 *   import { mintProvenance, contentHashOf } from './ai-provenance.js';
 *   const row = await mintProvenance(storage, { stampedBy: 'node', ... , content });
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import {
  AI_PROVENANCE_SPEC_V1, AiProvenanceSchema,
  type AiProvenance, type AiProvenanceLevel, type AiProvenanceMethod, type AiHumanInvolvement,
  type AiStampedBy, type AiProvenanceGenerator, type AiProvenanceSource, type AiDisclosureBlock,
  type LocalizedText,
} from '../models/ai-provenance-schemas.js';
import { disclosureFor, type SurfaceContext } from './ai-disclosure.js';
import { createT, LOCALES } from '../i18n.js';

/** What a caller may state. Everything the node can work out itself is deliberately absent. */
export interface MintProvenanceInput {
  /**
   * `node` = THIS node witnessed the generation. `principal` = a caller is declaring provenance for
   * content produced elsewhere. `attestation.observed` follows from this and cannot be set directly.
   */
  stampedBy: AiStampedBy;
  /** Whose account this belongs to (a GHII). The authorization key for a private resolve. */
  ownerGhii: string;
  /** The principal the generation ran for, or that is declaring it: GHII | GAII | GEAI. */
  principal: string;

  level: AiProvenanceLevel;
  humanInvolvement: AiHumanInvolvement;
  method?: AiProvenanceMethod;

  /** The exact bytes, hashed here. Supply this OR `contentHash`; `content` wins if both are given. */
  content?: string | Uint8Array;
  /** A pre-computed `sha256:<64 lower-case hex>`, for a declarer that holds the bytes and we do not. */
  contentHash?: string;

  /** Model / provider / pipeline / upstream marking. `nodeId` and `principal` are filled here. */
  generator?: Omit<AiProvenanceGenerator, 'principal' | 'nodeId'> & { nodeId?: string };
  sources?: AiProvenanceSource[];
  derivedFrom?: string[];
  notes?: string;

  /** `public` ONLY when the content this describes is itself public. Defaults to `private`. */
  visibility?: 'public' | 'private';
  /** When the content was generated. Defaults to now; a declarer may state an earlier time. */
  generatedAt?: string;
  /** The surface it will be served on, so the disclosure block can be pre-rendered. */
  surface?: SurfaceContext;
  /** This node's id, stamped into `generator.nodeId`. */
  nodeId: string;
  /** The node's public base URL, so `attestation.recordUrl` resolves for a third party. */
  baseUrl?: string;
}

/** SHA-256 identity of the exact bytes, `sha256:` prefixed. node:crypto — no dependency. */
export function contentHashOf(bytes: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * The default surface assumed when a caller does not describe one: a private item with a person
 * potentially reading it. Chosen so that forgetting to pass a surface UNDER-claims rather than
 * over-claims — a record that says "no label required" on a surface that in fact owes one is
 * caught when the surface renders and computes its own decision, whereas a record asserting a
 * label was required where it was not would be a false statement we published.
 */
const DEFAULT_SURFACE: SurfaceContext = { visibility: 'private', humanAudience: true };

/** Pull one localized string across every locale the node ships, so the record travels translated. */
function localized(key: string, vars?: Record<string, string>): LocalizedText {
  const out: Record<string, string> = {};
  for (const loc of LOCALES) out[loc] = createT(loc)(key, vars);
  return out as LocalizedText;
}

/**
 * The pre-rendered disclosure block, so every face — HTML, markdown, MCP, a header — shows the same
 * words without each one re-deriving them. `required`/`reason` come from disclosureFor(); the text
 * comes from the `aiLabel.*` i18n keys, never from a string literal in this file (a self-hoster
 * elsewhere needs their own language, and the Finnish string is a compliance string).
 */
export function buildDisclosure(record: AiProvenance, ctx: SurfaceContext): AiDisclosureBlock {
  const decision = disclosureFor(record, ctx);

  let shortKey: string;
  let longKey: string;
  if (decision.reason === 'art50_1_interaction') {
    shortKey = 'aiLabel.short'; longKey = 'aiLabel.chat';
  } else if (record.level === 'original') {
    shortKey = 'aiLabel.original'; longKey = 'aiLabel.originalLong';
  } else if (record.level === 'assisted') {
    shortKey = 'aiLabel.assisted'; longKey = 'aiLabel.assistedLong';
  } else if (record.humanInvolvement === 'editorial-control' || record.humanInvolvement === 'full-human') {
    shortKey = 'aiLabel.short'; longKey = 'aiLabel.reviewedGeneric';
  } else {
    shortKey = 'aiLabel.short'; longKey = 'aiLabel.publicText';
  }

  return {
    required: decision.required,
    reason: decision.reason,
    short: localized(shortKey),
    long: localized(longKey),
  };
}

/**
 * Mint one provenance record and persist it. Returns the stored row, whose `record` is the exact
 * document that will be served.
 *
 * Throws on a record that does not satisfy the frozen schema — which should be unreachable, since
 * the input type constrains every enum, and is therefore worth failing loudly on rather than
 * writing a record no reader can parse.
 */
export async function mintProvenance(
  storage: Storage, input: MintProvenanceInput,
): Promise<AiProvenanceRecordRow> {
  const id = randomUUID();
  const generatedAt = new Date(input.generatedAt ?? Date.now()).toISOString();
  const contentHash = input.content !== undefined
    ? contentHashOf(input.content)
    : (input.contentHash ?? undefined);

  const draft: AiProvenance = {
    spec: AI_PROVENANCE_SPEC_V1,
    level: input.level,
    humanInvolvement: input.humanInvolvement,
    generatedAt,
    generator: {
      ...input.generator,
      principal: input.principal,
      nodeId: input.generator?.nodeId ?? input.nodeId,
    },
    attestation: {
      stampedBy: input.stampedBy,
      // DERIVED, never a parameter: only a node that saw the generation may say it did.
      observed: input.stampedBy === 'node',
      ...(contentHash ? { contentHash } : {}),
      ...(input.baseUrl ? { recordUrl: `${input.baseUrl.replace(/\/+$/, '')}/v1/provenance/${id}` } : {}),
    },
  };
  if (input.method) draft.method = input.method;
  if (input.sources?.length) draft.sources = input.sources;
  if (input.derivedFrom?.length) draft.derivedFrom = input.derivedFrom;
  if (input.notes) draft.notes = input.notes;

  draft.disclosure = buildDisclosure(draft, input.surface ?? DEFAULT_SURFACE);

  const parsed = AiProvenanceSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(`ai-provenance: refusing to mint an invalid record — ${parsed.error.message}`);
  }

  const row: AiProvenanceRecordRow = {
    id,
    ownerGhii: input.ownerGhii,
    principal: input.principal,
    contentHash: contentHash ?? null,
    visibility: input.visibility ?? 'private',
    generatedAt,
    createdAt: new Date().toISOString(),
    record: parsed.data,
  };
  await storage.createAiProvenance(row);
  return row;
}

/**
 * What a PUBLIC surface serves. `minimal` returns the four required fields plus the disclosure
 * block; the full record stays stored and stays visible to its owner.
 *
 * Two reasons this is a serving knob rather than a filling one. The Code of Practice pushes both
 * ways at once — Measure 1.3 encourages richer provenance metadata while Sub-measure 1.1.1 warns
 * against putting privacy- or business-sensitive information in it — so an operator whose pipeline
 * name or source list reveals something commercial needs a way to publish less without recording
 * less. And a completeness score only means anything if the ceiling is fixed: if configuration
 * could lower what gets FILLED, "92% complete" would stop being comparable between nodes.
 */
export function projectForDetail(record: AiProvenance, detail: 'full' | 'minimal'): AiProvenance {
  if (detail !== 'minimal') return record;
  const minimal: AiProvenance = {
    spec: record.spec,
    level: record.level,
    humanInvolvement: record.humanInvolvement,
    generatedAt: record.generatedAt,
  };
  if (record.disclosure) minimal.disclosure = record.disclosure;
  return minimal;
}
