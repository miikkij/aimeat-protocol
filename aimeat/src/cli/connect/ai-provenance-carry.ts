/**
 * @file src/cli/connect/ai-provenance-carry.ts
 * @description The ONE place the connector decides how a caller's `ai_provenance` declaration
 *   reaches the node — used by BOTH connector surfaces (the MCP tools under `mcp/tools/` and the
 *   shell-callable handlers in `tool-call-defs-*.ts`), because they are separate code paths and
 *   letting each decide for itself is how they diverged in the first place.
 *
 *   WHAT WENT WRONG, AND WHY THIS FILE EXISTS (TARGET-058 Phase 11). The canonical MCP catalog has
 *   advertised `ai_provenance` on fourteen write tools since Phase 4. The connector's zod shapes did
 *   not carry it, and a zod object STRIPS unknown keys — so a crew that declared
 *   `level: original, human_involvement: full-human` got `ok: true` and the node stored
 *   `ai-generated` / `none` with a note saying it had inferred that from the principal type. Measured
 *   against the live node, a correct declaration, a bogus level and a spoofed principal all produced
 *   byte-identical default records. A caller declaring, getting ok:true, and the declaration
 *   vanishing with no error is the exact failure this programme exists to hunt.
 *
 *   THE CONNECTOR IS A REST CLIENT, NOT THE NODE. It has no `storage` and cannot call
 *   `provenanceForWrite()`. It can only use doors the node already opens, and today exactly one door
 *   accepts a declaration for content the caller is writing:
 *     - `POST /v1/provenance` mints it (scope-gated, `stampedBy: 'principal'`), and
 *       `attachToMemoryKey` binds it to one of the caller's OWN memory keys.
 *     - `POST /v1/memory` accepts a pre-minted `ai_provenance_id`.
 *   Every other write route — boards, DMs, tasks, apps, knowledge, workspaces — stamps from the
 *   principal and accepts nothing. So a declaration sent to those tools CANNOT be honoured, and the
 *   thing this file guarantees is that it does not *look* honoured: the tool result always carries an
 *   `ai_provenance` echo saying what was actually recorded, or that nothing was.
 *
 *   WRITE FIRST, THEN DECLARE — deliberately, and it is the non-obvious call here. The alternative
 *   (mint, then write with the id) is atomic but wrong: `POST /v1/provenance` with no attach target
 *   pre-renders the `disclosure` block against a PRIVATE surface, and that block is served verbatim
 *   at read time — so a record attached to a public key would go on claiming no label is owed.
 *   `attachToMemoryKey` renders it against the key's real visibility, which is precisely what Phase 3
 *   built it for. The cost is that a refused declaration leaves an entry already stamped with the
 *   node's own default; that default is the over-labelled direction (decision D4), and the caller is
 *   told, by name, that its declaration was refused and what stands in its place.
 *
 *   IDENTITY IS STILL NEVER THE CALLER'S TO STATE. Nothing here forwards a principal, a node id or an
 *   attestation. The block schema has no field for them, and the echo reports the principal the NODE
 *   recorded — which is how a caller discovers that a spoofed one was discarded.
 * @structure
 *   - CONNECTOR_PROVENANCE_CARRIERS — per tool: how (or whether) a declaration reaches the node
 *   - carrierAttach()               — where a tool's record binds, from its own input
 *   - parseDeclarationInput()       — validate a raw shell-path block against the shared zod schema
 *   - carryDeclaration()            — do it, and return what to tell the caller
 *   - withProvenanceEcho()          — fold the echo into a tool result payload
 *   - withProvenanceCarrying()      — wrap a SHELL-callable handler (applied once, in tool-call.ts)
 *   - provenanceEchoedResult()      — the MCP-tool one-liner: carry, echo, return the text result
 *   - provenanceFromMeta()          — READ: lift meta.provenance out of the envelope
 *   - readPayloadWithProvenance()   — READ: `resp.data ?? resp` without losing the envelope
 * @usage
 *   const echo = await carryDeclaration(client, {
 *     tool: 'aimeat_memory_write', declared: ai_provenance, declaredId: ai_provenance_id,
 *     attach: { memoryKey: key, content: memoryContentBytes(value) },
 *   });
 *   return jsonContent(withProvenanceEcho(resp.data ?? resp, echo));
 * @version-history
 *   v1.2.0 — 2026-08-02 — Carry `provider` (who SERVED the model). It was added to the node's own MCP
 *     surface and to this file's shared schema, but not to toDeclareBody — so it parsed, typed and
 *     validated here and was dropped on the last line before the POST. Same two-surface split as the
 *     outbound-write and inbound-read rounds, and the third time a declared field went quiet: this is
 *     the path EVERY fleet crew uses, since crews reach the node only through `aimeat connect serve`.
 *     `model` and `provider` now merge into one `generator` rather than one replacing the other.
 *     test/unit/provenance-carry-field-parity.test.ts derives its expectations from the schema, so the
 *     next field forgotten here fails a test instead of vanishing in production.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 11b: the READ direction. Reported from the crewaimeat
 *     side as "read_provenance() never returns anything for memory reads" — the node serves the
 *     record on the envelope carrier and every `resp.data ?? resp` in the connector dropped it.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 11.
 */
