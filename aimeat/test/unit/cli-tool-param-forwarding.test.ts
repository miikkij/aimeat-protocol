/**
 * @file test/unit/cli-tool-param-forwarding.test.ts
 * @description Does a parameter the catalog PUBLISHES actually reach the node from the CLI dispatch?
 *
 *   WHY THIS EXISTS, AND WHY IT REPLACED A SOURCE SCAN. `/local/call/<tool>` — the door a fleet
 *   daemon uses — dispatches through CONNECT_CLI_TOOLS, which is a third definition set beside the
 *   node's MCP and the connector's MCP. A parameter added to the other two still does not exist
 *   here, zod-style silence and all: the call returns ok having done less than it was asked. That
 *   defect has now been found three times by a crew running 61 agents through this door, twice after
 *   we had already "fixed" it on the surfaces they do not use.
 *
 *   The first attempt to gate it read the handler SOURCE for each parameter name. It was wrong in
 *   both directions within an hour — it counted a handler's own `(ctx, input)` signature as a
 *   pass-through, and it missed `input.space` property access — and a detector that is wrong in the
 *   permissive direction is worse than none, because it reports green. So this measures instead:
 *   every handler is invoked with a recording client, and the question asked of each parameter is
 *   the only one that matters, which is whether the value left the process.
 *
 *   A tool whose parameter genuinely cannot be forwarded (the REST route has no field for it) is
 *   listed in UNREACHABLE with the reason. That list is debt, and it may only shrink.
 *
 *   AND THE HOLE THAT LEFT, closed in v1.1.0. Per parameter, a handler that refuses every sentinel
 *   was filed as `unmeasured` and the run moved on — correct on its own terms. But the final
 *   assertion read `dropped` and never `unmeasured`, so a tool refusing on EVERY parameter passed in
 *   silence, and that is not a careful handler, it is a dead one. Thirty-one tools were in that state
 *   on the fleet door with this suite green.
 * @usage pnpm test -- cli-tool-param-forwarding
 * @version-history
 *   v1.1.0 — 2026-09-06 — Ask the whole-tool question too: nothing on the wire for ANY declared
 *     parameter is uncallable, not unmeasurable. PROBE_SETUP carries the shaped values and the
 *     companions a format-checking handler needs; DOES_NOT_CALL_THE_NODE is the only way to say a
 *     tool legitimately never calls out.
 *   v1.0.0 — 2026-08-16 — Written after the third report of the same defect, replacing the source
 *     scan added the same day.
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../src/mcp/catalog/definitions.js';
import type { JsonObject } from '../../src/cli/connect/tool-call-helpers.js';

/** Handled by withProvenanceCarrying() around every definition, not by the handlers themselves. */
const WRAPPER_PARAMS = new Set(['ai_provenance', 'ai_provenance_id']);
/** Chosen by the dispatcher / registry, never forwarded to the node as a field. */
const NOT_FORWARDED_BY_DESIGN = new Set(['response_format', 'agent_name']);

/**
 * Tools that legitimately never reach the node, so "nothing on the wire" is the right answer for
 * them and not a dead door. Anything else putting nothing on the wire across EVERY parameter is
 * uncallable, and this list is the only way to say otherwise.
 */
const DOES_NOT_CALL_THE_NODE = new Set<string>([
    // Answers with a refusal by design — see knowledgeContributeUnreachable().
    'aimeat_knowledge_contribute',
    // Pure local computation: defineAppIam() turns levels + commands into an IAM block and hands it
    // back. There is no route behind it and there is not meant to be one — the caller pastes the
    // result into an app. Verified by reading the handler, which never touches `client`.
    'aimeat_iam_define',
]);

