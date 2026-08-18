/**
 * @file src/services/ai-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - provenanceForWrite(storage, …)  — THE decision a write surface makes: attach / declare / Mint-3
 *   - stampAutonomousOutput(…)        — the stamp for output the node produced on its own initiative;
 *                                       the "only substantive review upgrades it" rule lives here
 *   - stampAgentWrite(storage, …)     — MINT-3: the default for a non-human principal that declared
 *                                       nothing. An owner (GHII) is never stamped.
 *   - publiclyResolvable(storage, ids)— THE visibility rule: provenance follows the content
 *   - buildDisclosure(...)            — the pre-rendered disclosure block, from disclosureFor() + i18n
 *   - projectForDetail(record, detail)— what a PUBLIC surface serves under AIMEAT_AI_PROVENANCE_DETAIL
 * @usage
 *   import { mintProvenance, contentHashOf } from './ai-provenance.js';
 *   const row = await mintProvenance(storage, { stampedBy: 'node', ... , content });
 * @version-history
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 4. provenanceForWrite() folds the three cases a write
 *     surface faces — attach an existing record, honour a caller's DECLARATION, or fall back to
 *     Mint-3 — into one function, so the MCP write tools and the REST routes cannot drift into
 *     three subtly different answers. A declaration is minted `stampedBy: 'principal'`, and the
 *     principal on the record is always the RESOLVED identity: a caller cannot attribute its
 *     writing to someone else.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 3. `labelPolicy` (AIMEAT_AI_LABEL_PUBLIC) rides beside
 *     `nodeId` into the pre-rendered disclosure block, which now also carries `strength`.
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
import { disclosureFor, type SurfaceContext, type DisclosureLabelPolicy } from './ai-disclosure.js';
import { isGEAI, parseGAII, ownerGhiiOf } from '../utils/gaii.js';
import { createT, LOCALES } from '../i18n.js';
import { logger } from '../utils/logger.js';

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
  /**
   * The node's visible-label posture, `config.aiLabelPublic`. Pass it wherever `nodeId` is passed:
   * it belongs to the node, not the caller, and omitting it silently pre-renders the block as
   * "the law, exactly" — correct but less than the operator asked for.
   */
  labelPolicy?: DisclosureLabelPolicy;
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
export function buildDisclosure(
  record: AiProvenance, ctx: SurfaceContext, policy: DisclosureLabelPolicy = 'light',
): AiDisclosureBlock {
  const decision = disclosureFor(record, ctx, policy);

  let shortKey: string;
  let longKey: string;
  if (decision.reason === 'art50_1_interaction') {
    shortKey = 'aiLabel.short'; longKey = 'aiLabel.chat';
  } else if (decision.reason === 'policy') {
    // Labelled beyond the law. The words must not overstate: this content was either reviewed by a
    // person or declared outside the public-interest limb, so it gets the neutral "a model was
    // involved" wording rather than the "no human editorial review" statement.
    shortKey = record.level === 'assisted' ? 'aiLabel.assisted' : 'aiLabel.short';
    longKey = 'aiLabel.policyLong';
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
    strength: decision.strength,
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

  draft.disclosure = buildDisclosure(draft, input.surface ?? DEFAULT_SURFACE, input.labelPolicy);

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
    /** The node's visible-label posture, `config.aiLabelPublic`. */
    labelPolicy?: DisclosureLabelPolicy;
    nodeId: string;
    baseUrl?: string;
    /** `false` disables minting entirely (AIMEAT_AI_PROVENANCE=off). */
    enabled?: boolean;
  },
): Promise<string | undefined> {
  if (input.enabled === false) return undefined;
  if (!isNonHumanPrincipal(input.principal)) return undefined;

  // WHICH model wrote this, when the agent has said. It reported one at identify_platform and the
  // node has been storing it ever since; not carrying it here meant every stamped write said "an AI
  // wrote this" and nothing about which. That answer matters most in a message: a person reading
  // text an agent sent them can now see what produced it, and an operator reading a support thread
  // can tell a capable model's report from a weak one's.
  //
  // SELF-REPORTED, and marked as such by `observed: false` below: the agent named its own model, the
  // node cannot verify it, and a platform delegating to a cheaper subagent mid-session makes the
  // agent-level answer indicative rather than exact. A declaration that carries its own model
  // (`ai_provenance.model`) takes the other branch in provenanceForWrite and wins, because that one
  // is about THESE bytes rather than about the agent in general.
  let model: string | undefined;
  try {
    model = (await storage.getAgent(input.principal))?.model;
  } catch (err) {
    logger.warn('stampAgentWrite: continuing without the agent model', { error: String(err) });
  }

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
    generator: input.pipeline || model
      ? { ...(input.pipeline ? { pipeline: input.pipeline } : {}), ...(model ? { model } : {}) }
      : undefined,
    notes: INFERRED_FROM_PRINCIPAL_NOTE,
    surface: input.surface,
    labelPolicy: input.labelPolicy,
    nodeId: input.nodeId,
    baseUrl: input.baseUrl,
  });
  return row.id;
}