import { AiProvenanceBlockSchema, type AiProvenanceToolInput } from '../../mcp/ai-provenance-input.js';
import type { AimeatClient, ApiResponse } from './api-client.js';

// The bytes a memory value's provenance record is about, from the node's own definition rather than
// a second one that could drift: a different answer here means the connector's declared record and
// the node's own stamp hash DIFFERENT bytes, and a detection query by hash stops finding both.
// (`routes/memory/shared.ts` imports nothing but types, so this costs the CLI no runtime weight.)
import { memoryContentBytes } from '../../routes/memory/shared.js';
export { memoryContentBytes };

/**
 * How a declaration reaches the node for a given tool.
 *
 * `attach-memory` — the node has a door: write the entry, then `POST /v1/provenance` with
 *   `attachToMemoryKey`. The declaration is recorded and bound to the content it describes.
 * `not-carried`   — the node's REST route for this tool accepts no declaration. The write happens,
 *   the node stamps from the principal, and the caller is told its block was not recorded.
 *
 * The `not-carried` entries are a WORK LIST, not a settled design. Each names the route that would
 * have to accept `ai_provenance_id` for the entry to move to a real carrier. They are listed rather
 * than left implicit so that `check:ai-disclosure` can count them and so that nobody has to read
 * fourteen handlers to find out which of them actually work.
 *
 * ONE OF THEM IS NOW HALF-OPEN: `publish-draft` accepts a declaration (the app publish doors were
 * fixed after this list was written), so `aimeat_app_draft_publish` is no longer blocked by the node
 * — only by this side not sending the body. See its entry.
 */
export type ProvenanceCarrier =
  | {
    kind: 'attach-memory';
    /** Where the record binds, derived from the tool's own input. Both surfaces call this. */
    attachFrom: (input: Record<string, unknown>) => { memoryKey: string; content: string } | undefined;
  }
  | { kind: 'not-carried'; route: string };

export const CONNECTOR_PROVENANCE_CARRIERS: Record<string, ProvenanceCarrier> = {
  aimeat_memory_write: {
    kind: 'attach-memory',
    attachFrom: (input) => (typeof input.key === 'string' && input.key
      ? { memoryKey: input.key, content: memoryContentBytes(input.value) }
      : undefined),
  },

  // READY TO MOVE, and the only entry on this list that is. The route now ACCEPTS a declaration
  // (routes/apps/drafts.ts) — what is still missing is on this side: the connector's proxy posts an
  // empty body, so the block never leaves the client. Left `not-carried` because that is what the
  // caller is honestly told today; promoting it means sending the body AND being able to prove the
  // echo's `recorded: true`, which is its own slice rather than a line change here.
  aimeat_app_draft_publish: { kind: 'not-carried', route: 'POST /v1/apps/:owner/:filename/publish-draft' },
  aimeat_app_publish: { kind: 'not-carried', route: 'POST /v1/packages' },
  aimeat_board_post: { kind: 'not-carried', route: 'POST /v1/boards/:id/posts' },
  aimeat_board_reply: { kind: 'not-carried', route: 'POST /v1/boards/:id/posts/:postId/replies' },
  aimeat_dm_ask: { kind: 'not-carried', route: 'POST /v1/messages' },
  aimeat_dm_send: { kind: 'not-carried', route: 'POST /v1/messages' },
  aimeat_dm_send_as_owner: { kind: 'not-carried', route: 'POST /v1/messages' },
  aimeat_exchange_work_deliver: { kind: 'not-carried', route: 'POST /v1/exchange/work/:id/deliver' },
  aimeat_knowledge_contribute: { kind: 'not-carried', route: 'POST /v1/knowledge/:id/contribute' },
  aimeat_message_send: { kind: 'not-carried', route: 'POST /v1/agents/:agent/messages' },
  aimeat_task_complete: { kind: 'not-carried', route: 'POST /v1/agents/:agent/tasks/:id/complete' },
  aimeat_workspace_comment: { kind: 'not-carried', route: 'POST /v1/organisms/:id/comments' },
  // The batch is the reason, not the route: workspace_write DOES land in POST /v1/memory, which
  // could carry a declaration — but one declaration cannot honestly describe N separately-authored
  // records, and per-item declaration was never designed. Carrying it would need that design first.
  aimeat_workspace_write: { kind: 'not-carried', route: 'aimeat_workspace_write (a batch of POST /v1/memory writes)' },
};