/**
 * WHAT THE PROBE MUST SEND FOR A HANDLER TO GET AS FAR AS THE WIRE.
 *
 * Two mechanisms, and the difference is the difference between a defect and a measurement limit:
 *
 * `shaped` — the parameter has a FORMAT the generic zqx sentinel cannot satisfy: `pkg:owner/name`,
 * `owner/file.html`, a manifest carrying objectTypes. The handler is right to refuse the sentinel.
 * Every shaped value still carries the zqx tag, so "did it leave the process" is still the question
 * being asked; only the wrapper around the tag changes.
 *
 * `always` — the tool's contract is a COMBINATION (space + value together, or items), so one
 * parameter at a time can never reach the wire. These are the companions, held constant.
 *
 * NEITHER IS A WAY TO SILENCE A RED TEST. A parameter whose only problem is that the handler and the
 * catalog spell it differently belongs in neither list; it belongs fixed. Every entry here names
 * what the handler actually demands, and was written after reading it.
 */
const PROBE_SETUP: Record<string, { shaped?: Record<string, unknown>; always?: JsonObject }> = {
    // ref is matched against /^pkg:owner\/name(@sha256:…)?$/ before anything is sent, and `format`
    // decides WHICH request is made: the default 'url' fetches the descriptor and touches none of
    // resource / limit / offset / select.
    aimeat_datapackage_export: { shaped: { ref: 'pkg:zqxrefzqx/zqxrefzqx' }, always: { format: 'json' } },
    // app is split on its one slash into owner and filename; a bare word is refused.
    aimeat_datamap_get: { shaped: { app: 'zqxappzqx/zqxappzqx.html' } },
    aimeat_datamap_set: { shaped: { app: 'zqxappzqx/zqxappzqx.html' } },
    // The manifest must be an object with an objectTypes ARRAY, which is what makes a workspace a
    // workspace; without it the handler answers INVALID_MANIFEST and writes nothing.
    aimeat_workspace_create: { shaped: { manifest: { name: 'zqxmanifestzqx', objectTypes: [{ name: 'zqxmanifestzqx' }] } } },
    // normalizeWriteItems takes `space` + `value` together, or `items`. Holding the pair constant is
    // the only way a single-parameter probe reaches the workspace read that precedes the write.
    aimeat_workspace_write: { always: { space: 'probe', value: { title: 'probe' } } },
    // Two directions, two different second arguments. `direction` is held at 'export' so `ws` is
    // read at all; the import branch is exercised when `direction` is itself the parameter on test.
    aimeat_workspace_transfer: { always: { direction: 'export', zip_base64: 'cHJvYmU=' } },
    // action='decide' needs a requester; the other two actions ignore it.
    aimeat_workspace_access: { always: { requester: 'probe-owner' } },
};

/**
 * Parameters this probe cannot see reach the node, each with the reason. Two kinds live here and the
 * difference matters: the route genuinely has no field for it (debt — shrink it), or it is only
 * meaningful alongside another value the probe does not set (correct — explain it).
 *
 * DEBT IS NOT APPROVAL. Never add a line here to turn a red test green without reading the route
 * first; that is the move that would have hidden every defect this file exists to catch.
 */
