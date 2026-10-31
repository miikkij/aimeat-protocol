/**
 * @file src/mcp/designbook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node-MCP door for the Design Book (TARGET-074 phase 5): search, read, propose,
 *   adopt. Calls the same DesignBookService the REST routes do — one capability, one
 *   implementation — and the bench refusals reach the agent in the validator's own words.
 * @structure registerDesignbookTools(mcp, storage, config, getAgentGaii, caller)
 * @usage
 *   import { registerDesignbookTools } from './designbook.js';
 *   registerDesignbookTools(mcp, storage, config, () => agentGaii, caller);
 * @version-history
 *   2026-10-30 — The node's default kit: aimeat_designbook_kit_default takes `node` (asks the session's
 *     caller().operator(), as PUT /v1/designbook/kits/default asks isOperatorCaller), and
 *     aimeat_designbook_kit takes view "defaults" (GET /v1/designbook/kits/defaults).
 *     aimeat_designbook_status: a part's status from chat, as POST /v1/designbook/:id/status.
 *   2026-10-30 — Style kits: aimeat_designbook_kit (the kit a new app starts from) and
 *     aimeat_designbook_kit_default; the search names its reader, so a kit narrower than the node is
 *     listed only inside its reach.
 *   2026-10-24 — keep, propose and adopt refuse the shared anonymous principal with AUTH_REQUIRED, as
 *     the REST write routes do (secaudit2026oct22, routes/auth.ts:anonymous-mint:writes-outside-anonymous-namespace).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.6.8 — 2026-09-26 — The propose contract says that beside a <ul> or <ol> of the markup every
 *     counter-reset also names list-item, and "all" takes only revert or revert-layer.
 *   v1.6.7 — 2026-09-26 — The propose contract says a list item stays inside a list of the component:
 *     an <li> inside a <ul> or <ol>, no display: list-item, and list-item 0 beside a <summary>.
 *   v1.6.6 — 2026-09-26 — The propose contract says the blocks of @font-feature-values pass inside it
 *     and a @function names its parameters without types.
 *   v1.6.5 — 2026-09-26 — The propose contract says a counter, an anchor, a view transition or a
 *     timeline a declaration names starts with the component's prefix, written as the word itself.
 *   v1.6.4 — 2026-09-26 — The propose contract says a component's stylesheet closes every block,
 *     bracket, comment and string it opens.
 *   v1.6.3 — 2026-09-26 — The propose contract states the list of at-rules a component's stylesheet may
 *     carry.
 *   v1.6.2 — 2026-09-26 — The propose contract says a component's stylesheet carries no @layer, @page or
 *     @view-transition, and that a name it defines with @keyframes, @property or @counter-style starts
 *     with its prefix.
 *   v1.6.1 — 2026-09-26 — The propose contract says a component's stylesheet carries no @scope.
 *   v1.6.0 — 2026-09-26 — get names the calling agent to the service, which answers a component's
 *     `bench` and gives the markup and stylesheet of one that no longer passes only to its proposer.
 *     The propose contract says a nested rule starts with "&" and the markup closes every element.
 *   v1.5.0 — 2026-09-20 — The reasons: search takes view "reasons" (what the Book should grow
 *     next), get answers what builders wrote about a part, and aimeat_designbook_keep is the owner
 *     saying an app turned out well. Its own tool because it writes the node's system records on
 *     the owner's word, which no memory write can do.
 *   v1.4.0 — 2026-09-19 — A search with no word and no kind answers the whole published shelf as
 *     one page of text (DesignBookService.map), where it used to answer the first fifty rows.
 *   v1.3.0 — 2026-09-05 — effect joins the kind wording, with its body and its targets, and an
 *     adopted effect is told apart in the answer (wish-atelier-post-process-effects, stage 5).
 *   v1.2.0 — 2026-09-05 — genre and ambient join the kind wording (wish-atelier-ambient-visuals),
 *     and an adopted ambient is told apart in the answer: the layer runs behind the app on its
 *     next open with the arrangement and the look untouched.
 *   v1.1.0 — 2026-08-28 — The kind wording grows with the Book: look, motion and illustration
 *     join layout and fill in the search filter and the propose contract.
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { toDeclaredProvenance } from './ai-provenance-input.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { DesignBookService } from '../services/design-book/service.js';
import { DesignBookKits } from '../services/design-book/kit-defaults.js';
import { DesignBookError } from '../services/design-book/validate.js';
import { MAP_NOTE, REASONS_NOTE } from '../services/design-book/map.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { isAnonymousPrincipal, ANONYMOUS_PRINCIPAL_REFUSAL } from '../auth/anonymous-principal.js';

/** One text block per answer; refusals carry the service's words verbatim. */
function text(payload: unknown, isError = false) {
    return { content: [{ type: 'text' as const, text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }], ...(isError ? { isError: true } : {}) };
}

