/**
 * @file src/tool-catalog/definitions/data-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data-map tools: read an app's map before you touch it, and write one.
 *
 *   THE FIRST TOOL IS THE POINT OF THE WHOLE FEATURE. An AI opening an app it does not know reads
 *   the map and learns what the app is for, how its data is arranged and why — instead of
 *   reconstructing months-old storage decisions from source and guessing wrong.
 *
 *   NO NEW PERMISSION WORD. These read and write a memory record, and memory words already govern
 *   that. A `datamap:*` word would be a permission that has to be enforced on every door or does not
 *   exist (invariant 15), invented for a document the existing words already cover.
 * @structure dataMapTools — the three definitions
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   2026-10-28 — The `data_map` parameter of aimeat_datamap_set names the app-level `aiAct` (the maker's EU AI Act answers) and the finding DATAMAP_AI_ACT_UNANSWERED.
 *   2026-10-28 — The `data_map` parameter of aimeat_datamap_set names the row's `domains` and the finding DATAMAP_PERSONAL_NO_DOMAIN.
 *   2026-10-22 — aimeat_memory_hands says that it covers the records the caller may read, and that its note names memory:read-as-owner (secaudit 2026-10, v88).
 *   2026-10-18 — The `data_map` parameter of aimeat_datamap_set names the machinery word `invites-people` and the optional app-level `invites`, and the finding an app asking for organism:invite gets without them.
 *   2026-10-05 —The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   2026-10-11 — aimeat_app_agent_tie and aimeat_app_agent_untie: one row of an app's data map that names an agent, added or removed.
 *   2026-10-11 — The `data_map` parameter of aimeat_datamap_set names the optional `agent` and `madeFor` on a held row: the tie between an app and the agent whose work it shows.
 *   2026-09-29 — The `data_map` parameter of aimeat_datamap_set names the optional `classification` on a held row (TARGET-082 V5). DATA_MAP_PARAM lists no optional fields, so it is unchanged.
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v2.1.0 — 2026-09-20 — DATA_MAP_PARAM: what the `data_map` parameter says on both MCP doors,
 *     built from the service's own spec constant, with a whole example object an E2E test writes.
 *   v2.0.0 — 2026-08-25 — spec/2 wording; the coverage mode is gone with the Data Wallet list.
 *   v1.0.0 — 2026-08-25 — TARGET-073.
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';
import { DATA_MAP_SPEC } from '../../services/data-map/data-map-types.js';

/**
 * What the `data_map` parameter says about itself, on both MCP doors. ONE text built from the
 * service's own constant: until 2026-09-20 both doors spelled the spec out by hand as
 * "aimeat.datamap/1" while the service took only /2, so the tool told every builder to send the
 * version it would refuse. Nine measured builds in a row made that first call and hit the wall.
 */
export const DATA_MAP_PARAM = `The WHOLE map in one object, carrying spec "${DATA_MAP_SPEC}": `
    + `{ "spec": "${DATA_MAP_SPEC}", "what": "one sentence on what the app is", "usedFor": "what people use it for", `
    + '"form": "one-person", "arrangement": "how its data is arranged", "machinery": [], "leaves": [], '
    + '"held": [ { "what": "habits.v1", "holds": "every habit and its ticks", "kind": "user-written", "usedFor": "app-cannot-run-without", '
    + '"where": "owner-memory-private", "owner": "person", "readers": "owner-and-their-agents", "writers": ["the-app-for-the-person"], '
    + '"shape": "one-record", "keptFor": "until-deleted", "lossRisk": "only-copy", "personalData": "yes", "why": "" } ], "elsewhere": [] }. '
    + 'One `held` row per key FAMILY, never per key; leave a `why` you do not know empty. '
    + 'This write REPLACES the map: read the current one first (aimeat_datamap_get) and send all of it back. '
    + 'Every field of a `held` row and every allowed value: aimeat_handbook_get { tier: "build-app/data-map" }.';