/**
 * What the caller is told about its declaration. A tool result carries one whenever a block was sent.
 *
 * SHAPED LIKE THE READ SURFACES ON PURPOSE — `{ id, record, record_url }` is what
 * `provenanceItemBlock()` puts on every item a reader fetches, and `aimeat_crewai`'s
 * `read_provenance()` / `is_model_written()` key off `record.spec`. Inventing a different shape for
 * write results would mean every consumer needs two parsers for one field name. `recorded` and
 * `reason` are additions on top; a `recorded: false` echo carries no `record`, so a reader that only
 * understands the document sees UNSTATED — which is the correct reading of "nothing was recorded".
 */
export type ProvenanceEcho =
  | {
    recorded: true;
    id: string;
    /** How it got there: freshly declared, or an existing record attached by id. */
    via: 'declared' | 'attached';
    /** The stored `aimeat.provenance/v1` document. Absent for `via: 'attached'` (not re-fetched). */
    record?: Record<string, unknown>;
    record_url?: string;
    level?: string;
    human_involvement?: string;
    /** The principal the NODE recorded. Compare it with what you sent: yours was not used. */
    principal?: string;
  }
  | { recorded: false; reason: string; declared: Record<string, unknown> };

/** Thrown when a declaration cannot be recorded and continuing would misrepresent what happened. */
export class ProvenanceCarryError extends Error {
  constructor(message: string) { super(message); this.name = 'ProvenanceCarryError'; }
}

/** Where this tool's declaration binds, from its own input. `undefined` when it binds nowhere. */
export function carrierAttach(
  tool: string, input: Record<string, unknown>,
): { memoryKey: string; content: string } | undefined {
  const carrier = CONNECTOR_PROVENANCE_CARRIERS[tool];
  return carrier?.kind === 'attach-memory' ? carrier.attachFrom(input) : undefined;
}

/**
 * Validate a raw declaration off the SHELL path against the same schema the MCP path is typed by.
 *
 * The MCP surface gets this for free — the SDK parses the tool's zod shape before the handler runs —
 * but `aimeat connect call` and `POST /local/call/:tool` hand the handler an untyped JSON object. A
 * bogus `level` arriving there must be refused with the field named, not coerced and not ignored.
 */
export function parseDeclarationInput(raw: unknown): AiProvenanceToolInput | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProvenanceCarryError('ai_provenance must be an object: { level, human_involvement?, method?, model?, provider?, sources?, notes? }');
  }
  const parsed = AiProvenanceBlockSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ProvenanceCarryError(`Invalid ai_provenance declaration — ${detail}. Nothing was recorded.`);
  }
  return parsed.data;
}

/**
 * The declaration as `POST /v1/provenance` wants it: camelCase document fields, not the snake DTO.
 *
 * Exported for the parity test that derives its expectations from AiProvenanceBlockSchema, so a
 * field added to the schema and forgotten here fails a test instead of vanishing at runtime. That
 * has now happened three times (outbound writes, inbound reads, `provider`), and every time the
 * symptom was a field silently absent rather than an error.
 */
export function toDeclareBody(
  declared: AiProvenanceToolInput,
  content: string,
  attachToMemoryKey?: string,
): Record<string, unknown> {
  return {
    level: declared.level,
    // The node defaults silence to `none` too; spelling it here keeps the declare route's REQUIRED
    // field satisfied without inventing a different default on this side.
    humanInvolvement: declared.human_involvement ?? 'none',
    ...(declared.method ? { method: declared.method } : {}),
    // `model` and `provider` are two answers to different questions — which model wrote it, and who
    // ran it — and they share one `generator` object, so neither may overwrite the other. Emit it
    // when EITHER is present: the node's generator schema has no required field, and a caller
    // routing through an intermediary can legitimately name the router without naming the model.
    ...(declared.model || declared.provider
      ? {
        generator: {
          ...(declared.model ? { model: declared.model } : {}),
          ...(declared.provider ? { provider: declared.provider } : {}),
        },
      }
      : {}),
    ...(declared.sources?.length
      ? {
        sources: declared.sources.map((s) => ({
          url: s.url,
          ...(s.title ? { title: s.title } : {}),
          ...(s.retrieved_at ? { retrievedAt: s.retrieved_at } : {}),
          ...(s.role ? { role: s.role } : {}),
        })),
      }
      : {}),
    ...(declared.notes ? { notes: declared.notes } : {}),
    content,
    ...(attachToMemoryKey ? { attachToMemoryKey } : {}),
  };
}

