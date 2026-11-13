/**
 * @file src/tool-catalog/definitions/content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content class tools (wish-sis-ll-n-purku-luokittelu-ja-owl): what a stored file or
 *   a memory record says about itself, reading one item now, a scan over many, the owner's content
 *   classes and the proposals for new ones, the classes as an OWL ontology, and the owner's
 *   settings. One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 *
 *   TERMS. A "content class" is the kind of thing an item is (an invoice, a contract, a photo). The
 *   descriptions never say "classification" (on this node that is a sensitivity label) and never
 *   "content type" (that is the MIME type).
 *
 *   SCOPE. The catalog word is storage:read for all five, the word that reads the items the facts
 *   are about. The service (services/content/service.ts) asks the rest itself, as the REST routes
 *   (routes/content.ts) do: memory:read for a memory record, ai:use for a stage that calls a model,
 *   memory:write-reserved for a change to the settings, a class or a proposal.
 *
 *   MODES. facts (one item or a listing), scan (follow or start) and classes (its actions) read
 *   different fields per mode, and checkContentInput() refuses a field the mode does not read, on
 *   both MCP surfaces and the CLI dispatch, rather than answering as if it had been used.
 * @structure checkContentInput() · contentTools
 * @usage imported by tool-catalog/definitions.ts; checkContentInput by mcp/content.ts and tool-dispatch/tool-call-defs-content.ts
 * @version-history
 *   v1.4.2 — 2026-11-13 — `owner` says an agent reaches its owner's memory record, such as a context.
 *   v1.4.1 — 2026-11-06 — aimeat_content_settings says the profile step is never run on arrival or by
 *     a scan on the settings, only when a caller names it.
 *   v1.4.0 — 2026-11-03 — A workspace document's shared fingerprint: aimeat_content_facts prefix and
 *     has_profile, aimeat_content_correct profile, aimeat_content_settings organism_id and ws.
 *   v1.3.0 — 2026-11-02 — The profile step (the fingerprint) and aimeat_content_facts with_profile.
 *   v1.2.0 — 2026-10-27 — Every string field has a length limit from models/input-limits.ts (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 *   v1.1.0 — 2026-10-21 — aimeat_content_correct: correct an item's classes and extracted values.
 *   v1.0.0 — 2026-10-20 — Initial: aimeat_content_facts, _inspect, _scan, _classes and _settings.
 */

import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

const STAGE_NAMES = ['technical', 'describe', 'classify', 'extract', 'propose', 'profile'] as const;
const ITEM_KINDS = ['pdf', 'image', 'video', 'text', 'other'] as const;

const SOURCE_KIND = {
    type: 'string' as const,
    description: '"file" (a stored file, the default) or "memory" (a memory record, or the key of a published workspace document).',
    enum: ['file', 'memory'] as const,
};
const SOURCE_OWNER = {
    type: 'string' as const,
    description: 'Whose item it is. Omit for your own. The account holder may name one of their own agents (its full agent identity, name#owner@node). An agent may name its owner\'s account (owner@node) for a memory record, such as the person\'s context; with the owner left out, a memory key the agent holds no record under is read as the owner\'s. The owner\'s record is reached as an owner-scope memory read reaches it: a private one only with memory:read-as-owner.',
};
const STAGES = {
    type: 'array' as const,
    description: 'The steps to run, any of technical (reads the file itself, no AI), describe (a description and alt text), classify (which content classes it belongs to), extract (the fields of each class), propose (suggests new classes or fields for the owner to approve), profile (the fingerprint: what kind of text each section is, what it rests on, its topic and leaning). Omit to run what the owner turned on in the settings.',
    zod: z.array(z.enum(STAGE_NAMES)),
};

/** Fields an interface or a wrapper adds to every call, which no mode reads itself. */
const INTERFACE_FIELDS = ['action', 'agent_name', 'response_format', 'ai_provenance', 'ai_provenance_id'];