const UNREACHABLE: Record<string, Record<string, string>> = {
    aimeat_skill_list: {
        organism_id: 'Conditional, not dropped: only sent with view="workspace", which is the only listing that scopes to one workspace.',
        workspace_id: 'Same condition.',
    },
    aimeat_compliance_snapshot: {
        id: 'Conditional, not dropped: the probe holds `action` at its sentinel "save", which POSTs a new '
            + 'snapshot and has no id to send. The handler forwards id on every other action — verified '
            + 'directly in test/unit/compliance-snapshot-dispatch.test.ts, because the two parameters here '
            + 'are mutually exclusive and one probe run cannot exercise both.',
    },
    aimeat_memory_write: {
        expected_version: 'POST /v1/memory has no optimistic lock; the node MCP calls the write service directly and PUT /v1/memory/:key spells it `version`.',
    },
    aimeat_memory_search: {
        include_versions: 'GET /v1/memory/search does not read it; the node MCP applies that filter itself after the query.',
    },
    aimeat_workflow_save: {
        propose: 'Server-MCP only by design (workflows.ts v1.1.0): the propose-then-confirm flow is an operator path, and PUT /v1/workflows/:id takes the definition as its whole body with no field for it.',
        confirm_token: 'Same flow, same reason. A connector caller saves directly or not at all.',
    },
    aimeat_crew_try: {
        try_id: 'Conditional, not dropped: the probe sets doc as well, which STARTS a trial and gets its own id; try_id is only read when there is no doc (continue waiting). Both branches reach the node in test/e2e-agent-crew.ts.',
        wait_seconds: 'Consumed by the door itself, like response_format: the routes have no wait; the handler polls GET .../crew/try/:id for that long before handing the id back.',
    },
    aimeat_crew_publish: {
        revision: 'Conditional, not dropped: the probe sets doc as well, which publishes; revision is only read when there is no doc (restore). Both reach the node in test/e2e-agent-crew.ts.',
    },
    aimeat_app_legal_set: {
        format: 'Conditional, not dropped: sent inside the kind object, so only with `kind`, which names the page the format belongs to. Without a kind the tool READS the state (GET .../legal) and has nothing to attach a format to. With a kind all three travel — proven by the probe run that sets kind.',
        content: 'Same condition.',
        remove: 'Same condition: `remove: true` rides inside the kind object, and the node reads it as null for that kind.',
    },
    aimeat_workspace_access: {
        message: "Conditional, not dropped: `message` rides only on action='request', and the probe holds "
            + "`action` at its enum sentinel 'decide' so that `decision` and `role` are measurable at all. "
            + 'The three are mutually exclusive branches of one tool and one probe run cannot exercise two '
            + "of them; the request branch is covered end to end by test/e2e-organism-workspace-access.ts.",
    },
    aimeat_knowledge_contribute: {
        package_id: 'This tool is deliberately unreachable from the connector — see knowledgeContributeUnreachable().',
        entry_key: 'Same: the tool answers with a refusal rather than calling the node.',
        content: 'Same.',
        model: 'Same.',
    },
};

interface Sent { method: string; path: string; body?: unknown }

function recordingClient(sent: Sent[]) {
    const ok = { ok: true, data: {} } as never;
    const push = (method: string, path: string, body?: unknown) => { sent.push({ method, path, body }); return Promise.resolve(ok); };
    return {
        get: (p: string) => push('GET', p),
        post: (p: string, b?: unknown) => push('POST', p, b),
        put: (p: string, b?: unknown) => push('PUT', p, b),
        patch: (p: string, b?: unknown) => push('PATCH', p, b),
        delete: (p: string) => push('DELETE', p),
    };
}

/**
 * Values distinctive enough to find again in a URL or a JSON body. An ARRAY gets two candidate
 * shapes and a parameter counts as forwarded if EITHER survives, because the shape a handler
 * accepts is not knowable from the catalog: `tags` wants strings and is filtered to them, `todos`
 * wants objects with a title and is refused without one. Probing one shape only makes the other
 * handler look like it drops the field, which is a measurement artefact dressed as a defect.
 */
function sentinelsFor(field: { type?: string; enum?: string[] }, param: string, tool?: string): unknown[] {
    const shaped = tool ? PROBE_SETUP[tool]?.shaped?.[param] : undefined;
    if (shaped !== undefined) return [shaped];
    const tag = `zqx${param}zqx`;
    // An ENUM must be probed with a value it accepts, and with the one FURTHEST from the default —
    // handlers branch on these, and a value outside the set lands in the same else-branch as an
    // omitted one, which is indistinguishable from being ignored.
    if (Array.isArray(field.enum) && field.enum.length) return [field.enum[field.enum.length - 1], field.enum[0]];
    switch (field.type) {
        case 'number': return [4242];
        case 'boolean': return [true];
        case 'array': return [
            [tag],
            [{ title: tag, name: tag, id: tag, key: tag, value: tag, identifier: tag, gaii: tag, ref: tag }],
        ];
        case 'object': return [{ title: tag, name: tag, id: tag, key: tag, value: tag }];
        default: return [tag];
    }
}
const sentinelFor = (field: { type?: string }, param: string, tool?: string): unknown => sentinelsFor(field, param, tool)[0];

