/**
 * @file src/services/ai-provenance.ts
 * @description THE mint path for AI provenance records (TARGET-058). Everything that produces or
 *   accepts a statement about how content was made goes through mintProvenance() — there is
 *   deliberately no second way to write one, because a second way is how two subtly different
 *   record shapes come to exist.
 *
 *   HARD TO CALL WRONGLY, BY CONSTRUCTION. The caller supplies only what it OBSERVED; the service
 *   fills `spec`, `generatedAt`, `contentHash`, `attestation` and `disclosure` itself. In
 *   particular `attestation.observed` can only ever be NARROWED: a `principal` stamp is false no
 *   matter what the caller says, so nobody declaring provenance for content produced elsewhere can
 *   dress the claim up as something this node witnessed. A NODE stamp may narrow itself to false —
 *   that is Mint-3, where the node stamped the record because an agent held the pen rather than
 *   because it watched a model produce the bytes.
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
 *   - stampAgentWrite(storage, …)     — MINT-3: the default for a non-human principal that declared
 *                                       nothing. An owner (GHII) is never stamped.
 *   - publiclyResolvable(storage, ids)— THE visibility rule: provenance follows the content
 *   - buildDisclosure(...)            — the pre-rendered disclosure block, from disclosureFor() + i18n
 *   - projectForDetail(record, detail)— what a PUBLIC surface serves under AIMEAT_AI_PROVENANCE_DETAIL
 * @usage
 *   import { mintProvenance, contentHashOf } from './ai-provenance.js';
 *   const row = await mintProvenance(storage, { stampedBy: 'node', ... , content });
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. stampAgentWrite() (Mint-3) and publiclyResolvable();
 *     `visibility` is no longer a mint parameter — it is derived from the content the record
 *     describes, so nothing a caller sends can publish a statement about unreadable content.
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
import { isGEAI, parseGAII, ownerGhiiOf } from '../utils/gaii.js';
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

  /**
   * Did THIS node witness the generation? Defaults to true for a node stamp, and it can only ever
   * be NARROWED: a `principal` stamp is always `observed: false`, whatever this says. Mint-3 sets it
   * false — the node stamped the record because an agent held the pen, not because it watched a
   * model produce the bytes, and an inference must never be recorded as an observation.
   */
  observed?: boolean;
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
      // Only a node that saw the generation may say it did: a `principal` stamp is false, always,
      // and a node stamp may still narrow itself to false when it is inferring rather than watching.
      observed: input.stampedBy === 'node' && (input.observed ?? true),
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
    generatedAt,
    createdAt: new Date().toISOString(),
    record: parsed.data,
  };
  await storage.createAiProvenance(row);
  return row;
}

/**
 * MINT-3 — the node's default statement about content a non-human principal wrote without saying
 * anything about it.
 *
 * The rule (07-mcp-and-agent-plane.md §2.2): **silence from an agent must not read as "a human wrote
 * it".** An agent or ecosystem app writing text and declaring nothing is stamped `ai-generated` /
 * `humanInvolvement: none`, `stampedBy: 'node'`, `observed: false` — we did not witness the
 * generation, we inferred it from who is holding the pen — and the inference is written into
 * `notes` so a reader can tell an inference from an observation.
 *
 * An OWNER (GHII) principal is never stamped. A person writing through their own token is presumed
 * human unless they declare otherwise, and stamping them would be a false statement about
 * authorship. Returns `undefined` in that case, and whenever provenance is switched off.
 *
 * Returns the provenance id to attach to the item, or undefined for "attach nothing".
 */
export async function stampAgentWrite(
  storage: Storage,
  input: {
    /** The resolved identity of the writer — GHII, GAII or GEAI. Never `req.auth!.sub`. */
    principal: string;
    /** The exact bytes written, hashed here so a detection query can find them later. */
    content: string | Uint8Array;
    /** The job, crew, app or route that orchestrated the write. */
    pipeline?: string;
    /** The surface it will be served on, so the disclosure block is pre-rendered correctly. */
    surface?: SurfaceContext;
    nodeId: string;
    baseUrl?: string;
    /** `false` disables minting entirely (AIMEAT_AI_PROVENANCE=off). */
    enabled?: boolean;
  },
): Promise<string | undefined> {
  if (input.enabled === false) return undefined;
  if (!isNonHumanPrincipal(input.principal)) return undefined;

  const row = await mintProvenance(storage, {
    stampedBy: 'node',
    ownerGhii: ownerGhiiOf(input.principal),
    principal: input.principal,
    level: 'ai-generated',
    humanInvolvement: 'none',
    // The node stamped it, but it did NOT watch a model produce these bytes — it inferred from who
    // was holding the pen. Recording that inference as an observation would be the one lie in the
    // whole design.
    observed: false,
    content: input.content,
    generator: input.pipeline ? { pipeline: input.pipeline } : undefined,
    notes: INFERRED_FROM_PRINCIPAL_NOTE,
    surface: input.surface,
    nodeId: input.nodeId,
    baseUrl: input.baseUrl,
  });
  return row.id;
}

/** Written into `notes` on every Mint-3 record, so an inference never passes for an observation. */
export const INFERRED_FROM_PRINCIPAL_NOTE =
  'Inferred from the principal type: a non-human principal wrote this and declared no provenance. '
  + 'The node did not witness the generation. Silence from an agent is recorded as model-written '
  + 'rather than as human-written; an agent relaying text a person wrote can say so explicitly.';

/** A GAII (`agent#owner@node`) or a GEAI (`eco:app#owner@node`) — anything that is not a person. */
function isNonHumanPrincipal(principal: string): boolean {
  return isGEAI(principal) || parseGAII(principal) !== null;
}

/**
 * Resolve a caller-supplied provenance id to something safe to attach to their own item.
 *
 * A write path that took the id on trust would be a way to point a public item at SOMEONE ELSE'S
 * private record and publish it — visibility follows the content, so attaching is exactly the act
 * that makes a record resolvable. The ownership check is therefore not a nicety; it is the whole
 * gate. Returns the id when it is the caller's own, `undefined` otherwise.
 */
export async function resolveAttachableProvenanceId(
  storage: Storage, ownerGhii: string, provenanceId: string | undefined,
): Promise<string | undefined> {
  if (!provenanceId) return undefined;
  const row = await storage.getAiProvenance(provenanceId);
  return row && row.ownerGhii === ownerGhii ? row.id : undefined;
}

/**
 * THE visibility rule, at the one place that serves records: which of these are resolvable by
 * anyone right now? Visibility is not stored on the record — it follows the content, so this asks
 * the storage layer whether any item pointing at the record is currently public.
 *
 * Callers must treat "not in the returned set" as **identically** to "no such record": the resolve
 * endpoint answers one 404 for both, or it becomes an oracle for which ids exist on this node.
 */
export async function publiclyResolvable(storage: Storage, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  return new Set(await storage.publiclyLinkedProvenanceIds(ids));
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
