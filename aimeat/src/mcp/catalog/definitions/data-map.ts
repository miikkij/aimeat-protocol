/**
 * @file src/mcp/catalog/definitions/data-map.ts
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
 *   v2.0.0 — 2026-08-25 — spec/2 wording; the coverage mode is gone with the Data Wallet list.
 *   v1.0.0 — 2026-08-25 — TARGET-073.
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const dataMapTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_datamap_get',
        description: 'READ THIS BEFORE YOU CHANGE AN APP YOU DID NOT WRITE. An app\'s data map says what the app is for, what people use it for, what shape it is (one person, shared, a group, an organism workspace, static), how its data is actually arranged, what machinery it leans on, and what leaves the house. Then one row per group of keys: what it holds, what kind of thing it is, what it is used for, where it lives, who owns it, who reads it, who writes it, what shape the record is, how long it is kept, whether losing it matters, and ONE SENTENCE saying why it is there rather than somewhere else. That sentence is the reason this exists: without it a new feature\'s data lands wherever was easiest to reach, which is how a shared CRM ended up keeping the team\'s campaigns in one person\'s private memory where nobody else could see them. An app with no map says so plainly — that is a finding, not a blank, and writing one is the fix.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            app: { type: 'string', required: true, description: 'The app, as "owner/filename.html".' },
        },
    },
    {
        name: 'aimeat_datamap_set',
        description: 'Write an app\'s data map, replacing whatever it said before — REPLACES, so read it first and send the whole thing back. Write one whenever you build an app or change where it stores something: you are the only one who knows where you put things and why, and the next AI to open it has no other way to find out. Two fields carry the value and neither can be worked out from the code: the paragraph saying what the app is and what it is used for, and the one-sentence `why` on each row. Leave a `why` you do not know EMPTY rather than filling it with something plausible — an empty one shows as unfinished, and a wrong one is believed and acted on. Nothing here can refuse a publish; the map is a statement about storage, not a gate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            app: { type: 'string', required: true, description: 'The app, as "owner/filename.html".' },
            data_map: { type: 'object', required: true, description: 'The whole map, carrying spec "aimeat.datamap/2": what, usedFor, form, arrangement, machinery, leaves, held[], elsewhere[].' },
        },
    },
    {
        name: 'aimeat_memory_hands',
        description: 'How many hands have been on one memory key, and whose. A key gets rewritten and the value changes; who touched it was never written down anywhere until this existed, and a field on the record could not hold it because the next write would overwrite it. Worth asking before overwriting something you did not write, and it is the answer somebody needs when a person asks what happened to their data. The answer carries what it cannot see: counting began the day it was switched on, so a key written before that and never written since has no hands here, and it counts the doors a principal comes through rather than the places AIMEAT writes on its own behalf.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'The exact memory key to ask about.' },
        },
    },
];