export const dataMapTools = [
    {
        name: 'aimeat_datamap_get',
        description: 'READ THIS BEFORE YOU CHANGE AN APP YOU DID NOT WRITE. An app\'s data map says what the app is for, what people use it for, what shape it is (one person, shared, a group, an organism workspace, static), how its data is actually arranged, what machinery it leans on, and what leaves this server. Then one row per group of keys: what it holds, what kind of thing it is, what it is used for, where it lives, who owns it, who reads it, who writes it, what shape the record is, how long it is kept, whether losing it matters, and ONE SENTENCE saying why it is there rather than somewhere else. That sentence is the reason this exists: without it a new feature\'s data lands wherever was easiest to reach, which is how a shared CRM ended up keeping the team\'s campaigns in one person\'s private memory where nobody else could see them. An app with no map says so plainly — that is a finding, not a blank, and writing one is the fix. For an app that uses AI the answer also carries `ai_act`: the node\'s EU AI Act questions (id, text, help, type, options), which of them are still as shipped (`built_in`), and which the map\'s `aiAct` leaves `unanswered`; the app\'s maker answers them in the map.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Data map: read', readOnlyHint: true },
        // No new word for the data map. It reads and writes a memory record, and a `datamap:*` word
        // would be a permission that has to be enforced on every door or does not exist (invariant 15).
        scope: 'memory:read',
        surfaces: ['agent'],
        input: {
            app: { type: 'string', required: true, description: 'The app, as "owner/filename.html".' },
        },
    },
    {
        name: 'aimeat_datamap_set',
        description: 'Write an app\'s data map, replacing whatever it said before — REPLACES, so read it first and send the whole thing back. Write one whenever you build an app or change where it stores something: you are the only one who knows where you put things and why, and the next AI to open it has no other way to find out. Two fields carry the value and neither can be worked out from the code: the paragraph saying what the app is and what it is used for, and the one-sentence `why` on each row. Leave a `why` you do not know EMPTY rather than filling it with something plausible — an empty one shows as unfinished, and a wrong one is believed and acted on. Nothing here can refuse a publish; the map is a statement about storage, not a gate.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Data map: state it', destructiveHint: true, idempotentHint: true },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            app: { type: 'string', required: true, description: 'The app, as "owner/filename.html".' },
            data_map: { type: 'object', required: true, description: 'The whole map, carrying spec "aimeat.datamap/2": what, usedFor, form, arrangement, machinery, leaves, held[], elsewhere[]. A held row may also carry `isA`, the semantic type its records ARE — schema:Person, aimeat:Task, or a full IRI (GET /v1/ns lists the ones this node names). `kind` and `holds` say what the data is in the app\'s own words, and `isA` says the same in a word other systems already know, which is what makes the family findable with the type filter on memory search. A family that is genuinely nothing standard leaves it out rather than reaching for the nearest wrong type. A held row may also carry `classification`, the label id of the classification the app expects for that family by default, such as "luottamuksellinen" (1 to 40 lowercase letters, digits and dashes). It labels nothing and never refuses the map; an id of the wrong shape comes back as a finding. A held row may also carry `agent`, the bare name of one of the owner\'s own agents whose work the row reads, with `madeFor: true` when the app was built for that agent. That row is the tie between the app and the agent: the agent\'s page lists the app, and it grants nothing. A held row with personalData "yes" also carries `domains`, the regulated data domains of that personal data by id: "employment" for CVs, competence ratings, staffing and HR, "health" for patient data, "children" for minors, and the others GET /v1/compliance/catalog lists; [] when none applies. The domain sets the classification floor and the AI Act risk area of the app, and a personal row without it comes back as the finding DATAMAP_PERSONAL_NO_DOMAIN. `isA`, `classification`, `agent`, `madeFor` and `domains` are the only optional fields on a row. An app that asks for organism:invite can invite people into organisms, and an invitation can create a new account: say so with "invites-people" in `machinery`, or the optional app-level `invites`: { "does": ["sends-email-invitations" | "mints-access-codes" | "creates-accounts" | "grants-workspace-access" | "manages-members"], "into": "which organisms" }. Without either, such an app gets the finding DATAMAP_INVITES_UNSTATED. An app that uses AI also carries the app-level `aiAct`: its maker\'s answers to the node\'s EU AI Act questions, { "answers": { "<question id>": true | false | "<option value>" }, "notes": { "<question id>": "why, in one or two sentences" } }. aimeat_datamap_get lists the questions under `ai_act`; the node\'s administrator approves the answers, and an AI app without them gets the finding DATAMAP_AI_ACT_UNANSWERED. Public like the rest of the map.' },
        },
    },
    {
        name: 'aimeat_app_agent_tie',
        description: 'State that one of the owner\'s apps shows the work of one of the owner\'s agents. The tie is one `held` row of the app\'s data map that names the agent: this changes that row and nothing else, so you do not have to read and resend the whole map, and an app with no map gets one with only that row. With the tie, the agent\'s page on the owner\'s home lists the app and the app\'s page lists the agent. It grants nothing: what the app may read is decided by its permissions. Use it after you build an app on an agent\'s work when you did not write the row into the map yourself, or when the person says an app uses an agent\'s results. aimeat_app_agent_untie takes the tie away.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Tie an App to an Agent', destructiveHint: false, idempotentHint: true },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            app: { type: 'string', required: true, description: 'The app, as "owner/filename.html".' },
            target_agent_name: { type: 'string', required: true, description: 'The bare name of the agent whose work the app shows (same owner as you).' },
            made_for: { type: 'boolean', description: 'True when the app was built for this agent\'s work; false or left out when it uses that work among other things.' },
            holds: { type: 'string', description: 'What the app holds from the agent, one short line. Used only when a row is added.' },
        },
    },
    {
        name: 'aimeat_app_agent_untie',
        description: 'Take away the statement that one of the owner\'s apps shows the work of one of the owner\'s agents (the tie aimeat_app_agent_tie or the app\'s builder wrote into the app\'s data map). A row that exists only for the tie is removed; a row the builder wrote keeps everything except the agent\'s name. The app, the agent and the agent\'s work stay as they are. Use it when the person says an app no longer uses an agent\'s results.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Untie an App from an Agent', destructiveHint: false, idempotentHint: true },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            app: { type: 'string', required: true, description: 'The app, as "owner/filename.html".' },
            target_agent_name: { type: 'string', required: true, description: 'The bare name of the agent the app is tied to (same owner as you).' },
        },
    },
    {
        name: 'aimeat_memory_hands',
        description: 'How many hands have been on one memory key, and whose. A key gets rewritten and the value changes; who touched it was never written down anywhere until this existed, and a field on the record could not hold it because the next write would overwrite it. Worth asking before overwriting something you did not write, and it is the answer somebody needs when a person asks what happened to their data. The answer carries what it cannot see: counting began the day it was switched on, so a key written before that and never written since has no hands here, and it counts the endpoints and tools a principal comes through rather than the places AIMEAT writes on its own behalf. It covers the records you may read: without the memory:read-as-owner permission, a record the owner or another of their agents keeps private has no hands here, as it reads as absent, and the answer\'s note says so.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Memory: who has written here', readOnlyHint: true },
        scope: 'memory:read',
        surfaces: ['agent'],
        input: {
            key: { type: 'string', required: true, description: 'The exact memory key to ask about.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