/** The fields each mode of a multi-mode tool reads. A field of another mode is refused, never ignored. */
const MODE_FIELDS: Record<string, Record<string, readonly string[]>> = {
    aimeat_content_facts: {
        one: ['kind', 'key', 'owner', 'with_text', 'with_profile'],
        list: ['of_kind', 'class', 'stale', 'limit', 'after', 'prefix', 'has_profile'],
    },
    aimeat_content_scan: {
        follow: ['scan_id'],
        start: ['keys', 'kinds', 'memory_prefix', 'missing_only', 'stages', 'force', 'limit', 'prune'],
    },
    aimeat_content_classes: {
        list: [], set: ['class'], remove: ['id'], proposals: ['status'], approve: ['id'], reject: ['id'], ontology: [],
    },
};

/** The field a mode cannot run without. */
const MODE_REQUIRES: Record<string, string> = { set: 'class', remove: 'id', approve: 'id', reject: 'id' };

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * Check one call of a multi-mode content tool against its mode's fields, so a field the mode does
 * not read is refused rather than dropped. Both the node MCP (mcp/content.ts) and the CLI dispatch
 * (tool-dispatch/tool-call-defs-content.ts) call it, so the two answer the same.
 * @param {string} tool the tool name
 * @param {Record<string, unknown>} input the call's arguments
 * @returns {{ ok: true, mode: string } | { ok: false, message: string }} the mode, or the refusal sentence
 */
export function checkContentInput(tool: string, input: Record<string, unknown>): { ok: true; mode: string } | { ok: false; message: string } {
    const modes = MODE_FIELDS[tool];
    if (!modes) return { ok: true, mode: '' };
    let mode: string;
    if (tool === 'aimeat_content_facts') mode = present(input.key) ? 'one' : 'list';
    else if (tool === 'aimeat_content_scan') mode = present(input.scan_id) ? 'follow' : 'start';
    else mode = typeof input.action === 'string' ? input.action : '';
    const fields = modes[mode];
    if (!fields) return { ok: false, message: `action is one of: ${Object.keys(modes).join(', ')}.${mode ? ` "${mode}" is not one.` : ''}` };
    const need = tool === 'aimeat_content_classes' ? MODE_REQUIRES[mode] : undefined;
    if (need && !present(input[need])) return { ok: false, message: `action "${mode}" needs ${need}.` };
    // The class names itself: its id is the address it is stored under.
    if (mode === 'set' && tool === 'aimeat_content_classes') {
        const cls = input.class as { id?: unknown } | null;
        if (typeof cls !== 'object' || typeof cls?.id !== 'string' || !cls.id) return { ok: false, message: 'action "set" needs class with its id.' };
    }
    const allowed = new Set([...fields, ...INTERFACE_FIELDS]);
    const foreign = Object.keys(input).filter((f) => present(input[f]) && !allowed.has(f));
    if (!foreign.length) return { ok: true, mode };
    const what = tool === 'aimeat_content_facts'
        ? (mode === 'one' ? 'With key (one item)' : 'Without key (a listing)')
        : tool === 'aimeat_content_scan' ? (mode === 'follow' ? 'With scan_id (following a scan)' : 'Starting a scan')
            : `action "${mode}"`;
    return { ok: false, message: `${what} does not take: ${foreign.join(', ')}. Its fields: ${fields.join(', ') || 'none'}.` };
}

