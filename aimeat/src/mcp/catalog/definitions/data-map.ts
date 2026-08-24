/**
 * @file src/mcp/catalog/definitions/data-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two data-map tools: read where a program puts what, and state it.
 *
 *   NO NEW PERMISSION WORD. These read and write a memory record, and memory words already govern
 *   that. A `datamap:*` word would be a permission that has to be enforced on every door or does not
 *   exist (invariant 15), invented for a document the existing words already cover.
 *
 *   The third tool here is the one an agent needs most and the one nothing could answer before: how
 *   many hands have been on a key. An agent about to overwrite something should be able to find out
 *   whether anything else has been writing there.
 * @structure dataMapTools — the three definitions
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.0.0 — 2026-08-25 — TARGET-073.
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const dataMapTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_datamap_get',
        description: 'Where a published app puts what: which groups of keys it holds, whose they are, who can read them, how long they stay, what deleting one does, and why it is there rather than somewhere else. Read this BEFORE using an app that stores anything, because it is the only place that answers where your data lands. Each row says on what basis it is known — a fixed shape the store enforces, something the app declared, a part of AIMEAT, a name the owner gave it, or nothing at all — and a row saying nothing is a finding rather than a blank. A map the node worked out for itself says so: treat it as a first draft, not the owner\'s statement. Omit `app` for the account\'s own coverage instead: what is stored here that nobody has described, folded into groups.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            app: { type: 'string', description: 'The app, as "owner/filename.html". Leave it out to get this account\'s own coverage instead.' },
        },
    },
    {
        name: 'aimeat_datamap_set',
        description: 'State where an app puts what, replacing whatever the map said before — REPLACES, so read it first and send the whole thing back. This is how a draft the node worked out becomes something a person actually said. The field that matters most is the one-sentence `why` on each row: it is read at the moment somebody is about to move that data, which is exactly when "campaigns belong to the customer, not to whoever sent them" stops a mistake. Leave a `why` you do not know empty rather than filling it with something plausible — an empty one shows as unexplained, and a wrong one is believed. Nothing here can refuse a publish; the map is a statement about storage, not a gate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            app: { type: 'string', required: true, description: 'The app, as "owner/filename.html".' },
            data_map: { type: 'object', required: true, description: 'The whole map document, carrying spec "aimeat.datamap/1". Read the current one first — this replaces it.' },
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