/**
 * What a CALLER may state about content it is writing — the declaration an agent sends alongside a
 * write, before the node turns it into a record.
 *
 * It is deliberately NOT the `aimeat.provenance/v1` document. It carries no `spec`, no
 * `generatedAt`, no attestation, and it flattens `model` out of `generator`, because everything it
 * omits is something the node knows better than the caller does. That is also why this type is
 * spelled camelCase while the MCP parameter that carries it is snake_case: a declaration is an input
 * DTO and follows the house convention (snake on the wire, mapped at the boundary), whereas the
 * document it becomes is self-describing and keeps one spelling everywhere.
 */
export interface DeclaredProvenance {
  /** REQUIRED when a caller declares anything at all. The rest is optional detail. */
  level: AiProvenanceLevel;
  method?: AiProvenanceMethod;
  /**
   * Absent means `none`, never "somebody probably looked". Only a step where a person reads the
   * substance and can reject it upgrades this field, and a caller that does not mention review did
   * not describe such a step.
   */
  humanInvolvement?: AiHumanInvolvement;
  model?: string;
  /**
   * Who SERVED the model, when a declarer routes through an intermediary. Separate from `model`
   * because they answer different questions, and a router alias answers neither on its own: an
   * agent recording `openrouter/openrouter/free` has named a routing pool, not a writer.
   */
  provider?: string;
  sources?: AiProvenanceSource[];
  notes?: string;
}

/**
 * THE decision every write surface makes about provenance, in one function: given who is writing,
 * what they wrote, and whatever they said about it, what record (if any) should the item carry?
 *
 * Three cases, in this order, and the order matters:
 *   1. `declaredId` — the caller is attaching a record that already exists. This is the publish path:
 *      `/v1/ai/complete` hands back a private record and attaching it here is what makes it
 *      resolvable. Resolved against the caller's OWN account, so nobody publishes someone else's
 *      statement.
 *   2. `declared` — the caller is stating how the content was made. Minted `stampedBy: 'principal'`,
 *      because the generation happened in the caller's runtime and this node watched none of it; the
 *      minter then forces `observed: false` for any principal stamp, so the distinction between what
 *      we saw and what we were told cannot be blurred by anything a caller sends.
 *   3. neither — MINT-3. A non-human principal that said nothing is stamped model-written; an owner
 *      is left alone.
 *
 * IDENTITY IS NEVER THE CALLER'S TO STATE. `principal` here is the RESOLVED identity of whoever
 * holds the token, and it overwrites anything a declaration tried to say about who generated the
 * content. This is the one place an agent could otherwise attribute its writing to someone else.
 */
/** Thrown when a caller declares provenance without holding `provenance:write`. */
export class ProvenanceScopeError extends Error {
  readonly code = 'SCOPE_DENIED';
  constructor(readonly heldScopes: string[]) {
    super(
      `Scope "${PROVENANCE_WRITE_SCOPE}" required to declare ai_provenance. Held: `
      + `[${heldScopes.join(', ')}]. Omit the block to let the node record what it observed instead.`);
    this.name = 'ProvenanceScopeError';
  }
}