export function registerDesignbookTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    caller: () => CallerContext,
): void {
    const book = new DesignBookService(storage, config);
    const kits = new DesignBookKits(storage, config);

    // The write tools (keep, propose, adopt) refuse the shared anonymous principal: the Design Book
    // is node-wide and written under the node's identity, outside the anonymous.* namespace.
    const refuseAnonymous = () => isAnonymousPrincipal({ sub: getAgentGaii() })
        ? text(`AUTH_REQUIRED: ${ANONYMOUS_PRINCIPAL_REFUSAL}`, true) : null;

    const answer = async (work: () => Promise<unknown>) => {
        try {
            return text(await work());
        } catch (err) {
            if (err instanceof DesignBookError) return text(`${err.code}: ${err.message}`, true);
            throw err;
        }
    };

    mcp.registerTool(
        'aimeat_designbook_search',
        {
            description: descriptionFor('aimeat_designbook_search'),
            inputSchema: zodShapeFor('aimeat_designbook_search'),
            annotations: annotationsFor('aimeat_designbook_search'),
        },
        async ({ kind, status, q, limit, view }) => {
            // What builders wrote down about the Book, as what it should become next (reasons.ts).
            if (view === 'reasons') {
                return text({ ...(await book.reasonsQueue()), note: REASONS_NOTE });
            }
            // No word, no kind: the caller does not know yet what the Book holds, so it gets the
            // whole shelf on one page as plain text, and not the first fifty rows of JSON.
            if (view === 'map' || (!kind && !status && !q && limit == null)) {
                const out = await book.map();
                return text(`${out.map}${MAP_NOTE}`);
            }
            return answer(async () => {
            // The reader is named: a kit narrower than the node is listed only inside its reach (kit.ts).
            const parts = await book.list({ kind, status, q, limit }, { reader: getAgentGaii() });
            return {
                parts, count: parts.length,
                note: parts.length
                    ? 'Read one whole with aimeat_designbook_get; its body is exactly what an adopt writes.'
                    : 'The Book holds nothing matching that. Propose the first part with aimeat_designbook_propose.',
            };
            });
        },
    );

    mcp.registerTool(
        'aimeat_designbook_get',
        {
            description: descriptionFor('aimeat_designbook_get'),
            inputSchema: zodShapeFor('aimeat_designbook_get'),
            annotations: annotationsFor('aimeat_designbook_get'),
        },
        // The reader is named: a component that no longer passes the bench shows its markup and
        // stylesheet only to its proposer, or an agent acting for them (service.ts get).
        async ({ id }) => answer(() => book.get(id, getAgentGaii())),
    );

    mcp.registerTool(
        'aimeat_designbook_keep',
        {
            description: descriptionFor('aimeat_designbook_keep'),
            inputSchema: zodShapeFor('aimeat_designbook_keep'),
            annotations: annotationsFor('aimeat_designbook_keep'),
        },
        async ({ filename, kept }) => refuseAnonymous() ?? answer(() => book.keep(getAgentGaii(), filename, kept !== false)),
    );

    mcp.registerTool(
        'aimeat_designbook_propose',
        {
            description: descriptionFor('aimeat_designbook_propose'),
            inputSchema: zodShapeFor('aimeat_designbook_propose'),
            annotations: annotationsFor('aimeat_designbook_propose'),
        },
        async ({ part, ai_provenance, ai_provenance_id }) => refuseAnonymous() ?? answer(async () => {
            const out = await book.propose(getAgentGaii(), part, {
                principal: getAgentGaii(),
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
            });
            return {
                ...out,
                // A component says itself whether it went onto the shelf, and why (service.ts).
                note: out.publishing ? out.publishing.why : out.status === 'proposed'
                    ? 'Proposed. The bench passed; publishing into the shared catalogue is the node operator\'s call. You can adopt your own proposal into your apps meanwhile.'
                    : `Updated in place as a minor — the part stays ${out.status}, and later adopts get this version.`,
            };
        }),
    );

    mcp.registerTool(
        'aimeat_designbook_adopt',
        {
            description: descriptionFor('aimeat_designbook_adopt'),
            inputSchema: zodShapeFor('aimeat_designbook_adopt'),
            annotations: annotationsFor('aimeat_designbook_adopt'),
        },
        async ({ id, filename, ai_provenance, ai_provenance_id }) => refuseAnonymous() ?? answer(async () => {
            const out = await book.adopt(getAgentGaii(), id, filename, {
                principal: getAgentGaii(),
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
            });
            return {
                ...out,
                note: out.kind === 'kit'
                    ? 'Taken. Build the app in this kit as `kit.use` says: fork its genre, put `kit.css` in the head, open the app with `kit.app`, and call `kit.ornament` with your elements. Nothing was written; the use is counted.'
                    : out.kind === 'component'
                    ? 'Taken. Build `snippet.html` and `snippet.css` into your page as they are, and wire the behaviour yourself as `snippet.use` says: a component carries no script. It reads the page\'s tokens, so inside a genre it wears the genre. Name it in your page\'s build notes (`took`, with why you chose it): that is what counts it as used.'
                    : out.kind === 'fill'
                    ? 'Adopted. This part is a starting shape: its <placeholder> texts are yours to replace with aimeat_app_manage (action "ui_set").'
                    : out.kind === 'ambient'
                        ? 'Adopted. The ambient runs behind the app on its next open; its arrangement and look are untouched, and only the part\'s own tokens merged in.'
                        : out.kind === 'effect'
                            ? 'Adopted. The effect wears on the block it names, or runs as a pass over the app\'s ambient, on the next open; the rest of the arrangement is untouched.'
                            : 'Adopted. The app renders it on its next open; the replaced layout is archived and one restore brings it back.',
            };
        }),
    );

    // The style kit a new app starts from, and the default one (kit-defaults.ts).
    mcp.registerTool(
        'aimeat_designbook_kit',
        {
            description: descriptionFor('aimeat_designbook_kit'),
            inputSchema: zodShapeFor('aimeat_designbook_kit'),
            annotations: annotationsFor('aimeat_designbook_kit'),
        },
        async ({ organism, view }) => refuseAnonymous() ?? answer(async () => view === 'defaults'
            ? kits.defaults(getAgentGaii(), await caller().operator())
            : kits.inForce(getAgentGaii(), organism || undefined)),
    );

    mcp.registerTool(
        'aimeat_designbook_kit_default',
        {
            description: descriptionFor('aimeat_designbook_kit_default'),
            inputSchema: zodShapeFor('aimeat_designbook_kit_default'),
            annotations: annotationsFor('aimeat_designbook_kit_default'),
        },
        async ({ kit, clear, organism, node }) => refuseAnonymous() ?? answer(async () => {
            if (!clear && !kit) throw new DesignBookError('INVALID_INPUT', 'Name the kit ("kit"), or clear the default with "clear": true.', 400);
            const isOperator = node === true ? await caller().operator() : false;
            return kits.setDefault(getAgentGaii(), isOperator, { ...(organism ? { organism } : {}), ...(node === true ? { node: true } : {}), kit: clear ? null : kit! });
        }),
    );

    // A part's status, as POST /v1/designbook/:id/status: the operator publishes, ages and demotes;
    // a proposer retires their own. The operator bit is the session's, asked the way the route asks it.
    mcp.registerTool(
        'aimeat_designbook_status',
        {
            description: descriptionFor('aimeat_designbook_status'),
            inputSchema: zodShapeFor('aimeat_designbook_status'),
            annotations: annotationsFor('aimeat_designbook_status'),
        },
        async ({ id, status }) => refuseAnonymous() ?? answer(async () =>
            book.setStatus(getAgentGaii(), await caller().operator(), id, status)),
    );
}