function mentionsValue(sent: Sent[], param: string, value: unknown): boolean {
    const haystack = sent.map(s => `${s.path} ${JSON.stringify(s.body ?? null)}`).join('   ');
    if (typeof value === 'number') return haystack.includes('4242');
    if (typeof value === 'boolean') return /"[a-z_]+":true|=true/i.test(haystack);
    return haystack.includes(`zqx${param}zqx`);
}

/** The whole outgoing conversation as one comparable string. */
function wire(sent: Sent[]): string {
    return sent.map(s => `${s.method} ${s.path} ${JSON.stringify(s.body ?? null)}`).join(' | ');
}

interface Run { sent: Sent[]; refused: boolean }

/**
 * Invoke a handler against a recording client and return what it put on the wire, plus whether it
 * REFUSED the probe.
 *
 * The refusal flag matters more than it looks. `aimeat_offer_price_set` GETs the agent's offers,
 * fails to find the synthetic offer id, and returns { ok: false } before it reads any of the six
 * pricing fields it forwards perfectly well. Counting that as six dropped parameters would send
 * somebody to "fix" a handler that is already correct, which is how an audit loses the trust that
 * makes it worth running.
 */
async function record(tool: { handler: (ctx: never, input: JsonObject) => Promise<unknown> }, input: JsonObject): Promise<Run> {
    const sent: Sent[] = [];
    const ctx = {
        client: recordingClient(sent),
        config: { agent: 'probe', owner: 'prober', node_url: 'http://node.test' },
        agentPath: 'probe',
    };
    let refused = false;
    try {
        const result = await tool.handler(ctx as never, input) as { ok?: boolean } | undefined;
        refused = result?.ok === false;
    } catch {
        // A handler that throws on this synthetic input still had its chance to send; whatever
        // reached the wire before it threw is what we measure.
        refused = true;
    }
    return { sent, refused };
}

const catalog = new Map(CLI_FALLBACK_TOOL_DEFINITIONS.map(d => [d.name, d]));