/** The scope that permits ASSERTING how content was made. Gates POST /v1/provenance and every
 *  declaration arriving over MCP — one name, so the two doors cannot answer differently. */
export const PROVENANCE_WRITE_SCOPE = 'provenance:write';

/**
 * Does this principal hold `provenance:write`?
 *
 * Mirrors requireScope() exactly, including the two rules that matter: a global `*` passes, a domain
 * wildcard passes, and an OWNER bypasses scopes entirely while an agent or ecosystem app never does.
 * The lookup only happens when a declaration is actually present, so the common path — the agent that
 * says nothing and gets Mint-3 — costs no query.
 *
 * Why the gate exists at all: minting the node's own observation is not a privilege, but ASSERTING
 * how content was made is. `POST /v1/provenance` has required this scope since Phase 1, and an MCP
 * declaration performs the identical act; leaving it ungated here would make MCP a way around the
 * REST gate — the same class of hole the memory schema-lock bypass was.
 */
async function mayDeclareProvenance(storage: Storage, principal: string): Promise<{ ok: true } | { ok: false; scopes: string[] }> {
  // An owner writing through their own token is a person acting for themselves — the owner bypass.
  if (!isGEAI(principal) && parseGAII(principal) === null) return { ok: true };
  const scopes = isGEAI(principal)
    ? (await storage.getEcosystemApp(principal))?.scopes ?? []
    : (await storage.getAgent(principal))?.defaultScopes ?? [];
  if (scopes.includes('*') || scopes.includes(PROVENANCE_WRITE_SCOPE)) return { ok: true };
  const domain = PROVENANCE_WRITE_SCOPE.split(':')[0];
  if (scopes.includes(`${domain}:*`)) return { ok: true };
  return { ok: false, scopes };
}

export async function provenanceForWrite(
  storage: Storage,
  input: {
    /** The resolved identity of the writer — GHII, GAII or GEAI. Never `req.auth!.sub`. */
    principal: string;
    /** The exact bytes written, hashed so a detection query can find them later. */
    content: string | Uint8Array;
    /** A record id the caller asked to attach. Checked against the caller's own account. */
    declaredId?: string;
    /** What the caller said about how the content was made. */
    declared?: DeclaredProvenance;
    /** The job, crew, app or route that orchestrated the write. */
    pipeline?: string;
    surface?: SurfaceContext;
    labelPolicy?: DisclosureLabelPolicy;
    nodeId: string;
    baseUrl?: string;
    /** `false` disables minting entirely (AIMEAT_AI_PROVENANCE=off). */
    enabled?: boolean;
  },
): Promise<string | undefined> {
  if (input.enabled === false) return undefined;

  const attached = await resolveAttachableProvenanceId(
    storage, ownerGhiiOf(input.principal), input.declaredId);
  if (attached) return attached;

  if (input.declared) {
    // Refused, not silently downgraded to Mint-3: a caller that thinks it declared something and
    // finds the opposite recorded has been lied to by its own tool call.
    const may = await mayDeclareProvenance(storage, input.principal);
    if (!may.ok) throw new ProvenanceScopeError(may.scopes);
    const row = await mintProvenance(storage, {
      stampedBy: 'principal',
      ownerGhii: ownerGhiiOf(input.principal),
      // The declaration's own idea of who generated this is discarded here, by construction: the
      // input type has no principal field and this is the only value that reaches the record.
      principal: input.principal,
      level: input.declared.level,
      humanInvolvement: input.declared.humanInvolvement ?? 'none',
      method: input.declared.method,
      content: input.content,
      generator: {
        ...(input.declared.model ? { model: input.declared.model } : {}),
        // The declarer's own answer to "who ran it". The record schema has always had the field;
        // until now only the node's OWN generation path could fill it, so an agent declaring for
        // content it produced elsewhere had no way to say — and every such record came back with the
        // question unanswered no matter how carefully the agent knew it.
        ...(input.declared.provider ? { provider: input.declared.provider } : {}),
        ...(input.pipeline ? { pipeline: input.pipeline } : {}),
      },
      sources: input.declared.sources,
      notes: input.declared.notes ?? DECLARED_BY_PRINCIPAL_NOTE,
      surface: input.surface,
      labelPolicy: input.labelPolicy,
      nodeId: input.nodeId,
      baseUrl: input.baseUrl,
    });
    return row.id;
  }

  return stampAgentWrite(storage, {
    principal: input.principal,
    content: input.content,
    pipeline: input.pipeline,
    surface: input.surface,
    labelPolicy: input.labelPolicy,
    nodeId: input.nodeId,
    baseUrl: input.baseUrl,
    enabled: input.enabled,
  });
}