/**
 * Record the caller's declaration against content it just wrote, or say why that was not possible.
 *
 * Call this AFTER the write succeeded — `attachToMemoryKey` needs the entry to exist, and the record's
 * pre-rendered disclosure is only correct when it is rendered against that entry's real visibility.
 */
export async function carryDeclaration(
  client: AimeatClient,
  opts: {
    /** The tool being called — decides which carrier applies. */
    tool: string;
    /** The block the caller sent, already validated. */
    declared?: AiProvenanceToolInput;
    /** An existing record the caller asked to attach; the write body carries it where supported. */
    declaredId?: string;
    /** Present only for a carrier that can bind the record to something. */
    attach?: { memoryKey: string; content: string };
  },
): Promise<ProvenanceEcho | undefined> {
  const { tool, declared, declaredId, attach } = opts;

  // An id the write body already carried. Nothing more to do — but say so, because "I attached
  // record X" and "I silently ignored your id" look identical from the outside otherwise.
  if (declaredId && !declared) {
    return { recorded: true, id: declaredId, via: 'attached' };
  }
  if (!declared) return undefined;

  const carrier = CONNECTOR_PROVENANCE_CARRIERS[tool];
  if (!carrier || carrier.kind === 'not-carried') {
    const route = carrier?.route ?? 'this tool\'s node route';
    return {
      recorded: false,
      declared: { level: declared.level, human_involvement: declared.human_involvement ?? 'none' },
      reason:
        `${route} accepts no provenance declaration, so this one was NOT recorded. The node stamped `
        + 'the write from your principal instead — an agent writing without a declaration is recorded '
        + 'as model-written with no human review, which over-states AI involvement rather than '
        + 'under-stating it. To record a declaration today, write through aimeat_memory_write or '
        + 'declare directly with POST /v1/provenance.',
    };
  }

  if (!attach) {
    throw new ProvenanceCarryError(
      `Internal: ${tool} declares carrier "${carrier.kind}" but supplied nothing to attach the record to.`);
  }

  const resp: ApiResponse = await client.post(
    '/v1/provenance', toDeclareBody(declared, attach.content, attach.memoryKey));

  if (!resp.ok) {
    const code = resp.error?.code ?? 'UNKNOWN';
    // Loud, and it names what stands in the declaration's place. The entry IS written by this point;
    // pretending otherwise would be a second lie on top of the one this phase exists to remove.
    throw new ProvenanceCarryError(
      `The write succeeded but your ai_provenance declaration was REFUSED by the node (${code}): `
      + `${resp.error?.message ?? 'no message'} `
      + 'The entry now carries the node\'s own stamp instead — for an agent that is `ai-generated` '
      + 'with no human review. Re-declare it with POST /v1/provenance (attachToMemoryKey) once the '
      + 'cause is fixed.');
  }

  const data = resp.data as { id?: string; provenance?: Record<string, unknown> } | undefined;
  const record = (data?.provenance ?? {}) as Record<string, unknown>;
  const generator = (record.generator ?? {}) as Record<string, unknown>;
  const attestation = (record.attestation ?? {}) as Record<string, unknown>;
  return {
    recorded: true,
    id: String(data?.id ?? ''),
    via: 'declared',
    record,
    record_url: typeof attestation.recordUrl === 'string' ? attestation.recordUrl : undefined,
    level: typeof record.level === 'string' ? record.level : undefined,
    human_involvement: typeof record.humanInvolvement === 'string' ? record.humanInvolvement : undefined,
    principal: typeof generator.principal === 'string' ? generator.principal : undefined,
  };
}

/**
 * Fold the echo into a tool result payload.
 *
 * Under the `ai_provenance` key — the same name the caller used — so the answer sits where the
 * question was asked. A payload that is not an object (a bare string or array) is wrapped rather than
 * silently dropped, because losing the echo is exactly the failure mode being fixed.
 */