export const contentTools = [
    {
        name: 'aimeat_content_facts',
        description: "What a stored file or a memory record says about itself, as this node read it: its \"facts\". For a PDF: pages, title, author, producer, dates, whether it has a text layer, and its digital signatures (who signed, when, and whether the signature checks out). For a picture: format, size, camera, lens and exposure, when it was taken, location when it carries one, creator and copyright, and any alt text it already has. For a video or audio file: length, container, codecs, frame size and rate. For any item: its size and hash, and whether it declares being made by AI (from the node's own record, IPTC or a C2PA manifest; an item that says nothing is \"unknown\", this is not a detector). When the owner has turned the AI steps on, the facts also carry a description and alt text written by a model, the content classes the item belongs to (invoice, contract, receipt, photo and the owner's own), and for each class the fields extracted from it as a JSON-LD entity. When the owner turned the profile step on, an item also has a fingerprint: each section's kind of text (F fact, A analysis, M opinion, O instruction, P decision or plan, K narrative), what it rests on (+ a source the reader can check, ~ an identified person or meeting, ? nothing, x contradicted or replaced), how firmly it is stated, its topic, and where the item leans; the answer then carries `fingerprint`, ready lines and coloured squares to show the person when they ask what kind of material the item is (say the lines in their language). With `key`: the facts of that one item (NOT_FOUND when it was not read yet; run aimeat_content_inspect first), with `with_text` also the text kept from it (a PDF's text layer, the words a model read from a picture; null when there is none), and with `with_profile` also the profile's sections with their headings and one-sentence claims (null when the item has no profile). The key of a published workspace document (organism.<org>.w.<ws>.<namespace>.<id>.latest) answers its one shared fingerprint, the same for everyone who may read the document, and `shared` says who made it, whether a person corrected it, and `stale` (made from an earlier published version). Without `key`: a page of facts, newest first, filtered by `of_kind`, `class` or `stale` (read from an older version of the item); with `prefix` a compact page of the items under it (key, fingerprint without its sections, stale), and a workspace's prefix lists every published document of that workspace with its shared fingerprint or null, filtered by `has_profile`, up to 1000 a page; with no filter at all the answer also carries an overview: how much of the owner's content is read, the settings, a running scan and how many proposed classes wait for approval. Needs storage:read, and memory:read for a memory record.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Content Facts', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'storage:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            kind: SOURCE_KIND,
            key: { type: 'string', description: 'The stored file\'s key, or the memory record\'s key. Omit to list.', zod: z.string().max(1024) },
            owner: SOURCE_OWNER,
            with_text: { type: 'boolean', description: 'With `key`: also return the text kept from the item.' },
            with_profile: { type: 'boolean', description: 'With `key`: also return the profile\'s sections, each with its heading, a one-sentence claim, its kind of text, what it rests on and its topic.' },
            of_kind: { type: 'string', description: 'Listing only: the kind of item, pdf, image, video, text or other.', enum: ITEM_KINDS },
            class: { type: 'string', description: 'Listing only: the id of a content class (aimeat_content_classes lists them); only items that belong to it.' },
            stale: { type: 'boolean', description: 'Listing only: true lists the items whose facts were read from an older version of the item.' },
            limit: { type: 'number', description: 'Listing only: how many to return, 1 to 1000.', zod: z.number().int().min(1).max(1000) },
            after: { type: 'string', description: 'Listing only: the `next` cursor of the previous page.' },
            prefix: { type: 'string', description: 'Listing only: only items whose key starts with this, answered compact (the key, the fingerprint without its sections, whether it is stale). A workspace\'s prefix, organism.<organism id>.w.<workspace id>. (optionally followed by a namespace), lists that workspace\'s published documents with their shared fingerprints, null for one that has none.', zod: z.string().min(1).max(1024) },
            has_profile: { type: 'boolean', description: 'Listing only: true keeps the items with a fingerprint, false the items without one.' },
        },
    },
    {
        name: 'aimeat_content_inspect',
        description: "Read one stored file or memory record now and keep its facts (see aimeat_content_facts for what they are). Answers with the facts and which steps ran. Without `stages` the owner's own settings decide which steps run, and every AI step is off until the owner turns it on, so by default only the technical step runs: it reads the file itself and needs no AI. A step that calls an AI model (describe, classify, extract, propose, profile) also needs ai:use and spends the owner's AI allowance. An item whose facts are current is not read again unless `force` is true. On a published workspace document the profile step makes its one shared fingerprint, on your AI key: anyone who may read the document makes a missing or stale one, and making a current one again (force) needs the right to edit the document. Needs storage:read, and memory:read for a memory record.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Inspect One Item', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'storage:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            kind: SOURCE_KIND,
            key: { type: 'string', required: true, description: 'The stored file\'s key, or the memory record\'s key.', zod: z.string().min(1).max(1024) },
            owner: SOURCE_OWNER,
            stages: STAGES,
            force: { type: 'boolean', description: 'Read the item again even when its facts are current.' },
        },
    },
    {
        name: 'aimeat_content_correct',
        description: "Correct what was concluded about one item, when the person says it is wrong or you see it is. `classes` is the item's WHOLE list of content classes as it should be: a class the model gave and the list keeps stays, a class added is the person's, a class left out goes with its extracted fields; the model's decision is then marked on its decision record as confirmed (the same classes) or overridden (another list), so the person sees it was corrected. `fields` sets property values per class, e.g. { \"invoice\": { \"due_date\": \"2026-11-30\", \"amount\": 248 } } (null removes a value; aimeat_content_classes { action: \"list\" } names each class's properties); corrected values are kept when the class is extracted again. `extract: true` extracts the classes again afterwards (an AI step: needs ai:use and spends the owner's allowance). `profile` corrects the fingerprint: { sections: [{ n: 3, mark: \"+\" }] } gives section 3 the mark a person says it has (genre for its kind of text); the fingerprint then names who corrected it, and a later run on the same words keeps the correction. On a published workspace document that is the one fingerprint every reader sees, so it needs the right to edit the document. Correct only what the person confirmed, and tell them what you changed. Needs storage:read and memory:write.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Correct One Item', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'storage:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            kind: SOURCE_KIND,
            key: { type: 'string', required: true, description: 'The stored file\'s key, or the memory record\'s key.', zod: z.string().min(1).max(1024) },
            owner: SOURCE_OWNER,
            classes: { type: 'array', description: 'The item\'s whole list of content class ids as it should be; [] says it is in none.', zod: z.array(z.string().min(1).max(64)).max(50) },
            fields: { type: 'object', description: 'Per content class id, the property values to set; null removes one.', zod: z.record(z.string(), z.record(z.string(), z.union([z.string().max(INPUT_LIMITS.text), z.number(), z.boolean(), z.null()]))) },
            extract: { type: 'boolean', description: 'Extract the classes again afterwards (an AI step).' },
            profile: { type: 'object', description: 'The fingerprint: { sections: [{ n, genre?, mark? }] }, a section\'s kind of text (F, A, M, O, P, K) or mark (+ ~ ? x) as you say it is, each section by its number. The fingerprint then names you as its corrector, and a later run on the same words keeps your correction. On a workspace document this changes the one fingerprint every reader sees, so it needs the right to edit the document.', zod: z.object({ sections: z.array(z.object({ n: z.number().int().min(1), genre: z.enum(['F', 'A', 'M', 'O', 'P', 'K']).optional(), mark: z.enum(['+', '~', '?', 'x']).optional() })).min(1).max(24) }) },
        },
    },
    {
        name: 'aimeat_content_scan',
        description: "Go through many of the owner's items in the background and keep the facts of each (see aimeat_content_facts). With `scan_id`: how far that scan is, and nothing starts. Without it: starts a scan over the stored files (or over the memory records under `memory_prefix`), narrowed by `keys` or `kinds`, and answers at once with the scan; one scan runs per owner at a time, and asking again while one runs answers with that one (already_running: true). By default only items with no facts yet are read (`missing_only`). Without `stages` the owner's settings decide which steps run; a step that calls an AI model also needs ai:use and spends the owner's AI allowance for every item, so scan a few with `limit` first and report what came back. A finished scan is kept for an hour; the facts it wrote stay. Needs storage:read, and memory:read with `memory_prefix`.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Scan Many Items', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'storage:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            scan_id: { type: 'string', description: 'Follow this scan instead of starting one.' },
            keys: { type: 'array', description: 'Only these stored file keys.', zod: z.array(z.string().min(1).max(1024)) },
            kinds: { type: 'array', description: 'Only items of these kinds: pdf, image, video, text, other.', zod: z.array(z.enum(ITEM_KINDS)) },
            memory_prefix: { type: 'string', description: 'Scan the memory records under this key prefix instead of the stored files.' },
            missing_only: { type: 'boolean', description: 'Only items with no facts yet (default true). false reads every item in reach.' },
            stages: STAGES,
            force: { type: 'boolean', description: 'Read each item again even when its facts are current.' },
            limit: { type: 'number', description: 'At most this many items, 1 to 2000.', zod: z.number().int().min(1).max(2000) },
            prune: { type: 'boolean', description: 'Also remove the facts of items that no longer exist.' },
        },
    },
    {
        name: 'aimeat_content_classes',
        description: "The owner's content classes: the kinds of thing an item can be (invoice, receipt, contract, photo and the owner's own), each with a one-sentence meaning, the OWL class it specialises (such as schema:Invoice), the kinds of item it applies to and the fields extracted for it. `action`: \"list\" returns the built-in classes and the owner's own; \"set\" adds or changes one of the owner's classes (`class`: { id, label { en, fi }, describe, process, type, kinds?, properties [{ name, type string|number|date|boolean, required, describe, sameAs? }] }); \"remove\" removes the owner's class `id` (a changed built-in class returns to the built-in one); \"proposals\" lists the classes and fields a model proposed (`status` pending, approved or rejected); \"approve\" and \"reject\" decide the proposal `id`; \"ontology\" returns the owner's content classes as an OWL ontology in JSON-LD, for an RDF tool. list, proposals and ontology need storage:read; set, remove, approve and reject also need memory:write-reserved, because the classes decide what the owner's AI key is spent on.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Content Classes', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        scope: 'storage:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            action: { type: 'string', required: true, description: 'list, set, remove, proposals, approve, reject or ontology.', enum: ['list', 'set', 'remove', 'proposals', 'approve', 'reject', 'ontology'] },
            class: { type: 'object', description: 'With set: the whole class (see the description for its fields).', zod: z.record(z.string(), z.unknown()) },
            id: { type: 'string', description: 'With remove: the class id. With approve or reject: the proposal id.' },
            status: { type: 'string', description: 'With proposals: pending, approved or rejected. Omit for all.', enum: ['pending', 'approved', 'rejected'] },
        },
    },
    {
        name: 'aimeat_content_settings',
        description: "The owner's content class settings, which decide what this node reads from their content and what spends their AI allowance. Without `patch`: the settings. With `patch`: changes the fields it names and answers with the new settings; this needs memory:write-reserved. The fields: onArrival (true: read new content as it arrives; false: only on request); stages ({ technical, describe, classify, extract, propose, profile }, each true or false; technical needs no AI and every AI step is off until the owner turns it on; profile is never run on arrival or by a scan on the settings: a fingerprint is made only when a caller names the profile step for an item (aimeat_content_inspect with stages ['profile']), and profile true only lets a workspace that turned autoProfile on fingerprint the documents this owner publishes there); sources ({ files, memory, workspace }: which content is read on arrival); minTextChars (a memory record or document shorter than this is not read on arrival); approval (how a proposed class or field is taken in: \"ask\" waits for the owner, \"auto\" takes it at once, \"rule\" lets the owner's decision rule named in approvalRule decide); onlineSignatureChecks (ask trust lists and revocation over the network when a PDF's signatures are checked on arrival); models ({ text, vision, profile }: the models to use; empty means the owner's defaults, and an empty profile means the node's fingerprint model); language (a BCP 47 tag such as en or fi for descriptions and alt texts; empty means the content's own language). With `organism_id` (and `ws`) instead: whether documents published in that organism (or workspace) get their shared fingerprint, `autoProfile`, off by default; the workspace's own choice wins over the organism's, and null follows the level above. It spends nobody's key by itself: a document gets its fingerprint on the publisher's key, and only when the publisher's own settings run the profile step. Changing it takes the workspace's creator or an organism creator or admin. Change a setting only when the owner asked for it. Needs storage:read to read.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Content Class Settings', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'storage:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            patch: { type: 'object', description: 'The fields to change (see the description). Omit to read the settings.', zod: z.record(z.string(), z.unknown()) },
            organism_id: { type: 'string', description: 'Instead of your own settings: this organism\'s setting for workspace documents (with `ws`, that workspace\'s). Its one field is autoProfile.', zod: z.string().min(1).max(256) },
            ws: { type: 'string', description: 'With organism_id: the workspace.', zod: z.string().min(1).max(256) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