describe('every parameter the catalog publishes reaches the node from /local/call', () => {
    const gaps: string[] = [];
    const unmeasured: string[] = [];

    for (const tool of CONNECT_CLI_TOOLS) {
        const def = catalog.get(tool.name);
        const declared = { ...(def?.input ?? {}), ...(tool.input ?? {}) } as Record<string, { type?: string }>;
        const params = Object.keys(declared)
            .filter(p => !WRAPPER_PARAMS.has(p) && !NOT_FORWARDED_BY_DESIGN.has(p));
        if (!params.length) continue;

        // ONE PARAMETER AT A TIME, alongside the required ones. Sending them all together makes an
        // ALIAS look dropped — aimeat_task_complete takes `message` OR `summary` and prefers the
        // first, so a run carrying both would report `summary` as lost when it is doing its job.
        const required = Object.entries(declared).filter(([, f]) => (f as { required?: boolean }).required).map(([p]) => p);

        it(`${tool.name} forwards ${params.length} declared parameter(s)`, async () => {
            const unreachable = UNREACHABLE[tool.name] ?? {};
            const dropped: string[] = [];
            /**
             * Did this tool reach the wire AT ALL, on any probe, for any parameter?
             *
             * THE HOLE THIS CLOSES. Per parameter, a handler that refuses every sentinel is filed as
             * `unmeasured` and the run moves on — correct on its own terms, because a handler
             * rejecting a zqx-tagged string where a base64 blob belongs is doing its job. But a tool
             * that refuses on EVERY parameter is not being careful, it is uncallable: the catalog and
             * the handler are reading different names, `withDeclaredInputOnly` refuses the ones the
             * catalog publishes, and nothing the caller can send will ever get through. Sixteen tools
             * were in exactly that state on the fleet door for three weeks with this suite green,
             * because the final assertion reads `dropped` and `gaps` and never `unmeasured`.
             */
            let toolEverSent = false;

            for (const param of params) {
                if (param in unreachable) continue;
                let forwarded = false;
                let everSent = false;

                // The baseline: the same call WITHOUT this parameter. A parameter has reached the
                // node if the outgoing request differs at all — `aimeat_skill_list` turns `view`
                // into a different PATH rather than echoing it, and demanding the value appear
                // verbatim would call that a drop when the parameter is doing its whole job.
                const baseInput: JsonObject = {};
                for (const r of required) if (r !== param) baseInput[r] = sentinelFor(declared[r] ?? {}, r, tool.name) as never;
                // Companions LAST, so they hold a branch open against the generic sentinel a
                // required parameter would otherwise get — `format` decides which of two requests
                // aimeat_datapackage_export makes, and its default hides four other parameters.
                for (const [k, v] of Object.entries(PROBE_SETUP[tool.name]?.always ?? {})) if (k !== param) baseInput[k] = v as never;
                const baseline = await record(tool, baseInput);
                if (baseline.sent.length) toolEverSent = true;

                let refusedEveryTime = true;
                for (const candidate of sentinelsFor(declared[param] ?? {}, param, tool.name)) {
                    const input: JsonObject = { ...baseInput };
                    input[param] = candidate as never;
                    const run = await record(tool, input);
                    if (run.sent.length) { everSent = true; toolEverSent = true; }
                    if (!run.refused) refusedEveryTime = false;
                    if (mentionsValue(run.sent, param, candidate) || wire(run.sent) !== wire(baseline.sent)) { forwarded = true; break; }
                }
                // The handler bailed out on the probe every time, so the forwarding code below its
                // guard was never reached. Not measurable, not a drop.
                if (!forwarded && refusedEveryTime) { unmeasured.push(`${tool.name}.${param}`); continue; }

                // NOTHING ON THE WIRE MEANS THE HANDLER REFUSED THE SYNTHETIC INPUT, not that the
                // parameter is dropped. Several validate their shape and return an error object
                // before calling the client — a zqx-tagged string where a base64 blob belongs is
                // exactly the case they are right to reject. Counting those as drops is how a
                // measurement starts lying in the alarming direction, which is no better than
                // lying in the reassuring one.
                if (forwarded) continue;
                if (!everSent) { unmeasured.push(`${tool.name}.${param}`); continue; }
                dropped.push(param);
            }

            if (dropped.length) gaps.push(`${tool.name}: ${dropped.join(', ')}`);
            expect(dropped, `${tool.name} never put these on the wire: ${dropped.join(', ')}`).toEqual([]);

            // The whole-tool question, asked after every parameter has had its turn.
            if (!toolEverSent && !DOES_NOT_CALL_THE_NODE.has(tool.name)) {
                gaps.push(`${tool.name}: UNCALLABLE \u2014 nothing reached the node on any of its ${params.length} declared parameter(s)`);
            }
            expect(toolEverSent || DOES_NOT_CALL_THE_NODE.has(tool.name),
                `${tool.name} put NOTHING on the wire for any of its ${params.length} declared parameter(s). `
                + 'That is not an unmeasurable tool, it is a dead one: the catalog and the handler are '
                + 'reading different parameter names, so every call the catalog permits is refused before '
                + 'the handler runs. Fix the names, or add the tool to DOES_NOT_CALL_THE_NODE with the '
                + 'reason it legitimately never reaches the node.').toBe(true);
        });
    }

    it('reports the whole set in one place when anything is dropped', () => {
        expect(gaps, gaps.join('\n')).toEqual([]);
    });
});