/**
 * THE stamp for content this node produced ON ITS OWN INITIATIVE — a scheduled job, an automation,
 * a playbook step, a tracked response that fired while nobody was looking.
 *
 * ONLY A STEP WHERE A PERSON READS THE SUBSTANCE AND CAN REJECT IT UPGRADES humanInvolvement.
 * Clicking publish is not that step. A workflow human-input step that reviews substance MAY upgrade
 * it. Nothing else may.
 *
 * Those are the words, and they are here rather than repeated at each call site because this is the
 * sentence that drifts. Every autonomous path calls this and passes `reviewedBy` only when it can
 * name the person and the step at which they read the SUBSTANCE — an approval queue, a "send" button
 * on a pre-written draft, a scheduled fire, an owner who once configured the automation: none of
 * those qualify, and none of them may pass it.
 *
 * `stampedBy: 'node'` with `observed: false`: the node is the one asserting this, and it composed
 * the output — but it did not stand and watch a model generate the bytes, so recording an inference
 * as an observation would be the one lie in the design. Where the node DID watch (a completion
 * through ai-completion.ts), carry that record instead of calling this.
 */
export async function stampAutonomousOutput(
  storage: Storage,
  input: {
    /** Whose account this belongs to and who it ran for — usually the owner's GHII. */
    principal: string;
    /** The exact bytes produced. */
    content: string | Uint8Array;
    /** What the output is, in provenance terms. Defaults to `ai-generated`. */
    level?: AiProvenanceLevel;
    method?: AiProvenanceMethod;
    /** The job, crew, automation or route that produced it. */
    pipeline: string;
    /**
     * The person who read the SUBSTANCE and could have rejected it, and where. Pass this ONLY for a
     * step that meets that test; it is the single thing that upgrades humanInvolvement to
     * `editorial-control`. Omitted means `none`, which is the correct answer for every path where
     * the output goes out unread.
     */
    reviewedBy?: { who: string; step: string };
    surface?: SurfaceContext;
    labelPolicy?: DisclosureLabelPolicy;
    nodeId: string;
    baseUrl?: string;
    /** `false` disables minting entirely (AIMEAT_AI_PROVENANCE=off). */
    enabled?: boolean;
  },
): Promise<string | undefined> {
  if (input.enabled === false) return undefined;
  const reviewed = input.reviewedBy;
  const row = await mintProvenance(storage, {
    stampedBy: 'node',
    observed: false,
    ownerGhii: ownerGhiiOf(input.principal),
    principal: input.principal,
    level: input.level ?? 'ai-generated',
    humanInvolvement: reviewed ? 'editorial-control' : 'none',
    method: input.method,
    content: input.content,
    generator: { pipeline: input.pipeline },
    notes: reviewed
      ? `Produced by an automated step (${input.pipeline}) and reviewed by ${reviewed.who} at "${reviewed.step}", `
        + 'a step where the substance is read and can be rejected.'
      : `Produced by an automated step (${input.pipeline}). Nobody read the substance before it went out.`,
    surface: input.surface,
    labelPolicy: input.labelPolicy,
    nodeId: input.nodeId,
    baseUrl: input.baseUrl,
  });
  return row.id;
}

/** Written into `notes` on a declared record that carries no note of its own, so a reader can tell a
 *  caller's assertion from something this node watched happen. */
export const DECLARED_BY_PRINCIPAL_NOTE =
  'Declared by the writing principal. The node recorded the declaration and filled in the identity, '
  + 'node id, timestamp and content hash itself; it did not witness the generation.';

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