export function withProvenanceEcho(payload: unknown, echo: ProvenanceEcho | undefined): unknown {
  if (!echo) return payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>), ai_provenance: echo };
  }
  return { result: payload, ai_provenance: echo };
}

/**
 * The READ direction: lift `meta.provenance` out of the envelope onto the tool result.
 *
 * Six node routes serve a record on the envelope carrier rather than per-item — `GET /v1/memory/:key`,
 * the app and knowledge detail reads, and the two completion routes. The connector unwraps `resp.data`
 * and the envelope goes in the bin, so a crew reading its own content back saw `ai_provenance_id` (a
 * pointer) and no statement. Reported from the crewaimeat side as "read_provenance() never returns
 * anything for memory reads", and it is the write-side strip pointing the other way.
 *
 * The block produced here is `{ id, record, record_url }` — deliberately the SAME shape
 * `provenanceItemBlock()` puts on every per-item read and the same shape the node's own MCP
 * `aimeat_memory_read` returns. One spelling on every surface is the whole point; a connector-only
 * variant would mean `read_provenance()` needs to know which door it came through.
 */
export function provenanceFromMeta(resp: ApiResponse): Record<string, unknown> {
  const p = resp.meta?.provenance as { id?: string; record?: unknown; recordUrl?: string } | undefined;
  if (!p?.id || !p.record) return {};
  return { ai_provenance: { id: p.id, record: p.record, record_url: p.recordUrl } };
}

/**
 * A read tool's payload with the envelope's provenance folded in. `resp.data ?? resp` with the one
 * thing that unwrap was losing.
 */
export function readPayloadWithProvenance(resp: ApiResponse): unknown {
  const data = resp.data ?? resp;
  if (!resp.ok || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  return { ...(data as Record<string, unknown>), ...provenanceFromMeta(resp) };
}

/**
 * Wrap a SHELL-callable tool handler so it carries a declaration the same way the MCP tool does.
 *
 * Applied once where `CONNECT_CLI_TOOLS` is assembled, so `aimeat connect call` and
 * `POST /local/call/:tool` — the deterministic path fleet crews use — get this without hand-editing
 * every handler.
 *
 * BOTH DIRECTIONS, AND WRAPPING EVERY TOOL IS THE POINT. Writes get the declaration carried and
 * echoed; reads get `meta.provenance` folded onto the payload. The read fold is UNCONDITIONAL rather
 * than driven by a list of read tools, because a list is a thing to forget: it is a no-op when the
 * envelope carries no provenance, and the next route that starts serving some is covered the day it
 * ships instead of the day somebody notices.
 *
 * `parseDeclarationInput` runs BEFORE the inner handler, so a bogus `level` refuses the whole call
 * and nothing is written. That is the shell path's substitute for the zod layer the MCP path gets
 * from the SDK.
 */
export function withProvenanceCarrying<Ctx extends { client: AimeatClient }>(
  def: { name: string; handler: (ctx: Ctx, input: Record<string, unknown>) => Promise<ApiResponse> },
): typeof def {
  const inner = def.handler;
  const carries = !!CONNECTOR_PROVENANCE_CARRIERS[def.name];
  return {
    ...def,
    handler: async (ctx: Ctx, input: Record<string, unknown>): Promise<ApiResponse> => {
      const declared = carries ? parseDeclarationInput(input.ai_provenance) : undefined;
      const declaredId = carries && typeof input.ai_provenance_id === 'string' ? input.ai_provenance_id : undefined;
      const resp = await inner(ctx, input);
      if (!resp.ok) return resp;
      if (!declared && !declaredId) return { ...resp, data: readPayloadWithProvenance(resp) };
      const echo = await carryDeclaration(ctx.client, {
        tool: def.name, declared, declaredId, attach: carrierAttach(def.name, input),
      });
      return { ...resp, data: withProvenanceEcho(resp.data, echo) };
    },
  };
}

/**
 * The whole thing in one call, for an MCP tool registration: carry the declaration, fold the echo
 * into the response payload, and hand back the connector's standard text result.
 *
 * One call site per tool rather than five lines per tool — thirteen hand-rolled copies of "and don't
 * forget the echo" is how the twelfth one ends up without it.
 */
export async function provenanceEchoedResult(
  client: AimeatClient,
  opts: {
    tool: string;
    declared?: AiProvenanceToolInput;
    declaredId?: string;
    attach?: { memoryKey: string; content: string };
  },
  resp: ApiResponse,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const echo = await carryDeclaration(client, opts);
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(withProvenanceEcho(resp.data ?? resp, echo), null, 2),
    }],
  };
}
